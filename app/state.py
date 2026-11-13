import asyncio
import subprocess
from pathlib import Path

# Process-local state is intentionally ephemeral; project data lives in JSON files.
job_stems: dict[str, Path] = {}
job_sources: dict[str, Path] = {}
pending_stem_deliveries: dict[str, tuple[set[str], float]] = {}
separation_states: dict[str, dict] = {}
active_processes: dict[str, subprocess.Popen] = {}
cancelled_separations: set[str] = set()
demucs_semaphore = asyncio.Semaphore(1)
cache_operation_lock = asyncio.Lock()
