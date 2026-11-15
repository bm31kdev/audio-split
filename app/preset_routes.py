from __future__ import annotations

import math
import json
import shutil
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from .config import LIBRARY, MAX_LIBRARY_BYTES, MAX_PRESETS, MIN_FREE_DISK_BYTES, PRESETS
from .project_store import read_json, safe_id, validate_project_state, write_json_atomic
from .runtime import measure_tree_bytes, serialized_cache_operation

router = APIRouter()
TRACKS = {"vocals", "accompaniment", "drums", "bass", "other"}


def ensure_library_space(payload: dict, old_path=None) -> None:
    incoming = len(json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"))
    previous = old_path.stat().st_size if old_path and old_path.is_file() else 0
    if measure_tree_bytes(LIBRARY) - previous + incoming > MAX_LIBRARY_BYTES:
        raise HTTPException(507, "Saving this preset would exceed the 20 GiB local library limit.")
    if shutil.disk_usage(LIBRARY).free < max(0, incoming - previous) + MIN_FREE_DISK_BYTES:
        raise HTTPException(507, "There is not enough free disk space to save this preset.")


def preset_path(preset_id: str):
    if not safe_id(preset_id):
        raise HTTPException(404, "Mix preset not found.")
    path = PRESETS / f"{preset_id}.json"
    if path.is_symlink() or not path.is_file():
        raise HTTPException(404, "Mix preset not found.")
    return path


def validate_payload(payload: dict, *, importing: bool = False) -> dict:
    if not isinstance(payload, dict):
        raise HTTPException(400, "Preset must be a JSON object.")
    name = str(payload.get("name", "")).strip()
    if not name or len(name) > 80:
        raise HTTPException(400, "Preset name must contain 1 to 80 characters.")
    state = {key: payload.get(key, {}) for key in ("settings", "effects", "automation")}
    validate_project_state(state)
    durations = payload.get("durations", {})
    if not isinstance(durations, dict) or set(durations) - TRACKS:
        raise HTTPException(400, "Preset track durations are invalid.")
    clean_durations = {}
    for stem, duration in durations.items():
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 0 < duration <= 900:
            raise HTTPException(400, "Preset track duration is out of range.")
        clean_durations[stem] = float(duration)
    return {"schemaVersion": 1, "id": payload.get("id") if importing else None, "name": name, **state, "durations": clean_durations}


@router.get("/api/library/presets")
def list_presets():
    items = []
    for path in PRESETS.glob("*.json"):
        try:
            item = read_json(path)
            if safe_id(item.get("id", "")) and item["id"] == path.stem:
                items.append(item)
        except (HTTPException, KeyError):
            continue
    return {"presets": sorted(items, key=lambda item: item.get("updatedAt", ""), reverse=True)}


@router.get("/api/library/presets/{preset_id}")
def export_preset(preset_id: str):
    return read_json(preset_path(preset_id))


@router.post("/api/library/presets/import")
@serialized_cache_operation
async def import_preset(payload: dict):
    if len(list(PRESETS.glob("*.json"))) >= MAX_PRESETS:
        raise HTTPException(507, f"The local library supports up to {MAX_PRESETS} mix presets.")
    clean = validate_payload(payload, importing=True)
    ensure_library_space(clean)
    preset_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    clean.update({"id": preset_id, "createdAt": now, "updatedAt": now})
    write_json_atomic(PRESETS / f"{preset_id}.json", clean)
    return clean


@router.post("/api/library/presets")
@serialized_cache_operation
async def create_preset(payload: dict):
    if len(list(PRESETS.glob("*.json"))) >= MAX_PRESETS:
        raise HTTPException(507, f"The local library supports up to {MAX_PRESETS} mix presets.")
    clean = validate_payload(payload)
    ensure_library_space(clean)
    preset_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    clean.update({"id": preset_id, "createdAt": now, "updatedAt": now})
    write_json_atomic(PRESETS / f"{preset_id}.json", clean)
    return clean


@router.put("/api/library/presets/{preset_id}")
@serialized_cache_operation
async def update_preset(preset_id: str, payload: dict):
    path = preset_path(preset_id)
    previous = read_json(path)
    clean = validate_payload(payload)
    ensure_library_space(clean, path)
    clean.update({"id": preset_id, "createdAt": previous.get("createdAt", datetime.now(timezone.utc).isoformat()), "updatedAt": datetime.now(timezone.utc).isoformat()})
    write_json_atomic(path, clean)
    return clean


@router.patch("/api/library/presets/{preset_id}")
@serialized_cache_operation
async def rename_preset(preset_id: str, payload: dict):
    path = preset_path(preset_id)
    preset = read_json(path)
    name = str(payload.get("name", "")).strip()
    if not name or len(name) > 80:
        raise HTTPException(400, "Preset name must contain 1 to 80 characters.")
    preset["name"] = name
    preset["updatedAt"] = datetime.now(timezone.utc).isoformat()
    write_json_atomic(path, preset)
    return preset


@router.delete("/api/library/presets/{preset_id}")
@serialized_cache_operation
async def delete_preset(preset_id: str, payload: dict):
    path = preset_path(preset_id)
    preset = read_json(path)
    if payload.get("confirmation") != preset.get("name"):
        raise HTTPException(409, "Type the exact preset name to confirm its permanent deletion.")
    path.unlink()
    path.with_suffix(path.suffix + ".bak").unlink(missing_ok=True)
    return {"deleted": True}
