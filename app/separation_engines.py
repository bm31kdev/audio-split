"""Supported local Demucs models and compatibility names for older projects."""

from __future__ import annotations

ENGINE_CONFIGS = {
    "mdx": {"model": "mdx", "segment": "4", "overlap": "0.1"},
    "mdx_extra": {"model": "mdx_extra", "segment": "4", "overlap": "0.1"},
    "htdemucs": {"model": "htdemucs", "segment": "6", "overlap": "0.15"},
    "htdemucs_ft": {"model": "htdemucs_ft", "segment": "6", "overlap": "0.15"},
}

ENGINE_ALIASES = {"fast": "mdx", "studio": "htdemucs"}
SUPPORTED_ENGINES = frozenset((*ENGINE_CONFIGS, *ENGINE_ALIASES))


def normalize_engine(engine: str) -> str:
    """Map the previous Fast/Studio values to their current Demucs model IDs."""
    return ENGINE_ALIASES.get(engine, engine)
