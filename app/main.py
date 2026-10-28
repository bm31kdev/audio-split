from __future__ import annotations

import shutil
import subprocess
import sys
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "data" / "jobs"
UPLOADS = ROOT / "data" / "uploads"
ALLOWED = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}
JOBS.mkdir(parents=True, exist_ok=True)
UPLOADS.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="AudioSplit Studio")
job_stems: dict[str, Path] = {}
app.mount("/static", StaticFiles(directory=ROOT / "app" / "static"), name="static")


@app.get("/")
def home():
    return FileResponse(ROOT / "app" / "static" / "index.html")


@app.post("/api/separate")
async def separate(file: UploadFile = File(...), mode: str = Form("simple")):
    suffix = Path(file.filename or "audio").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(415, "Format non pris en charge. Utilisez MP3, WAV, FLAC, M4A ou OGG.")

    job_id = uuid.uuid4().hex
    source_dir = UPLOADS / job_id
    source_dir.mkdir()
    source = source_dir / f"audio-{job_id}{suffix}"
    with source.open("wb") as target:
        shutil.copyfileobj(file.file, target)

    # htdemucs is the quality model bundled with Demucs. --two-stems avoids
    # producing unused drums/bass/other tracks and returns vocals/no_vocals.
    if mode not in {"simple", "detailed"}:
        raise HTTPException(400, "Mode de séparation invalide.")
    command = [sys.executable, "-m", "demucs", "--name", "htdemucs", "--out", str(JOBS)]
    if mode == "simple":
        command.extend(["--two-stems", "vocals"])
    command.append(str(source))
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=3600)
    except FileNotFoundError as exc:
        raise HTTPException(500, "Demucs est introuvable. Exécutez pip install -r requirements.txt.") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "La séparation a dépassé une heure.") from exc

    if result.returncode != 0:
        # Demucs writes progress to stdout and warnings/errors to stderr. Keep
        # both streams: taking only the tail of stderr could hide the actual
        # exception behind a harmless Torchaudio deprecation warning.
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        detail = f"Sortie Demucs :\n{stdout}\n\nErreurs :\n{stderr}".strip()
        raise HTTPException(500, f"Demucs a échoué : {detail[-6000:]}")

    stem_dir = JOBS / "htdemucs" / source.stem
    filenames = {"vocals": "vocals.wav", "accompaniment": "no_vocals.wav"} if mode == "simple" else {
        "vocals": "vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav",
    }
    if any(not (stem_dir / filename).exists() for filename in filenames.values()):
        raise HTTPException(500, "Demucs n'a pas produit tous les stems attendus.")
    job_stems[job_id] = stem_dir
    return {
        "jobId": job_id,
        "stems": {name: f"/api/jobs/{job_id}/{name}" for name in filenames},
    }


@app.get("/api/jobs/{job_id}/{stem}")
def stem(job_id: str, stem: str):
    if stem not in {"vocals", "accompaniment", "drums", "bass", "other"} or not job_id.isalnum():
        raise HTTPException(404)
    filename = "no_vocals.wav" if stem == "accompaniment" else f"{stem}.wav"
    stem_dir = job_stems.get(job_id)
    if not stem_dir:
        raise HTTPException(404, "Stem introuvable.")
    path = stem_dir / filename
    if not path.is_file():
        raise HTTPException(404, "Stem introuvable.")
    return FileResponse(path, media_type="audio/wav", filename=f"{stem}.wav")

