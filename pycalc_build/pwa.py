"""Write the small PWA sibling files next to the generated HTML.

The HTML itself stays self-contained.  These files only add installability and
offline caching for the `https://` build:
``manifest.json``, ``sw.js``, ``icon-192.png`` and ``icon-512.png``.
"""

from __future__ import annotations

import hashlib
import io
import json
import struct
import zlib
from pathlib import Path
from typing import Callable
from urllib.parse import quote

from .config import PROJECT_ROOT

ASSETS_DIR = PROJECT_ROOT / "pycalc_build" / "assets"
SW_TEMPLATE = ASSETS_DIR / "sw.js"
MANIFEST_SOURCE = ASSETS_DIR / "manifest.json"
ICON_FILES = {
    192: ASSETS_DIR / "icon-192.png",
    512: ASSETS_DIR / "icon-512.png",
}

PWA_FILENAMES = ("manifest.json", "sw.js", "icon-192.png", "icon-512.png")


def _write_if_changed(path: Path, data: bytes) -> bool:
    try:
        if path.read_bytes() == data:
            return False
    except OSError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    try:
        temp.write_bytes(data)
        temp.replace(path)
    finally:
        try:
            if temp.exists():
                temp.unlink()
        except OSError:
            pass
    return True


def _entry_for(output: Path) -> str:
    # Cache the actual page for local builds (dist/pycalc.html).  On Pages the
    # output is index.html, where "./" is both the page and the manifest scope.
    if output.name.lower() == "index.html":
        return "./"
    return "./" + quote(output.name, safe="")


def _make_icon_pillow(size: int) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGBA", (size, size), (32, 37, 46, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (size * 0.078, size * 0.078, size * 0.922, size * 0.922),
        radius=int(size * 0.22),
        fill=(37, 99, 235, 255),
        outline=(96, 165, 250, 180),
        width=max(1, int(size * 0.012)),
    )
    font = None
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    ]
    for candidate in candidates:
        try:
            if Path(candidate).exists():
                font = ImageFont.truetype(candidate, int(size * 0.41))
                break
        except OSError:
            continue
    if font is None:
        font = ImageFont.load_default()
    text = "Py"
    box = draw.textbbox((0, 0), text, font=font)
    width = box[2] - box[0]
    height = box[3] - box[1]
    draw.text(
        ((size - width) / 2 - box[0], (size - height) / 2 - box[1] - size * 0.02),
        text,
        font=font,
        fill=(255, 255, 255, 255),
    )
    draw.rounded_rectangle(
        (size * 0.27, size * 0.76, size * 0.73, size * 0.80),
        radius=int(size * 0.02),
        fill=(255, 255, 255, 210),
    )
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def _make_icon_zlib(size: int) -> bytes:
    """Dependency-free fallback: dark tile with a white ring."""

    raw = bytearray()
    center = (size - 1) / 2
    outer = size * 0.34
    inner = size * 0.25
    for y in range(size):
        raw.append(0)  # PNG filter: None
        for x in range(size):
            dx = x - center
            dy = y - center
            distance = (dx * dx + dy * dy) ** 0.5
            if inner <= distance <= outer:
                raw.extend((255, 255, 255, 255))
            elif distance < inner:
                raw.extend((37, 99, 235, 255))
            else:
                raw.extend((32, 37, 46, 255))
    signature = b"\x89PNG\r\n\x1a\n"
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        signature
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _png_chunk(b"IEND", b"")
    )


def _icon_bytes(size: int) -> bytes:
    path = ICON_FILES[size]
    try:
        return path.read_bytes()
    except OSError:
        pass
    try:
        return _make_icon_pillow(size)
    except Exception:
        return _make_icon_zlib(size)


def write_pwa_files(
    output: Path,
    html: str,
    log: Callable[[str], None] | None = None,
) -> list[Path]:
    """Write PWA siblings next to *output*; return their paths.

    The cache version is the first eight hex characters of the final HTML
    SHA256.  Rebuilding identical HTML therefore leaves sw.js untouched.
    """

    output = Path(output)
    output_dir = output.parent
    output_dir.mkdir(parents=True, exist_ok=True)
    version = hashlib.sha256(html.encode("utf-8")).hexdigest()[:8]
    entry = _entry_for(output)

    changed: list[str] = []

    manifest = MANIFEST_SOURCE.read_bytes()
    manifest_path = output_dir / "manifest.json"
    if _write_if_changed(manifest_path, manifest):
        changed.append("manifest.json")

    icon_paths: dict[int, Path] = {}
    for size in (192, 512):
        path = output_dir / f"icon-{size}.png"
        if _write_if_changed(path, _icon_bytes(size)):
            changed.append(path.name)
        icon_paths[size] = path

    sw_source = SW_TEMPLATE.read_text(encoding="utf-8")
    sw_source = sw_source.replace("__PYCALC_CACHE_VERSION__", version)
    sw_source = sw_source.replace("__PYCALC_ENTRY__", json.dumps(entry))
    sw_path = output_dir / "sw.js"
    if _write_if_changed(sw_path, sw_source.encode("utf-8")):
        changed.append("sw.js")

    if log is not None:
        files = ", ".join(changed) if changed else "unchanged"
        log(files)

    return [manifest_path, sw_path, icon_paths[192], icon_paths[512]]
