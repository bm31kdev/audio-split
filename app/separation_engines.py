"""Supported local Demucs models and compatibility names for older projects."""

from __future__ import annotations

ENGINE_CONFIGS = {
    "mdx": {"model": "mdx", "segment": "4", "overlap": "0.1"},
    # Shorter windows trade a little separation quality for faster CPU runs.
    "mdx_fast": {"model": "mdx", "segment": "2", "overlap": "0.05"},
    "mdx_extra": {"model": "mdx_extra", "segment": "4", "overlap": "0.1"},
    "mdx_extra_fast": {"model": "mdx_extra", "segment": "2", "overlap": "0.05"},
    "htdemucs": {"model": "htdemucs", "segment": "6", "overlap": "0.15"},
    "htdemucs_fast": {"model": "htdemucs", "segment": "4", "overlap": "0.05"},
    "htdemucs_ft": {"model": "htdemucs_ft", "segment": "6", "overlap": "0.15"},
    # Official alternate checkpoint; unlike the quantized MDX models, it does
    # not require DiffQ at runtime.
    "hdemucs_mmi": {"model": "hdemucs_mmi", "segment": "6", "overlap": "0.1"},
}

ENGINE_ALIASES = {"fast": "mdx", "studio": "htdemucs"}
SUPPORTED_ENGINES = frozenset((*ENGINE_CONFIGS, *ENGINE_ALIASES))


def normalize_engine(engine: str) -> str:
    """Map the previous Fast/Studio values to their current Demucs model IDs."""
    return ENGINE_ALIASES.get(engine, engine)
