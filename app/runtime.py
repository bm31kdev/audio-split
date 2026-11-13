from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import tempfile
from functools import partial, wraps
from pathlib import Path

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from .config import ROOT, MAX_AUDIO_DURATION_SECONDS
from .state import (
    active_processes, cache_operation_lock, cancelled_separations,
    pending_stem_deliveries, separation_states,
)
from .project_store import localized

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


