from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Keep every runtime path relative to the repository so the launcher can run
# from any Windows PowerShell location.
ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "data" / "jobs"
UPLOADS = ROOT / "data" / "uploads"
LIBRARY = ROOT / "data" / "library"
ALLOWED = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}
JOBS.mkdir(parents=True, exist_ok=True)
UPLOADS.mkdir(parents=True, exist_ok=True)
LIBRARY.mkdir(parents=True, exist_ok=True)

# The in-memory map only exposes stems produced during the current server run.
app = FastAPI(title="AudioSplit Studio")
job_stems: dict[str, Path] = {}
job_sources: dict[str, Path] = {}
app.mount("/static", StaticFiles(directory=ROOT / "app" / "static"), name="static")
app.mount("/logo", StaticFiles(directory=ROOT / "logo"), name="logo")


def clear_directory_children(directory: Path) -> int:
    """Remove only known cache children while preserving the cache directory."""
    if not directory.exists():
        directory.mkdir(parents=True, exist_ok=True)
        return 0
    removed = 0
    for child in directory.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
        removed += 1
    return removed


def localized(language: str, french: str, english: str) -> str:
    """Return the API message matching the interface language."""
    return english if language.lower().startswith("en") else french


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(500, "Local project metadata is unreadable.") from exc


def safe_id(value: str) -> bool:
    return bool(value) and all(char in "0123456789abcdef-" for char in value.lower())


def folder_path(folder_id: str) -> Path:
    if not safe_id(folder_id):
        raise HTTPException(404, "Folder not found.")
    path = LIBRARY / folder_id
    if not (path / "folder.json").is_file():
        raise HTTPException(404, "Folder not found.")
    return path


def project_path(project_id: str) -> Path:
    if not safe_id(project_id):
        raise HTTPException(404, "Project not found.")
    for folder in LIBRARY.iterdir():
        candidate = folder / "projects" / project_id
        if candidate.is_dir() and (candidate / "project.json").is_file():
            return candidate
    raise HTTPException(404, "Project not found.")


@app.get("/")
def home():
    # The application shell loads static modules and component fragments itself.
    return FileResponse(ROOT / "app" / "static" / "index.html")


@app.delete("/api/cache")
def clear_cache(lang: str = "fr"):
    # Both folders contain generated local data only: no user source is touched.
    removed_jobs = clear_directory_children(JOBS)
    removed_uploads = clear_directory_children(UPLOADS)
    job_stems.clear()
    job_sources.clear()
    return {
        "cleared": True,
        "removedJobs": removed_jobs,
        "removedUploads": removed_uploads,
        "message": localized(lang, "Le cache AudioSplit a été vidé.", "AudioSplit cache cleared."),
    }


@app.post("/api/separate")
async def separate(file: UploadFile = File(...), mode: str = Form("simple"), engine: str = Form("fast"), language: str = Form("fr")):
    # Validate the extension before creating a job folder on disk.
    suffix = Path(file.filename or "audio").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(415, localized(language, "Format non pris en charge. Utilisez MP3, WAV, FLAC, M4A ou OGG.", "Unsupported format. Use MP3, WAV, FLAC, M4A, or OGG."))
    if mode not in {"simple", "detailed"} or engine not in {"fast", "studio"}:
        raise HTTPException(400, localized(language, "Mode de séparation invalide.", "Invalid separation mode."))

    # Hashing the upload gives identical files a reusable Demucs output folder.
    job_id = uuid.uuid4().hex
    source_dir = UPLOADS / job_id
    source_dir.mkdir()
    temporary_source = source_dir / f"source{suffix}"
    digest = hashlib.sha256()
    with temporary_source.open("wb") as target:
        while chunk := await file.read(1024 * 1024):
            digest.update(chunk)
            target.write(chunk)
    source = source_dir / f"audio-{digest.hexdigest()}{suffix}"
    temporary_source.rename(source)

    # htdemucs is the quality model bundled with Demucs. --two-stems avoids
    # producing unused drums/bass/other tracks and returns vocals/no_vocals.
    # `mdx` is the light CPU-friendly, non-quantized model. Its previous
    # `mdx_q` variant needs the optional DiffQ C++ extension, which is not
    # installable out of the box on Windows without Visual C++ Build Tools.
    # htdemucs remains available when precision matters more than speed.
    # Smaller CPU chunks prevent a large song from requesting several gigabytes
    # of RAM in one Demucs pass. Disabling random shifts keeps Fast responsive.
    model_name = "mdx" if engine == "fast" else "htdemucs"
    segment = "4" if engine == "fast" else "6"
    overlap = "0.1" if engine == "fast" else "0.15"
    filenames = {"vocals": "vocals.wav", "accompaniment": "no_vocals.wav"} if mode == "simple" else {
        "vocals": "vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav",
    }
    # The model name is part of the cache key because quality modes differ.
    stem_dir = JOBS / model_name / source.stem
    if all((stem_dir / filename).is_file() for filename in filenames.values()):
        job_stems[job_id] = stem_dir
        job_sources[job_id] = source
        return {"jobId": job_id, "cacheHit": True, "stems": {name: f"/api/jobs/{job_id}/{name}" for name in filenames}}

    # Use the current virtual-environment Python to avoid calling a global Demucs.
    command = [
        sys.executable, "-m", "demucs", "--name", model_name, "--device", "cpu",
        "--segment", segment, "--overlap", overlap, "--shifts", "0", "--jobs", "1", "--out", str(JOBS),
    ]
    if mode == "simple":
        command.extend(["--two-stems", "vocals"])
    command.append(str(source))
    try:
        thread_count = str(max(1, min(4, os.cpu_count() or 1)))
        runtime_env = {**os.environ, "OMP_NUM_THREADS": thread_count, "MKL_NUM_THREADS": thread_count}
        result = subprocess.run(command, capture_output=True, text=True, timeout=3600, env=runtime_env)
    except FileNotFoundError as exc:
        raise HTTPException(500, localized(language, "Demucs est introuvable. Exécutez pip install -r requirements.txt.", "Demucs was not found. Run pip install -r requirements.txt.")) from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, localized(language, "La séparation a dépassé une heure.", "Separation exceeded one hour.")) from exc

    if result.returncode != 0:
        # Demucs writes progress to stdout and warnings/errors to stderr. Keep
        # both streams: taking only the tail of stderr could hide the actual
        # exception behind a harmless Torchaudio deprecation warning.
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        output_heading = localized(language, "Sortie Demucs", "Demucs output")
        errors_heading = localized(language, "Erreurs", "Errors")
        detail = f"{output_heading} :\n{stdout}\n\n{errors_heading} :\n{stderr}".strip()
        if "not enough memory" in detail.lower() or "defaultcpuallocator" in detail.lower():
            message = localized(
                language,
                "Demucs manque de mémoire vive. Fermez les applications lourdes, puis réessayez en mode Rapide.",
                "Demucs ran out of RAM. Close memory-heavy applications, then retry in Fast mode.",
            )
            raise HTTPException(507, message)
        raise HTTPException(500, f"{localized(language, 'Demucs a échoué', 'Demucs failed')}: {detail[-6000:]}")

    if any(not (stem_dir / filename).exists() for filename in filenames.values()):
        raise HTTPException(500, localized(language, "Demucs n'a pas produit tous les stems attendus.", "Demucs did not produce every expected stem."))
    job_stems[job_id] = stem_dir
    job_sources[job_id] = source
    return {
        "jobId": job_id,
        "cacheHit": False,
        "stems": {name: f"/api/jobs/{job_id}/{name}" for name in filenames},
    }


@app.get("/api/jobs/{job_id}/{stem}")
def stem(job_id: str, stem: str, lang: str = "fr"):
    # Never use unchecked URL values as file-system paths.
    if stem not in {"vocals", "accompaniment", "drums", "bass", "other"} or not job_id.isalnum():
        raise HTTPException(404)
    filename = "no_vocals.wav" if stem == "accompaniment" else f"{stem}.wav"
    stem_dir = job_stems.get(job_id)
    if not stem_dir:
        raise HTTPException(404, localized(lang, "Stem introuvable.", "Stem not found."))
    path = stem_dir / filename
    if not path.is_file():
        raise HTTPException(404, localized(lang, "Stem introuvable.", "Stem not found."))
    return FileResponse(path, media_type="audio/wav", filename=f"{stem}.wav")


@app.get("/api/library")
def list_library():
    """The local folders and JSON manifests are the library; there is no database."""
    folders = []
    for path in LIBRARY.iterdir():
        manifest = path / "folder.json"
        if not path.is_dir() or not manifest.is_file():
            continue
        folder = read_json(manifest)
        projects = []
        for project_dir in (path / "projects").glob("*/"):
            metadata = project_dir / "project.json"
            if metadata.is_file():
                projects.append(read_json(metadata))
        folder["projects"] = sorted(projects, key=lambda project: project.get("updatedAt", ""), reverse=True)
        folders.append(folder)
    return {"folders": sorted(folders, key=lambda folder: folder.get("createdAt", ""))}


@app.post("/api/library/folders")
def create_folder(payload: dict):
    name = str(payload.get("name", "")).strip()
    if not name or len(name) > 80:
        raise HTTPException(400, "Folder name must contain 1 to 80 characters.")
    folder_id = uuid.uuid4().hex
    path = LIBRARY / folder_id
    (path / "projects").mkdir(parents=True)
    now = datetime.now(timezone.utc).isoformat()
    (path / "folder.json").write_text(json.dumps({"id": folder_id, "name": name, "createdAt": now}, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"id": folder_id, "name": name, "createdAt": now, "projects": []}


@app.patch("/api/library/folders/{folder_id}")
def rename_folder(folder_id: str, payload: dict):
    path = folder_path(folder_id)
    name = str(payload.get("name", "")).strip()
    if not name or len(name) > 80:
        raise HTTPException(400, "Folder name must contain 1 to 80 characters.")
    folder = read_json(path / "folder.json")
    folder["name"] = name
    (path / "folder.json").write_text(json.dumps(folder, ensure_ascii=False, indent=2), encoding="utf-8")
    return folder


@app.delete("/api/library/folders/{folder_id}")
def delete_folder(folder_id: str):
    path = folder_path(folder_id)
    shutil.rmtree(path)
    return {"deleted": True}


@app.post("/api/library/folders/{folder_id}/projects")
def save_project(folder_id: str, payload: dict):
    parent = folder_path(folder_id)
    job_id = str(payload.get("jobId", ""))
    source = job_sources.get(job_id)
    stems = job_stems.get(job_id)
    if not source or not source.is_file() or not stems or not stems.is_dir():
        raise HTTPException(404, "The current separation is no longer available. Separate the track again before saving.")
    title = str(payload.get("name", "")).strip()
    if not title or len(title) > 120:
        raise HTTPException(400, "Project name must contain 1 to 120 characters.")
    mode = payload.get("mode", "simple")
    available = ["vocals", "accompaniment"] if mode == "simple" else ["vocals", "drums", "bass", "other"]
    files = {"vocals": "vocals.wav", "accompaniment": "no_vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav"}
    if any(not (stems / files[name]).is_file() for name in available):
        raise HTTPException(404, "One or more separated tracks are missing.")
    project_id = uuid.uuid4().hex
    destination = parent / "projects" / project_id
    try:
        (destination / "stems").mkdir(parents=True)
        shutil.copy2(source, destination / f"source{source.suffix.lower()}")
        for name in available:
            shutil.copy2(stems / files[name], destination / "stems" / files[name])
        now = datetime.now(timezone.utc).isoformat()
        metadata = {"id": project_id, "folderId": folder_id, "name": title, "sourceName": str(payload.get("sourceName", source.name)), "mode": mode, "engine": payload.get("engine", "fast"), "stems": available, "settings": payload.get("settings", {}), "automation": payload.get("automation", {}), "effects": payload.get("effects", {}), "createdAt": now, "updatedAt": now}
        (destination / "project.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        shutil.rmtree(destination, ignore_errors=True)
        raise HTTPException(500, f"Could not save local project: {exc}") from exc
    return metadata


@app.get("/api/library/projects/{project_id}")
def load_project(project_id: str):
    path = project_path(project_id)
    metadata = read_json(path / "project.json")
    metadata["audio"] = {name: f"/api/library/projects/{project_id}/{name}" for name in metadata.get("stems", [])}
    return metadata


@app.patch("/api/library/projects/{project_id}")
def rename_project(project_id: str, payload: dict):
    path = project_path(project_id)
    metadata = read_json(path / "project.json")
    name = str(payload.get("name", "")).strip()
    if not name or len(name) > 120:
        raise HTTPException(400, "Project name must contain 1 to 120 characters.")
    metadata["name"] = name
    metadata["updatedAt"] = datetime.now(timezone.utc).isoformat()
    (path / "project.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata


@app.put("/api/library/projects/{project_id}")
def update_project(project_id: str, payload: dict):
    path = project_path(project_id)
    metadata = read_json(path / "project.json")
    name = str(payload.get("name", metadata.get("name", ""))).strip()
    if not name or len(name) > 120:
        raise HTTPException(400, "Project name must contain 1 to 120 characters.")
    metadata["name"] = name
    metadata["settings"] = payload.get("settings", metadata.get("settings", {}))
    metadata["automation"] = payload.get("automation", metadata.get("automation", {}))
    metadata["effects"] = payload.get("effects", metadata.get("effects", {}))
    metadata["updatedAt"] = datetime.now(timezone.utc).isoformat()
    (path / "project.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata


@app.delete("/api/library/projects/{project_id}")
def delete_project(project_id: str):
    path = project_path(project_id)
    shutil.rmtree(path)
    return {"deleted": True}


@app.get("/api/library/projects/{project_id}/{stem}")
def saved_stem(project_id: str, stem: str):
    if stem not in {"vocals", "accompaniment", "drums", "bass", "other"}:
        raise HTTPException(404, "Track not found.")
    filename = "no_vocals.wav" if stem == "accompaniment" else f"{stem}.wav"
    path = project_path(project_id) / "stems" / filename
    if not path.is_file():
        raise HTTPException(404, "Track not found.")
    return FileResponse(path, media_type="audio/wav", filename=f"{stem}.wav")

