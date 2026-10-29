from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Keep every runtime path relative to the repository so the launcher can run
# from any Windows PowerShell location.
ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "data" / "jobs"
UPLOADS = ROOT / "data" / "uploads"
ALLOWED = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}
JOBS.mkdir(parents=True, exist_ok=True)
UPLOADS.mkdir(parents=True, exist_ok=True)

# The in-memory map only exposes stems produced during the current server run.
app = FastAPI(title="AudioSplit Studio")
job_stems: dict[str, Path] = {}
app.mount("/static", StaticFiles(directory=ROOT / "app" / "static"), name="static")
app.mount("/logo", StaticFiles(directory=ROOT / "logo"), name="logo")


def clear_directory_children(directory: Path) -> int:
    """Remove only known cache children while preserving the cache directory."""
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


@app.get("/")
def home():
    # The application shell loads static modules and component fragments itself.
    return FileResponse(ROOT / "app" / "static" / "index.html")


@app.delete("/api/cache")
def clear_cache(lang: str = "fr"):
    # Both folders contain generated local data only: no project source is touched.
    removed_jobs = clear_directory_children(JOBS)
    removed_uploads = clear_directory_children(UPLOADS)
    job_stems.clear()
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
    if mode not in {"simple", "detailed"} or engine not in {"fast", "studio"}:
        raise HTTPException(400, localized(language, "Mode de séparation invalide.", "Invalid separation mode."))
    # `mdx` is the light CPU-friendly, non-quantized model. Its previous
    # `mdx_q` variant needs the optional DiffQ C++ extension, which is not
    # installable out of the box on Windows without Visual C++ Build Tools.
    # htdemucs remains available when precision matters more than speed.
    model_name = "mdx" if engine == "fast" else "htdemucs"
    filenames = {"vocals": "vocals.wav", "accompaniment": "no_vocals.wav"} if mode == "simple" else {
        "vocals": "vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav",
    }
    # The model name is part of the cache key because quality modes differ.
    stem_dir = JOBS / model_name / source.stem
    if all((stem_dir / filename).is_file() for filename in filenames.values()):
        job_stems[job_id] = stem_dir
        return {"jobId": job_id, "cacheHit": True, "stems": {name: f"/api/jobs/{job_id}/{name}" for name in filenames}}

    # Use the current virtual-environment Python to avoid calling a global Demucs.
    command = [sys.executable, "-m", "demucs", "--name", model_name, "--out", str(JOBS)]
    if mode == "simple":
        command.extend(["--two-stems", "vocals"])
    command.append(str(source))
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=3600)
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
        raise HTTPException(500, f"{localized(language, 'Demucs a échoué', 'Demucs failed')}: {detail[-6000:]}")

    if any(not (stem_dir / filename).exists() for filename in filenames.values()):
        raise HTTPException(500, localized(language, "Demucs n'a pas produit tous les stems attendus.", "Demucs did not produce every expected stem."))
    job_stems[job_id] = stem_dir
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

