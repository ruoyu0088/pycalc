"""Resolve, download and describe a Pyodide runtime.

Two layouts exist in the wild:

* classic (0.27.x / 0.28.x / 0.29.x): ``pyodide.asm.js`` is a classic script
  that defines a global ``_createPyodideModule``.
* ESM (314.x): ``pyodide.asm.mjs`` exports ``_createPyodideModule`` and must be
  imported, then passed to ``loadPyodide({createPyodideModule})``.

The rest of the build pipeline is identical for both layouts.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .cache import DownloadError, NotFound, OfflineMissing, download, ensure_sha256
from .config import CACHE_DIR, CDN_TEMPLATE, KNOWN_VERSIONS

_VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._-]*$")


@dataclass
class RuntimeSpec:
    version: str
    python_version: str
    family: str  # "classic" | "esm"
    asm_name: str
    runtime_dir: Path
    lock_path: Path
    lock: dict
    assets: dict[str, Path] = field(default_factory=dict)

    @property
    def asm_path(self) -> Path:
        return self.assets[self.asm_name]

    @property
    def cdn_url(self) -> str:
        return CDN_TEMPLATE.format(version=self.version)

    def wheel_url(self, file_name: str) -> str:
        return self.cdn_url + file_name


def validate_version(version: str) -> str:
    version = (version or "").strip()
    if not _VERSION_RE.match(version):
        raise ValueError(f"Invalid Pyodide version: {version!r}")
    return version


def _read_lock(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    if "packages" not in data or not isinstance(data["packages"], dict):
        raise DownloadError(f"Invalid pyodide-lock.json: {path}")
    return data


def _probe_family(
    version: str,
    runtime_dir: Path,
    *,
    offline: bool,
    refresh: bool,
    log: Callable[[str], None] | None,
    lang: str = "en",
) -> str:
    known = KNOWN_VERSIONS.get(version)
    if known:
        return known["family"]

    classic = runtime_dir / "pyodide.asm.js"
    esm = runtime_dir / "pyodide.asm.mjs"
    if classic.exists():
        return "classic"
    if esm.exists():
        return "esm"
    if offline:
        raise OfflineMissing(
            f"Cannot determine the runtime layout for Pyodide {version} in offline mode; "
            f"cache directory: {runtime_dir}"
        )
    try:
        download(
            CDN_TEMPLATE.format(version=version) + "pyodide.asm.js",
            classic,
            refresh=refresh,
            log=log,
            lang=lang,
        )
        return "classic"
    except NotFound:
        download(
            CDN_TEMPLATE.format(version=version) + "pyodide.asm.mjs",
            esm,
            refresh=refresh,
            log=log,
            lang=lang,
        )
        return "esm"


def ensure_runtime(
    version: str,
    *,
    cache_dir: Path | None = None,
    offline: bool = False,
    refresh: bool = False,
    log: Callable[[str], None] | None = None,
    lang: str = "en",
) -> RuntimeSpec:
    version = validate_version(version)
    base = Path(cache_dir) if cache_dir else CACHE_DIR
    runtime_dir = base / "pyodide" / version
    runtime_dir.mkdir(parents=True, exist_ok=True)

    def say(msg: str) -> None:
        if log:
            log(msg)

    lock_path = runtime_dir / "pyodide-lock.json"
    download(
        CDN_TEMPLATE.format(version=version) + "pyodide-lock.json",
        lock_path,
        offline=offline,
        refresh=refresh,
        log=log,
        lang=lang,
    )
    lock = _read_lock(lock_path)
    info = lock.get("info") or {}
    python_version = str(info.get("python") or KNOWN_VERSIONS.get(version, {}).get("python") or "unknown")

    family = _probe_family(
        version, runtime_dir, offline=offline, refresh=refresh, log=log, lang=lang
    )
    asm_name = "pyodide.asm.js" if family == "classic" else "pyodide.asm.mjs"

    assets: dict[str, Path] = {"pyodide-lock.json": lock_path}
    for name in ("pyodide.js", asm_name, "pyodide.asm.wasm", "python_stdlib.zip"):
        path = runtime_dir / name
        download(
            CDN_TEMPLATE.format(version=version) + name,
            path,
            offline=offline,
            refresh=refresh,
            log=log,
            lang=lang,
        )
        assets[name] = path

    say(
        f"Pyodide {version} ({family}, Python {python_version}) "
        f"cached in {runtime_dir}"
    )
    return RuntimeSpec(
        version=version,
        python_version=python_version,
        family=family,
        asm_name=asm_name,
        runtime_dir=runtime_dir,
        lock_path=lock_path,
        lock=lock,
        assets=assets,
    )


def ensure_wheel(
    spec: RuntimeSpec,
    file_name: str,
    sha256: str | None,
    *,
    base_cache_dir: Path | None = None,
    offline: bool = False,
    refresh: bool = False,
    log: Callable[[str], None] | None = None,
    lang: str = "en",
) -> Path:
    base = Path(base_cache_dir) if base_cache_dir else CACHE_DIR
    dest = base / "wheels" / spec.version / file_name
    download(
        spec.wheel_url(file_name),
        dest,
        offline=offline,
        refresh=refresh,
        log=log,
        lang=lang,
    )
    if sha256:
        try:
            ensure_sha256(dest, sha256, log)
        except DownloadError:
            if offline:
                raise
            # A corrupt cache entry should not require a manual cleanup.
            if log:
                log(f"[retry] checksum failed for {file_name}; downloading again")
            try:
                dest.unlink()
            except OSError:
                pass
            download(
                spec.wheel_url(file_name),
                dest,
                offline=False,
                refresh=True,
                log=log,
                lang=lang,
            )
            ensure_sha256(dest, sha256, log)
    return dest
