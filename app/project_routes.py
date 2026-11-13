from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import stat
import tempfile
import uuid
import zipfile
import zlib
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from .config import (
    ALLOWED, LIBRARY, MAX_LIBRARY_BYTES, MAX_PROJECT_ARCHIVE_BYTES, MIN_FREE_DISK_BYTES,
)
from .state import job_sources, job_stems
from .runtime import measure_tree_bytes, remove_temp_file, serialized_cache_operation

from .project_store import (
    clear_directory_children, folder_path, localized, project_path, read_json,
    safe_id, validate_folder_manifest, validate_project_manifest, validate_project_state,
    write_json_atomic,
)

router = APIRouter()

@router.get("/api/library")
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


@router.post("/api/library/folders")
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


@router.patch("/api/library/folders/{folder_id}")
def rename_folder(folder_id: str, payload: dict):
    path = folder_path(folder_id)
    name = str(payload.get("name", "")).strip()
    if not name or len(name) > 80:
        raise HTTPException(400, "Folder name must contain 1 to 80 characters.")
    folder = read_json(path / "folder.json")
    folder["name"] = name
    write_json_atomic(path / "folder.json", folder)
    return folder


@router.delete("/api/library/folders/{folder_id}")
@serialized_cache_operation
async def delete_folder(folder_id: str, payload: dict):
    path = folder_path(folder_id)
    folder = read_json(path / "folder.json")
    if payload.get("confirmation") != folder["name"]:
        raise HTTPException(409, "Type the exact folder name to confirm its permanent deletion.")
    await run_in_threadpool(shutil.rmtree, path)
    return {"deleted": True}


@router.post("/api/library/folders/{folder_id}/projects")
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


@router.get("/api/library/projects/{project_id}/archive")
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


@router.post("/api/library/folders/{folder_id}/projects/import")
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


@router.get("/api/library/projects/{project_id}")
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


@router.patch("/api/library/projects/{project_id}")
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


@router.put("/api/library/projects/{project_id}")
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


@router.delete("/api/library/projects/{project_id}")
@serialized_cache_operation
async def delete_project(project_id: str, payload: dict):
    path = project_path(project_id)
    metadata = read_json(path / "project.json")
    if payload.get("confirmation") != metadata["name"]:
        raise HTTPException(409, "Type the exact project name to confirm its permanent deletion.")
    await run_in_threadpool(shutil.rmtree, path)
    return {"deleted": True}


@router.get("/api/library/projects/{project_id}/{stem}")
def saved_stem(project_id: str, stem: str):
    if stem not in {"vocals", "accompaniment", "drums", "bass", "other"}:
        raise HTTPException(404, "Track not found.")
    filename = "no_vocals.wav" if stem == "accompaniment" else f"{stem}.wav"
    path = project_path(project_id) / "stems" / filename
    if not path.is_file():
        raise HTTPException(404, "Track not found.")
    return FileResponse(path, media_type="audio/wav", filename=f"{stem}.wav")


