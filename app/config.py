from pathlib import Path

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

for directory in (JOBS, UPLOADS, LIBRARY):
    directory.mkdir(parents=True, exist_ok=True)
