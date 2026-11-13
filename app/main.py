from __future__ import annotations

import asyncio
import json
import shutil
import tempfile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
from urllib.parse import urlsplit
from fastapi.staticfiles import StaticFiles

from .config import *
from .state import (
    active_processes, cache_operation_lock, cancelled_separations, demucs_semaphore,
    job_sources, job_stems, pending_stem_deliveries, separation_states,
)

app = FastAPI(title="AudioSplit Studio")
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




@app.get("/")
def home():
    # The application shell loads static modules and component fragments itself.
    return FileResponse(ROOT / "app" / "static" / "index.html")




from .project_store import (
    clear_directory_children, folder_path, localized, project_path, read_json,
    safe_id, validate_folder_manifest, validate_project_manifest, validate_project_state,
    write_json_atomic,
)
from .runtime import (
    acknowledge_stem_delivery, expire_stem_leases, measure_tree_bytes,
    probe_duration, read_log_tail, remove_temp_file, run_demucs_with_progress,
    serialized_cache_operation, update_separation_state,
)


from .separation_routes import router as separation_router
from .project_routes import router as project_router

app.include_router(separation_router)
app.include_router(project_router)

# Keep this outermost so streamed request bodies are limited before FastAPI's
# multipart parser writes upload data to its temporary spool.
app = RequestBodyLimitMiddleware(app)
