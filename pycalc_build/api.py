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
            raise RuntimeError(f"包 {pkg.name} 没有 file_name")
        path = ensure_wheel(
            spec,
            pkg.file_name,
            pkg.sha256 or None,
            offline=config.offline,
            refresh=config.refresh,
            log=log,
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

    say(f"PyCalc {APP_VERSION} · Pyodide {config.pyodide_version}")
    say(f"请求的库：{', '.join(user_libs) if user_libs else '（仅标准库）'}")

    spec = ensure_runtime(
        config.pyodide_version,
        cache_dir=CACHE_DIR,
        offline=config.offline,
        refresh=config.refresh,
        log=say,
    )
    closure = resolve_closure(spec.lock, roots)
    versions = package_version_map(closure)
    say(
        "解析到 "
        + ", ".join(f"{name} {ver}" for name, ver in versions.items())
    )

    wheel_paths = _ensure_wheels(spec, closure, config=config, log=say)
    say(f"已准备 {len(wheel_paths)} 个 wheel，共 "
        f"{human_size(sum(p.stat().st_size for p in wheel_paths.values()))}")

    if config.fetch_only:
        elapsed = time.time() - started
        say(f"缓存准备完成，用时 {elapsed:.1f}s；未生成 HTML（--fetch-only）。")
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

    for name in ("pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"):
        path = spec.assets[name]
        gzip_ok = config.gzip_wasm and should_gzip_runtime(name)
        assets[name] = encode_file(path, gzip_ok=gzip_ok)
        encoded_size = len(assets[name]["data"])
        say(
            f"内联 {name}: {human_size(path.stat().st_size)}"
            f" -> {human_size(encoded_size)} base64"
            + (" (gzip)" if assets[name]["enc"] == "gzip" else "")
        )

    for pkg in closure:
        path = wheel_paths[pkg.name]
        assets[pkg.file_name] = encode_file(path, gzip_ok=False)
        say(
            f"内联 {pkg.file_name}: {human_size(path.stat().st_size)}"
            f" -> {human_size(len(assets[pkg.file_name]['data']))} base64"
        )

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
        "gzipWasm": config.gzip_wasm,
        "dbName": APP_DB_NAME,
        "appId": APP_ID,
        "schemaVersion": SCHEMA_VERSION,
    }

    say("渲染单文件 HTML…")
    html = render_page(
        config=page_config,
        assets=assets,
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
    say(f"输出：{output}")
    say(f"大小：{size:,} 字节（{human_size(size)}）")
    say(
        f"运行时：Pyodide {spec.version} / Python {spec.python_version} / {spec.family}"
    )
    say(f"库：{', '.join(f'{k} {v}' for k, v in versions.items())}")
    say(f"资源数：{len(assets)}；用时 {elapsed:.1f}s")
    if size > 60 * 1024 * 1024:
        warnings.append("输出文件超过 60 MB，首次打开会比较慢。")

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
