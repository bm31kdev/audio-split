from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid
import zipfile
import zlib
from functools import partial
from functools import wraps
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from starlette.background import BackgroundTask

# Keep every runtime path relative to the repository so the launcher can run
# from any Windows PowerShell location.
ROOT = Path(__file__).resolve().parent.parent
JOBS = ROOT / "data" / "jobs"
UPLOADS = ROOT / "data" / "uploads"
LIBRARY = ROOT / "data" / "library"
ALLOWED = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}
MAX_UPLOAD_BYTES = 512 * 1024 * 1024
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_LIBRARY_BODY_BYTES = 2 * 1024 * 1024
MAX_AUDIO_DURATION_SECONDS = 15 * 60
MAX_DECODED_STEM_BYTES = 1024 * 1024 * 1024
MAX_CACHE_BYTES = 10 * 1024 * 1024 * 1024
MAX_LIBRARY_BYTES = 20 * 1024 * 1024 * 1024
MAX_PROJECT_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
MIN_FREE_DISK_BYTES = 512 * 1024 * 1024
STEM_DELIVERY_LEASE_SECONDS = 300
JOBS.mkdir(parents=True, exist_ok=True)
UPLOADS.mkdir(parents=True, exist_ok=True)
LIBRARY.mkdir(parents=True, exist_ok=True)

# The in-memory map only exposes stems produced during the current server run.
app = FastAPI(title="AudioSplit Studio")
job_stems: dict[str, Path] = {}
job_sources: dict[str, Path] = {}
pending_stem_deliveries: dict[str, tuple[set[str], float]] = {}
separation_states: dict[str, dict] = {}
active_processes: dict[str, subprocess.Popen] = {}
cancelled_separations: set[str] = set()
demucs_semaphore = asyncio.Semaphore(1)
cache_operation_lock = asyncio.Lock()
app.mount("/static", StaticFiles(directory=ROOT / "app" / "static"), name="static")
app.mount("/logo", StaticFiles(directory=ROOT / "logo"), name="logo")


class RequestBodyLimitMiddleware:
    """Bound upload and project request bodies before Starlette spools them."""

    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.application(scope, receive, send)
            return

        method, path = scope.get("method"), scope.get("path", "")
        if method == "POST" and path == "/api/separate":
            limit = MAX_UPLOAD_BYTES + 1_000_000  # File plus multipart fields/boundaries.
        elif method == "POST" and path.endswith("/projects/import"):
            limit = MAX_PROJECT_ARCHIVE_BYTES + 1_000_000
        elif path.startswith("/api/library/") and method in {"POST", "PUT", "PATCH"}:
            limit = MAX_LIBRARY_BODY_BYTES
        else:
            await self.application(scope, receive, send)
            return

        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        content_length = headers.get(b"content-length")
        if content_length:
            try:
                declared_size = int(content_length)
                if declared_size > limit:
                    await self._reject(send, limit)
                    return
                if method == "POST" and (path == "/api/separate" or path.endswith("/projects/import")):
                    spool_free = shutil.disk_usage(tempfile.gettempdir()).free
                    if spool_free < declared_size * 2 + MIN_FREE_DISK_BYTES:
                        await self._reject(send, limit, status=507, detail="There is not enough temporary disk space for this upload.")
                        return
            except ValueError:
                await self._reject(send, limit, status=400, detail="Invalid Content-Length header.")
                return

        spool = tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
        total = 0
        next_disk_check = 16 * 1024 * 1024
        try:
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                if message["type"] != "http.request":
                    continue
                chunk = message.get("body", b"")
                total += len(chunk)
                if total > limit:
                    await self._reject(send, limit)
                    return
                if method == "POST" and (path == "/api/separate" or path.endswith("/projects/import")) and total >= next_disk_check:
                    next_disk_check = total + 16 * 1024 * 1024
                    if shutil.disk_usage(tempfile.gettempdir()).free < MIN_FREE_DISK_BYTES + len(chunk):
                        await self._reject(send, limit, status=507, detail="Temporary upload storage is full.")
                        return
                if chunk:
                    spool.write(chunk)
                if not message.get("more_body", False):
                    break
            spool.seek(0)
            sent_final = False

            async def replay_receive():
                nonlocal sent_final
                if sent_final:
                    return {"type": "http.disconnect"}
                chunk = await asyncio.to_thread(spool.read, 64 * 1024)
                sent_final = spool.tell() >= total
                return {"type": "http.request", "body": chunk, "more_body": not sent_final}

            await self.application(scope, replay_receive, send)
        except OSError:
            await self._reject(send, limit, status=507, detail="Temporary upload storage is full.")
        finally:
            spool.close()

    @staticmethod
    async def _reject(send, limit, status=413, detail=None):
        detail = detail or f"Request body exceeds the {limit // (1024 * 1024)} MiB limit."
        body = json.dumps({"detail": detail}).encode("utf-8")
        await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})


def serialized_cache_operation(endpoint):
    """Keep cache deletion from racing an import, separation, or project copy."""
    @wraps(endpoint)
    async def wrapped(*args, **kwargs):
        async with cache_operation_lock:
            try:
                return await endpoint(*args, **kwargs)
            except HTTPException as exc:
                request_id = kwargs.get("request_id")
                if endpoint.__name__ == "separate" and isinstance(request_id, str) and request_id in separation_states:
                    terminal = "cancelled" if exc.status_code == 409 else "failed"
                    update_separation_state(request_id, status=terminal, error=str(exc.status_code))
                raise
    return wrapped


def expire_stem_leases() -> None:
    now = asyncio.get_running_loop().time()
    expired = [job_id for job_id, (_, expires_at) in pending_stem_deliveries.items() if expires_at <= now]
    for job_id in expired:
        pending_stem_deliveries.pop(job_id, None)


def acknowledge_stem_delivery(job_id: str, stem_name: str) -> None:
    lease = pending_stem_deliveries.get(job_id)
    if not lease:
        return
    remaining, expires_at = lease
    remaining.discard(stem_name)
    if remaining:
        pending_stem_deliveries[job_id] = (remaining, expires_at)
    else:
        pending_stem_deliveries.pop(job_id, None)


def measure_tree_bytes(directory: Path) -> int:
    total = 0
    if not directory.exists():
        return total
    for path in directory.rglob("*"):
        try:
            if path.is_file() and not path.is_symlink():
                total += path.stat().st_size
        except OSError:
            continue
    return total


def remove_temp_file(path: Path) -> None:
    path.unlink(missing_ok=True)


def find_ffprobe() -> str | None:
    found = shutil.which("ffprobe")
    if found:
        return found
    package_root = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    if package_root.is_dir():
        for candidate in package_root.glob("Gyan.FFmpeg.*/*/bin/ffprobe.exe"):
            if candidate.is_file():
                return str(candidate)
    return None


def probe_duration(path: Path, language: str) -> float:
    executable = find_ffprobe()
    if not executable:
        raise HTTPException(503, localized(language, "FFprobe est introuvable. Relancez install-and-run.ps1 pour configurer FFmpeg.", "FFprobe was not found. Run install-and-run.ps1 to configure FFmpeg."))
    try:
        result = subprocess.run(
            [executable, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=20, check=False,
        )
        duration = float(result.stdout.strip()) if result.returncode == 0 else 0
    except (OSError, subprocess.TimeoutExpired, ValueError):
        duration = 0
    if not 0 < duration < float("inf"):
        raise HTTPException(415, localized(language, "Le fichier audio est illisible ou sa durée est inconnue.", "The audio file is unreadable or its duration is unknown."))
    if duration > MAX_AUDIO_DURATION_SECONDS:
        raise HTTPException(413, localized(language, "La durée maximale prise en charge est de 15 minutes.", "The maximum supported audio duration is 15 minutes."))
    return duration


def read_log_tail(path: Path, maximum_bytes: int = 16_000) -> str:
    try:
        with path.open("rb") as log:
            log.seek(0, os.SEEK_END)
            log.seek(max(0, log.tell() - maximum_bytes))
            return log.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def update_separation_state(request_id: str, **values) -> None:
    if request_id not in separation_states and len(separation_states) >= 128:
        for old_id, old_state in list(separation_states.items()):
            if old_id not in active_processes and old_state.get("status") in {"completed", "failed", "cancelled"}:
                separation_states.pop(old_id, None)
                if len(separation_states) < 128:
                    break
    state = separation_states.setdefault(request_id, {"status": "queued", "progress": 0})
    state.update(values)


async def run_demucs_with_progress(command: list[str], request_id: str, source_dir: Path, runtime_env: dict) -> tuple[int, str, bool, bool]:
    """Run Demucs as a cancellable process and retain bounded progress output."""
    log_path = source_dir / "demucs.log"
    process = None
    started = asyncio.get_running_loop().time()
    timed_out = False
    with log_path.open("wb") as log:
        try:
            launch = partial(subprocess.Popen, command, stdout=log, stderr=subprocess.STDOUT, env=runtime_env, cwd=ROOT)
            process = await run_in_threadpool(launch)
            active_processes[request_id] = process
            update_separation_state(request_id, status="running", progress=0)

            while process.poll() is None:
                if request_id in cancelled_separations:
                    try:
                        process.terminate()
                    except OSError:
                        pass
                    break
                if asyncio.get_running_loop().time() - started > 3600:
                    timed_out = True
                    try:
                        process.terminate()
                    except OSError:
                        pass
                    break
                output = read_log_tail(log_path)
                percentages = re.findall(r"(?<!\d)(\d{1,3})%", output)
                if percentages:
                    update_separation_state(request_id, progress=max(0, min(99, int(percentages[-1]))))
                await asyncio.sleep(0.35)

            try:
                await run_in_threadpool(process.wait, timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                await run_in_threadpool(process.wait)
        finally:
            active_processes.pop(request_id, None)

    output = read_log_tail(log_path)
    was_cancelled = request_id in cancelled_separations
    if was_cancelled:
        cancelled_separations.discard(request_id)
        update_separation_state(request_id, status="cancelled", progress=0)
    elif timed_out:
        update_separation_state(request_id, status="failed", error="timeout")
    elif process is not None and process.returncode == 0:
        update_separation_state(request_id, status="completed", progress=100)
    else:
        update_separation_state(request_id, status="failed", error="demucs")
    return (process.returncode if process is not None else 1), output, was_cancelled, timed_out


@app.middleware("http")
async def protect_local_mutations(request, call_next):
    """Restrict write requests to the loopback origin used by the local UI."""
    if request.method == "POST" and request.url.path == "/api/separate":
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                request_size = int(content_length)
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length header."}, status_code=400)
            if request_size > MAX_UPLOAD_BYTES + 1_000_000:
                return JSONResponse({"detail": "The audio upload exceeds the 512 MiB limit."}, status_code=413)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        host = request.url.hostname
        origin = request.headers.get("origin")
        host_header = request.headers.get("host", "")
        if host not in {"127.0.0.1", "localhost"}:
            return JSONResponse({"detail": "This local application only accepts loopback requests."}, status_code=403)
        if not origin:
            return JSONResponse({"detail": "An Origin header is required for local write requests."}, status_code=403)
        parsed = urlsplit(origin)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.netloc.lower() != host_header.lower():
            return JSONResponse({"detail": "Cross-origin requests are not allowed."}, status_code=403)
    return await call_next(request)


@app.middleware("http")
async def add_browser_security_headers(request, call_next):
    """Keep the local UI same-origin and prevent framing/content sniffing."""
    response = await call_next(request)
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; media-src 'self' blob:; worker-src 'self'; connect-src 'self'; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    )
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    return response


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

    effect_keys = {"saturation", "compressor", "eqLow", "eqMid", "eqHigh", "reverb", "delay", "highPass", "lowPass", "width", "ducking", "chorus", "flanger", "phaser", "tremolo", "bitcrusher", "gate", "deEsser", "limiter", "exciter"}
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


@app.get("/")
def home():
    # The application shell loads static modules and component fragments itself.
    return FileResponse(ROOT / "app" / "static" / "index.html")


@app.delete("/api/cache")
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


@app.get("/api/separations/{request_id}")
def separation_status(request_id: str):
    if not safe_id(request_id):
        raise HTTPException(404, "Separation not found.")
    state = separation_states.get(request_id)
    if state is None and request_id in cancelled_separations:
        return {"status": "canceling", "progress": 0}
    if state is None:
        raise HTTPException(404, "Separation not found.")
    return dict(state)


@app.post("/api/separations/{request_id}/cancel")
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


@app.post("/api/separate")
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
    return FileResponse(path, media_type="audio/wav", filename=f"{stem}.wav", background=BackgroundTask(acknowledge_stem_delivery, job_id, stem))


@app.get("/api/library")
def list_library():
    """The local folders and JSON manifests are the library; there is no database."""
    folders = []
    warnings = []
    for path in LIBRARY.iterdir():
        manifest = path / "folder.json"
        if not path.is_dir() or not manifest.is_file():
            continue
        try:
            folder = read_json(manifest)
            validate_folder_manifest(folder, path)
        except HTTPException:
            warnings.append({"kind": "folder", "id": path.name})
            continue
        projects = []
        for project_dir in (path / "projects").glob("*/"):
            metadata = project_dir / "project.json"
            if metadata.is_file():
                try:
                    project = read_json(metadata)
                    validate_project_manifest(project, project_dir, folder["id"])
                    files = {"vocals": "vocals.wav", "accompaniment": "no_vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav"}
                    if any(not (project_dir / "stems" / files[name]).is_file() for name in project["stems"]):
                        raise HTTPException(500, "Project audio files are missing.")
                    projects.append(project)
                except HTTPException:
                    warnings.append({"kind": "project", "id": project_dir.name, "folderId": folder["id"]})
        folder["projects"] = sorted(projects, key=lambda project: project.get("updatedAt", ""), reverse=True)
        folders.append(folder)
    return {"folders": sorted(folders, key=lambda folder: folder.get("createdAt", "")), "warnings": warnings}


@app.post("/api/library/folders")
def create_folder(payload: dict):
    name = str(payload.get("name", "")).strip()
    if not name or len(name) > 80:
        raise HTTPException(400, "Folder name must contain 1 to 80 characters.")
    folder_id = uuid.uuid4().hex
    path = LIBRARY / folder_id
    (path / "projects").mkdir(parents=True)
    now = datetime.now(timezone.utc).isoformat()
    write_json_atomic(path / "folder.json", {"id": folder_id, "name": name, "createdAt": now})
    return {"id": folder_id, "name": name, "createdAt": now, "projects": []}


@app.patch("/api/library/folders/{folder_id}")
def rename_folder(folder_id: str, payload: dict):
    path = folder_path(folder_id)
    name = str(payload.get("name", "")).strip()
    if not name or len(name) > 80:
        raise HTTPException(400, "Folder name must contain 1 to 80 characters.")
    folder = read_json(path / "folder.json")
    folder["name"] = name
    write_json_atomic(path / "folder.json", folder)
    return folder


@app.delete("/api/library/folders/{folder_id}")
@serialized_cache_operation
async def delete_folder(folder_id: str, payload: dict):
    path = folder_path(folder_id)
    folder = read_json(path / "folder.json")
    if payload.get("confirmation") != folder["name"]:
        raise HTTPException(409, "Type the exact folder name to confirm its permanent deletion.")
    await run_in_threadpool(shutil.rmtree, path)
    return {"deleted": True}


@app.post("/api/library/folders/{folder_id}/projects")
@serialized_cache_operation
async def save_project(folder_id: str, payload: dict):
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
    engine = payload.get("engine", "fast")
    if not isinstance(mode, str) or mode not in {"simple", "detailed"} or not isinstance(engine, str) or engine not in {"fast", "studio"}:
        raise HTTPException(400, "Project separation settings are invalid.")
    source_name = str(payload.get("sourceName", source.name))
    if len(source_name) > 1024:
        raise HTTPException(400, "Project source filename is too long.")
    validate_project_state(payload)
    available = ["vocals", "accompaniment"] if mode == "simple" else ["vocals", "drums", "bass", "other"]
    files = {"vocals": "vocals.wav", "accompaniment": "no_vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav"}
    if any(not (stems / files[name]).is_file() for name in available):
        raise HTTPException(404, "One or more separated tracks are missing.")
    project_bytes = source.stat().st_size + sum((stems / files[name]).stat().st_size for name in available)
    library_bytes = measure_tree_bytes(LIBRARY)
    if library_bytes + project_bytes > MAX_LIBRARY_BYTES:
        raise HTTPException(507, "Saving this project would exceed the 20 GiB local project-library limit.")
    if shutil.disk_usage(parent).free < project_bytes + MIN_FREE_DISK_BYTES:
        raise HTTPException(507, "There is not enough free disk space to save this project.")
    project_id = uuid.uuid4().hex
    destination = parent / "projects" / project_id
    try:
        def copy_project_audio():
            (destination / "stems").mkdir(parents=True)
            shutil.copy2(source, destination / f"source{source.suffix.lower()}")
            for name in available:
                shutil.copy2(stems / files[name], destination / "stems" / files[name])
        await run_in_threadpool(copy_project_audio)
        now = datetime.now(timezone.utc).isoformat()
        metadata = {"schemaVersion": 1, "id": project_id, "folderId": folder_id, "name": title, "sourceName": source_name, "mode": mode, "engine": engine, "stems": available, "settings": payload.get("settings", {}), "automation": payload.get("automation", {}), "effects": payload.get("effects", {}), "createdAt": now, "updatedAt": now}
        write_json_atomic(destination / "project.json", metadata)
    except OSError as exc:
        await run_in_threadpool(shutil.rmtree, destination, ignore_errors=True)
        raise HTTPException(500, f"Could not save local project: {exc}") from exc
    return metadata


@app.get("/api/library/projects/{project_id}/archive")
def export_project_archive(project_id: str):
    project_dir = project_path(project_id)
    manifest_path = project_dir / "project.json"
    metadata = read_json(manifest_path)
    source_files = [path for path in project_dir.glob("source.*") if path.suffix.lower() in ALLOWED and path.is_file()]
    if len(source_files) != 1:
        raise HTTPException(500, "The saved project source file is missing or ambiguous.")
    stem_files = {"vocals": "vocals.wav", "accompaniment": "no_vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav"}
    files = [(manifest_path, "project.json"), (source_files[0], source_files[0].name)]
    files.extend((project_dir / "stems" / stem_files[name], f"stems/{stem_files[name]}") for name in metadata.get("stems", []))
    if any(not path.is_file() for path, _ in files):
        raise HTTPException(500, "One or more saved project audio files are missing.")
    archive_size = sum(path.stat().st_size for path, _ in files)
    if archive_size > MAX_PROJECT_ARCHIVE_BYTES:
        raise HTTPException(413, "This project is too large to export as one archive.")
    if shutil.disk_usage(tempfile.gettempdir()).free < archive_size + MIN_FREE_DISK_BYTES:
        raise HTTPException(507, "There is not enough temporary disk space to export this project.")

    archive_path = Path(tempfile.gettempdir()) / f"audiosplit-project-{uuid.uuid4().hex}.zip"
    try:
        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
            for path, member in files:
                archive.write(path, arcname=member)
        if archive_path.stat().st_size > MAX_PROJECT_ARCHIVE_BYTES:
            raise HTTPException(413, "This project is too large to export as one archive.")
    except BaseException:
        remove_temp_file(archive_path)
        raise
    return FileResponse(archive_path, media_type="application/zip", filename=f"audiosplit-project-{project_id}.zip", background=BackgroundTask(remove_temp_file, archive_path))


@app.post("/api/library/folders/{folder_id}/projects/import")
@serialized_cache_operation
async def import_project_archive(folder_id: str, file: UploadFile = File(...)):
    parent = folder_path(folder_id)
    if file.size is not None and file.size > MAX_PROJECT_ARCHIVE_BYTES:
        raise HTTPException(413, "Project archive exceeds the 2 GiB limit.")
    if file.size is not None and shutil.disk_usage(parent).free < file.size + MIN_FREE_DISK_BYTES:
        raise HTTPException(507, "There is not enough free disk space to restore this project.")

    projects_dir = parent / "projects"
    project_id = uuid.uuid4().hex
    destination = projects_dir / project_id
    staging = projects_dir / f".import-{project_id}"
    stem_names = {"vocals": "vocals.wav", "accompaniment": "no_vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav"}

    def restore_archive():
        try:
            file.file.seek(0)
            with zipfile.ZipFile(file.file, "r") as archive:
                entries = archive.infolist()
                if not entries or len(entries) > 8:
                    raise HTTPException(400, "Project archive contains an invalid file list.")
                names = [entry.filename for entry in entries]
                if len(names) != len(set(names)) or any("\\" in name or name.startswith("/") or any(part in {"", ".", ".."} for part in name.split("/")) for name in names):
                    raise HTTPException(400, "Project archive contains unsafe file paths.")
                if any(entry.is_dir() or stat.S_ISLNK((entry.external_attr >> 16) & 0xFFFF) for entry in entries):
                    raise HTTPException(400, "Project archive cannot contain directories or symbolic links.")
                if any(entry.flag_bits & 0x1 for entry in entries):
                    raise HTTPException(400, "Encrypted project archives are not supported.")
                if any(entry.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED} for entry in entries):
                    raise HTTPException(400, "Project archive uses an unsupported compression method.")
                if any(entry.file_size < 0 or entry.file_size > MAX_PROJECT_ARCHIVE_BYTES for entry in entries) or sum(entry.file_size for entry in entries) > MAX_PROJECT_ARCHIVE_BYTES:
                    raise HTTPException(413, "Unpacked project archive exceeds the 2 GiB limit.")
                manifest_info = next((entry for entry in entries if entry.filename == "project.json"), None)
                if not manifest_info or manifest_info.file_size > MAX_MANIFEST_BYTES:
                    raise HTTPException(400, "Project archive has no valid project manifest.")
                try:
                    metadata = json.loads(archive.read(manifest_info).decode("utf-8"))
                    if not isinstance(metadata, dict):
                        raise ValueError("Manifest root must be a JSON object")
                    validate_project_manifest(metadata, Path(str(metadata.get("id", ""))), metadata.get("folderId"))
                except HTTPException as exc:
                    raise HTTPException(400, "Project archive manifest is invalid.") from exc
                except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
                    raise HTTPException(400, "Project archive manifest is invalid.") from exc

                source_entries = [entry for entry in entries if re.fullmatch(r"source\.(mp3|wav|flac|m4a|ogg)", entry.filename, flags=re.IGNORECASE)]
                if len(source_entries) != 1:
                    raise HTTPException(400, "Project archive must contain exactly one supported source audio file.")
                if source_entries[0].file_size == 0:
                    raise HTTPException(400, "Project archive source audio file is empty.")
                expected = {"project.json", source_entries[0].filename}
                expected.update(f"stems/{stem_names[name]}" for name in metadata["stems"])
                if set(names) != expected:
                    raise HTTPException(400, "Project archive files do not match the project stem list.")
                if any(archive.getinfo(name).file_size == 0 for name in expected - {"project.json"}):
                    raise HTTPException(400, "Project archive contains an empty audio file.")

                metadata["id"] = project_id
                metadata["folderId"] = folder_id
                metadata["schemaVersion"] = 1
                now = datetime.now(timezone.utc).isoformat()
                metadata["createdAt"] = now
                metadata["updatedAt"] = now
                validate_project_manifest(metadata, Path(project_id), folder_id)

                free_bytes = shutil.disk_usage(parent).free
                unpacked_bytes = sum(entry.file_size for entry in entries)
                if measure_tree_bytes(LIBRARY) + unpacked_bytes > MAX_LIBRARY_BYTES:
                    raise HTTPException(507, "Restoring this project would exceed the 20 GiB local project-library limit.")
                if free_bytes < unpacked_bytes + MIN_FREE_DISK_BYTES:
                    raise HTTPException(507, "There is not enough free disk space to restore this project.")

                staging.mkdir()
                copied_bytes = 0
                for member in expected - {"project.json"}:
                    entry = archive.getinfo(member)
                    relative = Path(member)
                    target = staging / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(entry, "r") as source_stream, target.open("wb") as target_stream:
                        while chunk := source_stream.read(1024 * 1024):
                            copied_bytes += len(chunk)
                            if copied_bytes > MAX_PROJECT_ARCHIVE_BYTES:
                                raise HTTPException(413, "Unpacked project archive exceeds the 2 GiB limit.")
                            target_stream.write(chunk)
                write_json_atomic(staging / "project.json", metadata)
                validate_project_manifest(metadata, Path(project_id), folder_id)
                os.replace(staging, destination)
                return metadata
        except (zipfile.BadZipFile, EOFError, zlib.error, NotImplementedError, RuntimeError) as exc:
            raise HTTPException(400, "Project archive is damaged or is not a ZIP file.") from exc
        except OSError as exc:
            raise HTTPException(500, f"Could not restore project archive: {exc}") from exc
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    return await run_in_threadpool(restore_archive)


@app.get("/api/library/projects/{project_id}")
def load_project(project_id: str):
    path = project_path(project_id)
    metadata = read_json(path / "project.json")
    metadata["audio"] = {name: f"/api/library/projects/{project_id}/{name}" for name in metadata.get("stems", [])}
    files = {"vocals": "vocals.wav", "accompaniment": "no_vocals.wav", "drums": "drums.wav", "bass": "bass.wav", "other": "other.wav"}
    try:
        stem_sizes = {name: (path / "stems" / files[name]).stat().st_size for name in metadata.get("stems", [])}
        metadata["stemDecodedBytes"] = {name: size * 2 for name, size in stem_sizes.items()}
        metadata["stemFileBytes"] = stem_sizes
    except OSError as exc:
        raise HTTPException(500, "One or more saved project audio files are missing.") from exc
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
    write_json_atomic(path / "project.json", metadata)
    return metadata


@app.put("/api/library/projects/{project_id}")
def update_project(project_id: str, payload: dict):
    path = project_path(project_id)
    metadata = read_json(path / "project.json")
    name = str(payload.get("name", metadata.get("name", ""))).strip()
    if not name or len(name) > 120:
        raise HTTPException(400, "Project name must contain 1 to 120 characters.")
    state = {
        "settings": payload.get("settings", metadata.get("settings", {})),
        "effects": payload.get("effects", metadata.get("effects", {})),
        "automation": payload.get("automation", metadata.get("automation", {})),
    }
    validate_project_state(state)
    metadata["name"] = name
    metadata.update(state)
    metadata["schemaVersion"] = 1
    metadata["updatedAt"] = datetime.now(timezone.utc).isoformat()
    write_json_atomic(path / "project.json", metadata)
    return metadata


@app.delete("/api/library/projects/{project_id}")
@serialized_cache_operation
async def delete_project(project_id: str, payload: dict):
    path = project_path(project_id)
    metadata = read_json(path / "project.json")
    if payload.get("confirmation") != metadata["name"]:
        raise HTTPException(409, "Type the exact project name to confirm its permanent deletion.")
    await run_in_threadpool(shutil.rmtree, path)
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


# Keep this outermost so streamed request bodies are limited before FastAPI's
# multipart parser writes upload data to its temporary spool.
app = RequestBodyLimitMiddleware(app)

