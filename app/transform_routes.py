from __future__ import annotations

import logging
import math
import hashlib
import json
import shutil
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from .config import JOBS, MIN_FREE_DISK_BYTES, MAX_DECODED_STEM_BYTES
from .project_store import localized, project_path, read_json, safe_id
from .runtime import find_ffmpeg, serialized_cache_operation
from .state import job_stems

router = APIRouter()
logger = logging.getLogger(__name__)
TRANSFORM_ROOT = JOBS / "transforms"
STEM_FILES = {"vocals": "vocals.wav", "accompaniment": "no_vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav"}
MAX_OUTPUT_BYTES = MAX_DECODED_STEM_BYTES
MAX_TRANSFORM_CACHE_BYTES = 3 * 1024**3
progress_lock = threading.Lock()
transform_progress: dict[str, dict] = {}


def set_progress(request_id: str, *, status: str, completed: int, total: int, current: str = "") -> None:
    with progress_lock:
        if len(transform_progress) >= 128 and request_id not in transform_progress:
            oldest = min(transform_progress, key=lambda key: transform_progress[key].get("updated", 0))
            transform_progress.pop(oldest, None)
        transform_progress[request_id] = {"status": status, "completed": completed, "total": total, "current": current, "updated": time.time()}


def transform_cache_id(source_kind: str, source_id: str, source_dir: Path, names: list[str], tempo: float, pitch: float) -> str:
    files = []
    for name in names:
        path = source_dir / STEM_FILES[name]
        info = path.stat()
        files.append((STEM_FILES[name], info.st_size, info.st_mtime_ns))
    signature = json.dumps((source_kind, source_id, files, round(tempo, 7), round(pitch, 7)), separators=(",", ":"))
    return hashlib.sha256(signature.encode("utf-8")).hexdigest()[:32]


def prune_transform_cache(required_bytes: int, keep_id: str | None = None) -> None:
    TRANSFORM_ROOT.mkdir(parents=True, exist_ok=True)
    directories = [path for path in TRANSFORM_ROOT.iterdir() if path.is_dir() and not path.is_symlink()]
    total = sum(sum(file.stat().st_size for file in path.rglob("*") if file.is_file() and not file.is_symlink()) for path in directories)
    if total + required_bytes <= MAX_TRANSFORM_CACHE_BYTES:
        return
    directories.sort(key=lambda path: path.stat().st_mtime)
    for path in directories:
        if path.name == keep_id:
            continue
        size = sum(file.stat().st_size for file in path.rglob("*") if file.is_file() and not file.is_symlink())
        shutil.rmtree(path, ignore_errors=True)
        total -= size
        if total + required_bytes <= MAX_TRANSFORM_CACHE_BYTES:
            break


def resolve_source(payload: dict, language: str) -> tuple[str, Path, list[str]]:
    job_id, project_id = payload.get("jobId"), payload.get("projectId")
    if isinstance(job_id, str) and safe_id(job_id):
        stem_dir = job_stems.get(job_id)
        if stem_dir and stem_dir.is_dir():
            names = [name for name in STEM_FILES if (stem_dir / STEM_FILES[name]).is_file()]
            if names:
                return "job", stem_dir, names
    if isinstance(project_id, str) and safe_id(project_id):
        directory = project_path(project_id)
        project = read_json(directory / "project.json")
        stem_dir = directory / "stems"
        names = [name for name in project.get("stems", []) if name in STEM_FILES and (stem_dir / STEM_FILES[name]).is_file()]
        if names:
            return "project", stem_dir, names
    raise HTTPException(404, localized(language, "Les stems d’origine ne sont plus disponibles. Rechargez le projet ou relancez la séparation.", "Original stems are unavailable. Reopen the project or separate the track again."))


def render_stems(executable: str, source_dir: Path, names: list[str], output_dir: Path, tempo: float, pitch: float, language: str, request_id: str) -> dict:
    filter_value = f"rubberband=tempo={tempo:.8f}:pitch={pitch:.8f}"
    output_dir.mkdir(parents=True, exist_ok=False)

    def render_one(name: str) -> tuple[str, int]:
        source = source_dir / STEM_FILES[name]
        target = output_dir / STEM_FILES[name]
        result = subprocess.run(
            [executable, "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-i", str(source), "-vn", "-af", filter_value, "-c:a", "pcm_s16le", "-threads", "1", str(target)],
            capture_output=True, text=True, timeout=1800, check=False,
        )
        if result.returncode != 0 or not target.is_file() or target.stat().st_size == 0:
            detail = (result.stderr or "").strip()[-1200:]
            logger.error("FFmpeg time/pitch transform failed for %s: %s", name, detail)
            raise HTTPException(500, localized(language, f"La transformation de la piste {name} a échoué. Vérifiez FFmpeg et son filtre Rubber Band.", f"Transforming the {name} track failed. Check FFmpeg and its Rubber Band filter."))
        return name, target.stat().st_size

    try:
        produced: dict[str, int] = {}
        workers = min(2, len(names))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="audiosplit-rubberband") as pool:
            futures = [pool.submit(render_one, name) for name in names]
            for future in as_completed(futures):
                name, size = future.result()
                produced[name] = size
                if sum(produced.values()) > MAX_OUTPUT_BYTES:
                    raise HTTPException(413, localized(language, "Le rendu dépasserait la limite mémoire du mixeur. Réduisez la durée du morceau.", "The transformed render exceeds the mixer memory limit. Use a shorter track."))
                set_progress(request_id, status="rendering", completed=len(produced), total=len(names), current=name)
        return produced
    except BaseException:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise


@router.post("/api/transforms")
@serialized_cache_operation
async def create_transform(payload: dict):
    if not isinstance(payload, dict):
        raise HTTPException(400, "Transform request must be a JSON object.")
    language = "en" if isinstance(payload, dict) and payload.get("language") == "en" else "fr"
    try:
        tempo = float(payload.get("tempoRatio", 1))
        semitones = float(payload.get("pitchSemitones", 0))
    except (TypeError, ValueError):
        raise HTTPException(400, localized(language, "Le tempo et la transposition doivent être numériques.", "Tempo and pitch settings must be numbers.")) from None
    if not math.isfinite(tempo) or not 0.5 <= tempo <= 2:
        raise HTTPException(400, localized(language, "Le tempo cible doit rester entre 50 % et 200 % du tempo d’origine.", "Target tempo must stay between 50% and 200% of the original tempo."))
    if not math.isfinite(semitones) or not -12 <= semitones <= 12:
        raise HTTPException(400, localized(language, "La transposition doit rester entre −12 et +12 demi-tons.", "Pitch shift must stay between −12 and +12 semitones."))

    source_kind, source_dir, names = resolve_source(payload, language)
    source_id = payload.get("projectId") if source_kind == "project" else payload.get("jobId")
    if tempo == 1 and semitones == 0:
        root = "/api/library/projects" if source_kind == "project" else "/api/jobs"
        return {"transformId": None, "stems": {name: f"{root}/{source_id}/{name}" for name in names}, "stemFileBytes": {name: (source_dir / STEM_FILES[name]).stat().st_size for name in names}}

    pitch_ratio = 2 ** (semitones / 12)
    transform_id = transform_cache_id(source_kind, source_id, source_dir, names, tempo, pitch_ratio)
    output_dir = TRANSFORM_ROOT / transform_id
    request_id = payload.get("requestId") if isinstance(payload.get("requestId"), str) and safe_id(payload["requestId"]) else uuid.uuid4().hex
    cached = not output_dir.is_symlink() and all((output_dir / STEM_FILES[name]).is_file() and (output_dir / STEM_FILES[name]).stat().st_size > 0 for name in names)
    if cached:
        sizes = {name: (output_dir / STEM_FILES[name]).stat().st_size for name in names}
        set_progress(request_id, status="completed", completed=len(names), total=len(names))
        return {"transformId": transform_id, "stems": {name: f"/api/transforms/{transform_id}/{name}" for name in names}, "stemFileBytes": sizes, "cacheHit": True}

    if output_dir.exists():
        shutil.rmtree(output_dir, ignore_errors=True)

    # Reusing a completed render skips both FFmpeg checks and the expensive audio pass.
    executable = find_ffmpeg()
    if not executable:
        raise HTTPException(503, localized(language, "FFmpeg est introuvable. Relancez install-and-run.ps1 pour configurer les outils audio locaux.", "FFmpeg was not found. Run install-and-run.ps1 to configure local audio tools."))
    capability = await run_in_threadpool(subprocess.run, [executable, "-hide_banner", "-filters"], capture_output=True, text=True, timeout=30, check=False)
    if capability.returncode != 0 or "rubberband" not in capability.stdout:
        raise HTTPException(503, localized(language, "Cette version de FFmpeg n’inclut pas le filtre Rubber Band requis pour modifier tempo et tonalité.", "This FFmpeg build does not include the Rubber Band filter required for tempo and pitch changes."))

    input_bytes = sum((source_dir / STEM_FILES[name]).stat().st_size for name in names)
    estimate = int(input_bytes / tempo * 1.1)
    if estimate > MAX_OUTPUT_BYTES:
        raise HTTPException(413, localized(language, "Le rendu dépasserait la limite mémoire du mixeur. Réduisez la durée du morceau ou la variation de tempo.", "The transformed audio would exceed the mixer memory limit. Use a shorter track or a smaller tempo change."))
    if shutil.disk_usage(JOBS).free < estimate + MIN_FREE_DISK_BYTES:
        raise HTTPException(507, localized(language, "L’espace disque libre est insuffisant pour préparer la préécoute.", "There is not enough free disk space to prepare the preview."))
    prune_transform_cache(estimate)
    set_progress(request_id, status="rendering", completed=0, total=len(names))
    try:
        sizes = await run_in_threadpool(render_stems, executable, source_dir, names, output_dir, tempo, pitch_ratio, language, request_id)
        prune_transform_cache(0, keep_id=transform_id)
        set_progress(request_id, status="completed", completed=len(names), total=len(names))
    except Exception:
        set_progress(request_id, status="failed", completed=0, total=len(names))
        raise
    return {
        "transformId": transform_id,
        "stems": {name: f"/api/transforms/{transform_id}/{name}" for name in names},
        "stemFileBytes": sizes,
        "cacheHit": False,
    }


@router.get("/api/transforms/progress/{request_id}")
def get_transform_progress(request_id: str):
    if not safe_id(request_id):
        raise HTTPException(404, "Transform not found.")
    with progress_lock:
        progress = transform_progress.get(request_id)
        if progress is None:
            return {"status": "queued", "completed": 0, "total": 0}
        return {key: value for key, value in progress.items() if key != "updated"}


@router.get("/api/transforms/{transform_id}/{stem_name}")
def get_transformed_stem(transform_id: str, stem_name: str):
    if not safe_id(transform_id) or stem_name not in STEM_FILES:
        raise HTTPException(404, "Transformed track not found.")
    path = TRANSFORM_ROOT / transform_id / STEM_FILES[stem_name]
    if path.is_symlink() or not path.is_file():
        raise HTTPException(404, "Transformed track not found.")
    return FileResponse(path, media_type="audio/wav", filename=STEM_FILES[stem_name])
