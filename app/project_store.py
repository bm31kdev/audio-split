from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException

from .config import LIBRARY, MAX_MANIFEST_BYTES

def clear_directory_children(directory: Path) -> int:
    """Remove only known cache children while preserving the cache directory."""
    if not directory.exists():
        directory.mkdir(parents=True, exist_ok=True)
        return 0
    removed = 0
    for child in directory.iterdir():
        if child.is_symlink() or not child.is_dir():
            child.unlink()
        else:
            shutil.rmtree(child)
        removed += 1
    return removed


def localized(language: str, french: str, english: str) -> str:
    """Return the API message matching the interface language."""
    return english if language.lower().startswith("en") else french


def read_json(path: Path) -> dict:
    failure = None
    for candidate in (path, path.with_suffix(path.suffix + ".bak")):
        try:
            if candidate.stat().st_size > MAX_MANIFEST_BYTES:
                raise ValueError("metadata exceeds the size limit")
            payload = json.loads(candidate.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                if candidate != path:
                    # A valid backup is preferred over a corrupt primary file.
                    write_json_atomic(path, payload, keep_backup=False)
                return payload
            failure = ValueError("metadata is not a JSON object")
        except FileNotFoundError as exc:
            failure = exc
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            failure = exc
    raise HTTPException(500, "Local project metadata and its backup are unreadable.") from failure


def write_json_atomic(path: Path, payload: dict, keep_backup: bool = True) -> None:
    """Replace a manifest in one same-volume operation to avoid partial JSON."""
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    backup_temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.bak.tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
        if keep_backup and path.is_file():
            try:
                old_data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(old_data, dict):
                    shutil.copy2(path, backup_temporary)
                    os.replace(backup_temporary, path.with_suffix(path.suffix + ".bak"))
            except (OSError, json.JSONDecodeError):
                # Preserve the previous known-good backup if the primary is damaged.
                pass
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
        backup_temporary.unlink(missing_ok=True)


def validate_project_state(payload: dict) -> None:
    """Reject malformed or oversized mixer state before it reaches a manifest."""
    allowed_tracks = {"vocals", "accompaniment", "drums", "bass", "other"}
    try:
        serialized_size = len(json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Project state contains values that cannot be saved.") from None
    if serialized_size > 2_000_000:
        raise HTTPException(413, "Project mixer settings are too large.")

    settings = payload.get("settings", {})
    effects = payload.get("effects", {})
    automation = payload.get("automation", {})
    if not all(isinstance(value, dict) for value in (settings, effects, automation)):
        raise HTTPException(400, "Project settings, effects, and automation must be JSON objects.")

    for track, values in settings.items():
        if track not in allowed_tracks or not isinstance(values, dict):
            raise HTTPException(400, "Project contains invalid track settings.")
        if set(values) - {"volume", "pan", "muted"}:
            raise HTTPException(400, "Project contains unknown track settings.")
        for key, low, high in (("volume", 0, 150), ("pan", -100, 100)):
            value = values.get(key)
            if value is not None:
                if isinstance(value, bool):
                    raise HTTPException(400, f"Invalid {key} value in project settings.")
                try:
                    numeric = float(value)
                except (TypeError, ValueError):
                    raise HTTPException(400, f"Invalid {key} value in project settings.") from None
                if not (-float("inf") < numeric < float("inf")) or not low <= numeric <= high:
                    raise HTTPException(400, f"Invalid {key} value in project settings.")
        if "muted" in values and not isinstance(values["muted"], bool):
            raise HTTPException(400, "Invalid mute value in project settings.")

    effect_keys = {"saturation", "bassBoost", "compressor", "eqLow", "eqMid", "eqHigh", "reverb", "delay", "highPass", "lowPass", "width", "ducking", "chorus", "flanger", "phaser", "tremolo", "bitcrusher", "gate", "deEsser", "limiter", "exciter"}
    for track, values in effects.items():
        if track not in allowed_tracks or not isinstance(values, dict):
            raise HTTPException(400, "Project contains invalid track effects.")
        for key, value in values.items():
            if key not in effect_keys or isinstance(value, bool) or not isinstance(value, (int, float)):
                raise HTTPException(400, "Project contains an invalid effect value.")
            low, high = (-12, 12) if key in {"eqLow", "eqMid", "eqHigh"} else (0, 200) if key == "width" else (0, 100)
            if not (-float("inf") < value < float("inf")) or not low <= value <= high:
                raise HTTPException(400, "Project contains an out-of-range effect value.")

    for track, state in automation.items():
        if track not in allowed_tracks or not isinstance(state, dict) or not isinstance(state.get("points", []), list):
            raise HTTPException(400, "Project contains invalid pan automation.")
        if set(state) - {"points", "selected"}:
            raise HTTPException(400, "Project contains unknown pan automation settings.")
        points = state.get("points", [])
        if len(points) > 10_000:
            raise HTTPException(400, "Project contains too many automation points.")
        previous_time = None
        for point in points:
            if not isinstance(point, dict) or set(point) != {"time", "pan"}:
                raise HTTPException(400, "Project contains an invalid automation point.")
            if isinstance(point.get("time"), bool) or isinstance(point.get("pan"), bool):
                raise HTTPException(400, "Project contains an invalid automation point.")
            try:
                time_value, pan_value = float(point["time"]), float(point["pan"])
            except (KeyError, TypeError, ValueError):
                raise HTTPException(400, "Project contains an invalid automation point.") from None
            if not (0 <= time_value < float("inf") and -100 <= pan_value <= 100):
                raise HTTPException(400, "Project contains an out-of-range automation point.")
            if previous_time is not None and time_value <= previous_time:
                raise HTTPException(400, "Automation points must be ordered by time.")
            previous_time = time_value
        selected = state.get("selected", 0)
        if isinstance(selected, bool) or not isinstance(selected, int) or (points and not 0 <= selected < len(points)) or (not points and selected != 0):
            raise HTTPException(400, "Project contains an invalid automation selection.")


def safe_id(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{32}", value))


def validate_folder_manifest(payload: dict, folder_dir: Path) -> None:
    folder_id, name, created_at = payload.get("id"), payload.get("name"), payload.get("createdAt")
    if not isinstance(folder_id, str) or not safe_id(folder_id) or folder_id != folder_dir.name:
        raise HTTPException(500, "Local folder metadata has an invalid identifier.")
    if not isinstance(name, str) or not name.strip() or len(name) > 80:
        raise HTTPException(500, "Local folder metadata has an invalid name.")
    if not isinstance(created_at, str) or not created_at:
        raise HTTPException(500, "Local folder metadata has an invalid creation date.")


def validate_project_manifest(payload: dict, project_dir: Path, folder_id: str) -> None:
    project_id = payload.get("id")
    if not isinstance(project_id, str) or not safe_id(project_id) or project_id != project_dir.name:
        raise HTTPException(500, "Local project metadata has an invalid identifier.")
    if payload.get("folderId") != folder_id:
        raise HTTPException(500, "Local project metadata has an invalid folder reference.")
    name, source_name = payload.get("name"), payload.get("sourceName", "")
    if not isinstance(name, str) or not name.strip() or len(name) > 120:
        raise HTTPException(500, "Local project metadata has an invalid name.")
    if not isinstance(source_name, str) or len(source_name) > 1024:
        raise HTTPException(500, "Local project metadata has an invalid source filename.")
    mode, engine, stems = payload.get("mode"), payload.get("engine"), payload.get("stems")
    if not isinstance(mode, str) or mode not in {"simple", "detailed"} or not isinstance(engine, str) or engine not in {"fast", "studio"}:
        raise HTTPException(500, "Local project metadata has invalid separation settings.")
    expected_stems = {"vocals", "accompaniment"} if mode == "simple" else {"vocals", "drums", "bass", "other"}
    if not isinstance(stems, list) or any(not isinstance(stem, str) for stem in stems) or len(stems) != len(expected_stems) or set(stems) != expected_stems:
        raise HTTPException(500, "Local project metadata has an invalid stem list.")
    for field in ("createdAt", "updatedAt"):
        if not isinstance(payload.get(field), str) or not payload[field]:
            raise HTTPException(500, f"Local project metadata has an invalid {field} value.")
    schema_version = payload.get("schemaVersion", 1)
    if isinstance(schema_version, bool) or schema_version != 1:
        raise HTTPException(500, "Local project metadata uses an unsupported schema version.")
    try:
        validate_project_state({key: payload.get(key, {}) for key in ("settings", "effects", "automation")})
    except HTTPException as exc:
        raise HTTPException(500, "Local project mixer settings are invalid.") from exc


def folder_path(folder_id: str) -> Path:
    if not safe_id(folder_id):
        raise HTTPException(404, "Folder not found.")
    path = LIBRARY / folder_id
    if not (path / "folder.json").is_file():
        raise HTTPException(404, "Folder not found.")
    validate_folder_manifest(read_json(path / "folder.json"), path)
    return path


def project_path(project_id: str) -> Path:
    if not safe_id(project_id):
        raise HTTPException(404, "Project not found.")
    for folder in LIBRARY.iterdir():
        candidate = folder / "projects" / project_id
        if candidate.is_dir() and (candidate / "project.json").is_file():
            validate_project_manifest(read_json(candidate / "project.json"), candidate, folder.name)
            return candidate
    raise HTTPException(404, "Project not found.")


