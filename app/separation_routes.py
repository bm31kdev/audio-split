from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import sys
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from .config import (
    ALLOWED, JOBS, MAX_UPLOAD_BYTES, MAX_DECODED_STEM_BYTES, MAX_CACHE_BYTES,
    MIN_FREE_DISK_BYTES, STEM_DELIVERY_LEASE_SECONDS, UPLOADS,
)
from .state import (
    active_processes, cancelled_separations, demucs_semaphore, job_sources, job_stems,
    pending_stem_deliveries, separation_states,
)
from .runtime import (
    acknowledge_stem_delivery, expire_stem_leases, measure_tree_bytes, probe_duration,
    run_demucs_with_progress, serialized_cache_operation, update_separation_state,
)
from .project_store import clear_directory_children, localized, safe_id

router = APIRouter()

@router.delete("/api/cache")
@serialized_cache_operation
async def clear_cache(lang: str = "fr"):
    # Both folders contain generated local data only: no user source is touched.
    expire_stem_leases()
    if pending_stem_deliveries:
        raise HTTPException(409, localized(lang, "Une séparation vient de se terminer et ses pistes sont encore en cours de chargement. Réessayez dans quelques secondes.", "A separation just finished and its tracks are still loading. Try again in a few seconds."))
    removed_jobs, removed_uploads = await asyncio.gather(
        run_in_threadpool(clear_directory_children, JOBS),
        run_in_threadpool(clear_directory_children, UPLOADS),
    )
    job_stems.clear()
    job_sources.clear()
    pending_stem_deliveries.clear()
    return {
        "cleared": True,
        "removedJobs": removed_jobs,
        "removedUploads": removed_uploads,
        "message": localized(lang, "Le cache AudioSplit a été vidé.", "AudioSplit cache cleared."),
    }


@router.get("/api/separations/{request_id}")
def separation_status(request_id: str):
    if not safe_id(request_id):
        raise HTTPException(404, "Separation not found.")
    state = separation_states.get(request_id)
    if state is None and request_id in cancelled_separations:
        return {"status": "canceling", "progress": 0}
    if state is None:
        raise HTTPException(404, "Separation not found.")
    return dict(state)


@router.post("/api/separations/{request_id}/cancel")
def cancel_separation(request_id: str, lang: str = "fr"):
    if not safe_id(request_id):
        raise HTTPException(404, "Separation not found.")
    state = separation_states.get(request_id, {})
    if state.get("status") in {"completed", "failed", "cancelled"}:
        raise HTTPException(409, localized(lang, "Cette séparation est déjà terminée.", "This separation has already finished."))
    if request_id not in cancelled_separations and len(cancelled_separations) >= 128:
        cancelled_separations.pop()
    cancelled_separations.add(request_id)
    process = active_processes.get(request_id)
    if process and process.poll() is None:
        try:
            process.terminate()
        except OSError:
            pass
    update_separation_state(request_id, status="canceling", progress=state.get("progress", 0))
    return {"accepted": True}


@router.post("/api/separate")
@serialized_cache_operation
async def separate(file: UploadFile = File(...), mode: str = Form("simple"), engine: str = Form("fast"), language: str = Form("fr"), request_id: str | None = Form(None)):
    request_id = request_id or uuid.uuid4().hex
    if not safe_id(request_id):
        raise HTTPException(400, localized(language, "Identifiant de séparation invalide.", "Invalid separation identifier."))
    if request_id in cancelled_separations:
        cancelled_separations.discard(request_id)
        update_separation_state(request_id, status="cancelled", progress=0)
        raise HTTPException(409, localized(language, "Séparation annulée.", "Separation cancelled."))
    update_separation_state(request_id, status="preparing", progress=0)
    # Validate the extension before creating a job folder on disk.
    suffix = Path(file.filename or "audio").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(415, localized(language, "Format non pris en charge. Utilisez MP3, WAV, FLAC, M4A ou OGG.", "Unsupported format. Use MP3, WAV, FLAC, M4A, or OGG."))
    if mode not in {"simple", "detailed"} or engine not in {"fast", "studio"}:
        raise HTTPException(400, localized(language, "Mode de séparation invalide.", "Invalid separation mode."))
    if file.size is not None and file.size > MAX_UPLOAD_BYTES:
        raise HTTPException(413, localized(language, "Le fichier audio dépasse la limite de 512 Mio.", "The audio file exceeds the 512 MiB limit."))

    model_name = "mdx" if engine == "fast" else "htdemucs"
    segment = "4" if engine == "fast" else "6"
    overlap = "0.1" if engine == "fast" else "0.15"
    filenames = {"vocals": "vocals.wav", "accompaniment": "no_vocals.wav"} if mode == "simple" else {
        "vocals": "vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav",
    }
    pipeline_key = hashlib.sha256(f"demucs=4.0.1|{mode}|{engine}|{model_name}|{segment}|{overlap}|shifts=0|jobs=1|device=cpu".encode()).hexdigest()[:12]

    # Hashing the upload and pipeline settings gives each configuration a safe cache entry.
    job_id = uuid.uuid4().hex
    source_dir = UPLOADS / job_id
    source_dir.mkdir()
    temporary_source = source_dir / f"source{suffix}"
    digest = hashlib.sha256()
    total_bytes = 0
    try:
        with temporary_source.open("wb") as target:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, localized(language, "Le fichier audio dépasse la limite de 512 Mio.", "The audio file exceeds the 512 MiB limit."))
                digest.update(chunk)
                target.write(chunk)
        source = source_dir / f"audio-{digest.hexdigest()}-{pipeline_key}{suffix}"
        temporary_source.rename(source)
    except BaseException:
        shutil.rmtree(source_dir, ignore_errors=True)
        raise

    try:
        duration = probe_duration(source, language)
    except HTTPException:
        shutil.rmtree(source_dir, ignore_errors=True)
        raise
    if request_id in cancelled_separations:
        cancelled_separations.discard(request_id)
        shutil.rmtree(source_dir, ignore_errors=True)
        update_separation_state(request_id, status="cancelled", progress=0)
        raise HTTPException(409, localized(language, "Séparation annulée.", "Separation cancelled."))

    # htdemucs is the quality model bundled with Demucs. --two-stems avoids
    # producing unused drums/bass/other tracks and returns vocals/no_vocals.
    # `mdx` is the light CPU-friendly, non-quantized model. Its previous
    # `mdx_q` variant needs the optional DiffQ C++ extension, which is not
    # installable out of the box on Windows without Visual C++ Build Tools.
    # htdemucs remains available when precision matters more than speed.
    # Smaller CPU chunks prevent a large song from requesting several gigabytes
    # of RAM in one Demucs pass. Disabling random shifts keeps Fast responsive.
    # The model name is part of the cache key because quality modes differ.
    stem_dir = JOBS / model_name / source.stem
    cache_bytes = measure_tree_bytes(JOBS) + measure_tree_bytes(UPLOADS)
    expected_output_bytes = int(duration * 44_100 * 2 * 4 * len(filenames))
    if expected_output_bytes > MAX_DECODED_STEM_BYTES:
        shutil.rmtree(source_dir, ignore_errors=True)
        raise HTTPException(413, localized(language, "Ce mode produirait trop de données audio pour le mixeur du navigateur. Choisissez une piste plus courte ou le mode simple.", "This mode would produce too much audio data for the browser mixer. Choose a shorter track or Simple mode."))
    if not all((stem_dir / filename).is_file() for filename in filenames.values()):
        if cache_bytes > MAX_CACHE_BYTES:
            shutil.rmtree(source_dir, ignore_errors=True)
            raise HTTPException(507, localized(language, "Le cache AudioSplit dépasse déjà 10 Gio. Videz-le avant une nouvelle séparation.", "The AudioSplit cache already exceeds 10 GiB. Clear it before starting another separation."))
        if cache_bytes + expected_output_bytes > MAX_CACHE_BYTES:
            shutil.rmtree(source_dir, ignore_errors=True)
            raise HTTPException(507, localized(language, "Le cache AudioSplit atteindrait 10 Gio. Videz-le avant une nouvelle séparation.", "The AudioSplit cache would exceed 10 GiB. Clear it before starting another separation."))
        free_bytes = shutil.disk_usage(JOBS).free
        if free_bytes < expected_output_bytes + MIN_FREE_DISK_BYTES:
            shutil.rmtree(source_dir, ignore_errors=True)
            raise HTTPException(507, localized(language, "L’espace disque libre est insuffisant pour cette séparation.", "There is not enough free disk space for this separation."))
    if all((stem_dir / filename).is_file() for filename in filenames.values()):
        job_stems[job_id] = stem_dir
        job_sources[job_id] = source
        pending_stem_deliveries[job_id] = (set(filenames), asyncio.get_running_loop().time() + STEM_DELIVERY_LEASE_SECONDS)
        update_separation_state(request_id, status="completed", progress=100)
        return {"jobId": job_id, "cacheHit": True, "duration": duration, "stems": {name: f"/api/jobs/{job_id}/{name}" for name in filenames}}

    # Use the current virtual-environment Python to avoid calling a global Demucs.
    command = [
        sys.executable, "-m", "demucs", "--name", model_name, "--device", "cpu",
        "--segment", segment, "--overlap", overlap, "--shifts", "0", "--jobs", "1", "--out", str(JOBS),
    ]
    if mode == "simple":
        command.extend(["--two-stems", "vocals"])
    command.append(str(source))
    async with demucs_semaphore:
        if request_id in cancelled_separations:
            cancelled_separations.discard(request_id)
            shutil.rmtree(source_dir, ignore_errors=True)
            update_separation_state(request_id, status="cancelled", progress=0)
            raise HTTPException(409, localized(language, "Séparation annulée.", "Separation cancelled."))
        # Another request may have finished this exact track while this one waited.
        if all((stem_dir / filename).is_file() for filename in filenames.values()):
            job_stems[job_id] = stem_dir
            job_sources[job_id] = source
            pending_stem_deliveries[job_id] = (set(filenames), asyncio.get_running_loop().time() + STEM_DELIVERY_LEASE_SECONDS)
            update_separation_state(request_id, status="completed", progress=100)
            return {"jobId": job_id, "cacheHit": True, "duration": duration, "stems": {name: f"/api/jobs/{job_id}/{name}" for name in filenames}}
        try:
            thread_count = str(max(1, min(4, os.cpu_count() or 1)))
            runtime_env = {**os.environ, "OMP_NUM_THREADS": thread_count, "MKL_NUM_THREADS": thread_count}
            returncode, output, was_cancelled, timed_out = await run_demucs_with_progress(command, request_id, source_dir, runtime_env)
        except (FileNotFoundError, OSError) as exc:
            separation_states[request_id] = {"status": "failed", "progress": 0, "error": "process"}
            shutil.rmtree(source_dir, ignore_errors=True)
            raise HTTPException(500, localized(language, "Demucs est introuvable. Exécutez pip install -r requirements.txt.", "Demucs was not found. Run pip install -r requirements.txt.")) from exc
        if was_cancelled:
            shutil.rmtree(source_dir, ignore_errors=True)
            shutil.rmtree(stem_dir, ignore_errors=True)
            raise HTTPException(409, localized(language, "Séparation annulée.", "Separation cancelled."))
        if timed_out:
            shutil.rmtree(source_dir, ignore_errors=True)
            shutil.rmtree(stem_dir, ignore_errors=True)
            raise HTTPException(504, localized(language, "La séparation a dépassé une heure.", "Separation exceeded one hour."))

    if returncode != 0:
        # Demucs writes progress to stdout and warnings/errors to stderr. Keep
        # both streams: taking only the tail of stderr could hide the actual
        # exception behind a harmless Torchaudio deprecation warning.
        detail = output.strip()
        if "not enough memory" in detail.lower() or "defaultcpuallocator" in detail.lower():
            message = localized(
                language,
                "Demucs manque de mémoire vive. Fermez les applications lourdes, puis réessayez en mode Rapide.",
                "Demucs ran out of RAM. Close memory-heavy applications, then retry in Fast mode.",
            )
            update_separation_state(request_id, status="failed", progress=0, error="memory")
            shutil.rmtree(stem_dir, ignore_errors=True)
            shutil.rmtree(source_dir, ignore_errors=True)
            raise HTTPException(507, message)
        shutil.rmtree(stem_dir, ignore_errors=True)
        shutil.rmtree(source_dir, ignore_errors=True)
        update_separation_state(request_id, status="failed", progress=0, error="demucs")
        raise HTTPException(500, f"{localized(language, 'Demucs a échoué', 'Demucs failed')}: {detail[-6000:]}")

    if any(not (stem_dir / filename).exists() for filename in filenames.values()):
        update_separation_state(request_id, status="failed", progress=0, error="missing-stems")
        shutil.rmtree(stem_dir, ignore_errors=True)
        shutil.rmtree(source_dir, ignore_errors=True)
        raise HTTPException(500, localized(language, "Demucs n'a pas produit tous les stems attendus.", "Demucs did not produce every expected stem."))
    job_stems[job_id] = stem_dir
    job_sources[job_id] = source
    pending_stem_deliveries[job_id] = (set(filenames), asyncio.get_running_loop().time() + STEM_DELIVERY_LEASE_SECONDS)
    update_separation_state(request_id, status="completed", progress=100)
    return {
        "jobId": job_id,
        "cacheHit": False,
        "duration": duration,
        "stems": {name: f"/api/jobs/{job_id}/{name}" for name in filenames},
    }


@router.get("/api/jobs/{job_id}/{stem}")
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
    return FileResponse(path, media_type="audio/wav", filename=f"{stem}.wav", background=BackgroundTask(acknowledge_stem_delivery, job_id, stem))


