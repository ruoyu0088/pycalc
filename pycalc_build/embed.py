"""Turning binary assets into JSON-safe strings for the single HTML file."""

from __future__ import annotations

import base64
import gzip
from pathlib import Path


def encode_asset(
    raw: bytes,
    *,
    gzip_ok: bool = False,
) -> dict[str, object]:
    """Return ``{"enc": "raw"|"gzip", "size": int, "data": base64}``."""

    if gzip_ok:
        packed = gzip.compress(raw, compresslevel=9, mtime=0)
        # Very small or incompressible files are not worth the extra decode.
        if len(packed) + 64 < len(raw):
            return {
                "enc": "gzip",
                "size": len(raw),
                "data": base64.b64encode(packed).decode("ascii"),
            }
    return {
        "enc": "raw",
        "size": len(raw),
        "data": base64.b64encode(raw).decode("ascii"),
    }


def encode_file(path: Path, *, gzip_ok: bool = False) -> dict[str, object]:
    return encode_asset(path.read_bytes(), gzip_ok=gzip_ok)


def should_gzip_wheel(name: str) -> bool:
    # Wheels are ZIP archives and already deflated; gzip on top saves nothing.
    return False


def should_gzip_runtime(name: str) -> bool:
    # The wasm binary compresses ~3x.  python_stdlib.zip is a ZIP already.
    return name.endswith(".wasm")
