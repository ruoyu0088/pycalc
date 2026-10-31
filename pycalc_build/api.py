"""Public build API shared by the CLI and the Tkinter GUI."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

from .cache import human_size
from .config import (
    APP_DB_NAME,
    APP_ID,
    APP_NAME,
    APP_VERSION,
    CACHE_DIR,
    DEFAULT_LIBS,
    DEFAULT_OUTPUT,
    DEFAULT_PYODIDE_VERSION,
    PERSISTENCE_PACKAGE,
    SCHEMA_VERSION,
)
from .embed import encode_file, should_gzip_runtime
from .i18n import MESSAGES, tr
from .render import render_page
from .resolve import Package, package_version_map, resolve_closure
from .runtime import RuntimeSpec, ensure_runtime, ensure_wheel

Log = Callable[[str], None]


@dataclass
class BuildConfig:
    libs: Iterable[str] = field(default_factory=lambda: list(DEFAULT_LIBS))
    output: Path = DEFAULT_OUTPUT
    pyodide_version: str = DEFAULT_PYODIDE_VERSION
    offline: bool = False
    refresh: bool = False
    gzip_wasm: bool = True
    fetch_only: bool = False
    lang: str = "en"


@dataclass
class BuildResult:
    output: Path | None
    size: int
    pyodide_version: str
    python_version: str
    runtime_mode: str
    packages: dict[str, str]
    user_libs: list[str]
    duration: float
    asset_count: int
    warnings: list[str] = field(default_factory=list)


def normalize_libs(libs: Iterable[str] | None) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in libs or []:
        for part in str(raw).replace(",", " ").split():
            name = part.strip()
            if not name or name in seen:
                continue
            seen.add(name)
            result.append(name)
    return result


def _make_logger(log: Log | None) -> Log:
    if log is not None:
        return log
    return print


def available_libraries(packages: Iterable[Package]) -> list[dict]:
    """Libraries that can be auto-imported by the generated HTML."""

    names = {pkg.name for pkg in packages}
    result: list[dict] = []
    if "numpy" in names:
        result.append({"id": "numpy", "label": "numpy", "alias": "np"})
    if "matplotlib" in names:
        result.append({"id": "pyplot", "label": "pyplot", "alias": "plt"})
    if "sympy" in names:
        result.append({"id": "sympy", "label": "sympy", "alias": "sp"})
    return result


def _ensure_wheels(
    spec: RuntimeSpec,
    packages: Iterable[Package],
    *,
    config: BuildConfig,
    log: Log,
) -> dict[str, Path]:
    paths: dict[str, Path] = {}
    for pkg in packages:
        if not pkg.file_name:
            raise RuntimeError(f"package {pkg.name} has no file_name")
        path = ensure_wheel(
            spec,
            pkg.file_name,
            pkg.sha256 or None,
            offline=config.offline,
            refresh=config.refresh,
            log=log,
            lang=config.lang,
        )
        paths[pkg.name] = path
    return paths


def build(config: BuildConfig, log: Log | None = None) -> BuildResult:
    started = time.time()
    say = _make_logger(log)
    user_libs = normalize_libs(config.libs)
    roots = list(user_libs)
    if PERSISTENCE_PACKAGE not in roots:
        roots.append(PERSISTENCE_PACKAGE)

    def t(key: str, **params) -> str:
        return tr(config.lang, key, **params)

    say(f"PyCalc {APP_VERSION} · Pyodide {config.pyodide_version}")
    say(t("build.requested", libs=", ".join(user_libs) if user_libs else "-"))

    spec = ensure_runtime(
        config.pyodide_version,
        cache_dir=CACHE_DIR,
        offline=config.offline,
        refresh=config.refresh,
        log=say,
        lang=config.lang,
    )
    closure = resolve_closure(spec.lock, roots)
    versions = package_version_map(closure)
    say(t("build.resolved", packages=", ".join(f"{name} {ver}" for name, ver in versions.items())))

    wheel_paths = _ensure_wheels(spec, closure, config=config, log=say)
    say(t(
        "build.prepared",
        count=len(wheel_paths),
        size=human_size(sum(p.stat().st_size for p in wheel_paths.values())),
    ))

    if config.fetch_only:
        elapsed = time.time() - started
        say(t("build.cacheOnly", duration=f"{elapsed:.1f}"))
        return BuildResult(
            output=None,
            size=0,
            pyodide_version=spec.version,
            python_version=spec.python_version,
            runtime_mode=spec.family,
            packages=versions,
            user_libs=user_libs,
            duration=elapsed,
            asset_count=0,
        )

    assets: dict[str, dict] = {}
    warnings: list[str] = []

    say(t("build.inlineRuntime"))
    for name in ("pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"):
        path = spec.assets[name]
        gzip_ok = config.gzip_wasm and should_gzip_runtime(name)
        assets[name] = encode_file(path, gzip_ok=gzip_ok)
        say(t(
            "build.inlineWheel",
            name=name,
            raw=human_size(path.stat().st_size),
            encoded=human_size(len(assets[name]["data"])),
        ))

    for pkg in closure:
        path = wheel_paths[pkg.name]
        assets[pkg.file_name] = encode_file(path, gzip_ok=False)
        say(t(
            "build.inlineWheel",
            name=pkg.file_name,
            raw=human_size(path.stat().st_size),
            encoded=human_size(len(assets[pkg.file_name]["data"])),
        ))

    asm_source = spec.asm_path.read_text(encoding="utf-8")
    pyodide_js = spec.assets["pyodide.js"].read_text(encoding="utf-8")

    page_config = {
        "appName": APP_NAME,
        "appVersion": APP_VERSION,
        "pyodideVersion": spec.version,
        "pythonVersion": spec.python_version,
        "runtimeMode": spec.family,
        "packages": roots,
        "packageVersions": versions,
        "libs": user_libs,
        "availableLibraries": available_libraries(closure),
        "gzipWasm": config.gzip_wasm,
        "dbName": APP_DB_NAME,
        "appId": APP_ID,
        "schemaVersion": SCHEMA_VERSION,
    }

    say(t("build.render"))
    html = render_page(
        config=page_config,
        assets=assets,
        i18n=MESSAGES,
        runtime_mode=spec.family,
        asm_source=asm_source,
        pyodide_js=pyodide_js,
    )

    output = Path(config.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(output.name + ".tmp")
    try:
        with temp.open("w", encoding="utf-8", newline="\n") as fh:
            fh.write(html)
        os.replace(temp, output)
    finally:
        if temp.exists():
            try:
                temp.unlink()
            except OSError:
                pass

    size = output.stat().st_size
    elapsed = time.time() - started
    say("-" * 64)
    say(t("build.output", path=str(output)))
    say(t("build.size", bytes=f"{size:,}", human=human_size(size)))
    say(t("build.runtime", pyodide=spec.version, python=spec.python_version, mode=spec.family))
    say(t("build.libs", libs=", ".join(f"{k} {v}" for k, v in versions.items())))
    say(t("build.assets", count=len(assets), duration=f"{elapsed:.1f}"))
    if size > 60 * 1024 * 1024:
        warnings.append("Output is larger than 60 MB; the first open may be slow.")

    return BuildResult(
        output=output,
        size=size,
        pyodide_version=spec.version,
        python_version=spec.python_version,
        runtime_mode=spec.family,
        packages=versions,
        user_libs=user_libs,
        duration=elapsed,
        asset_count=len(assets),
        warnings=warnings,
    )
