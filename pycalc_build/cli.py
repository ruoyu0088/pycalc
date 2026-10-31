"""Command line interface for the PyCalc builder."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .api import BuildConfig, build
from .config import DEFAULT_OUTPUT, DEFAULT_PYODIDE_VERSION
from .resolve import selectable_packages
from .runtime import ensure_runtime


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="build.py",
        description="把 Pyodide 运行时和选定库打包成一个可双击运行的单文件 HTML。",
    )
    parser.add_argument(
        "--libs",
        nargs="*",
        default=None,
        metavar="NAME",
        help="要打包的库，例如 numpy sympy matplotlib；留空表示仅标准库。",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help=f"输出 HTML 路径（默认：{DEFAULT_OUTPUT}）",
    )
    parser.add_argument(
        "--pyodide-version",
        default=DEFAULT_PYODIDE_VERSION,
        help=f"Pyodide 版本（默认：{DEFAULT_PYODIDE_VERSION}）",
    )
    parser.add_argument("--offline", action="store_true", help="只使用缓存，不联网")
    parser.add_argument("--refresh", action="store_true", help="重新下载运行时和 wheel")
    parser.add_argument("--no-gzip", action="store_true", help="不压缩 wasm（文件更大，启动略快）")
    parser.add_argument("--fetch-only", action="store_true", help="只准备缓存，不生成 HTML")
    parser.add_argument("--list-libs", action="store_true", help="列出指定版本的可用库后退出")
    parser.add_argument("--json", action="store_true", help="构建结果以 JSON 输出到 stdout")
    parser.add_argument("--version", action="version", version="PyCalc 0.1.0")
    return parser


def _list_libs(version: str, *, offline: bool, refresh: bool, log) -> int:
    spec = ensure_runtime(version, offline=offline, refresh=refresh, log=log)
    packages = selectable_packages(spec.lock)
    for name in sorted(packages):
        pkg = packages[name]
        deps = f"  -> {', '.join(pkg.depends)}" if pkg.depends else ""
        print(f"{name:24} {pkg.version:16}{deps}")
    print(f"\n共 {len(packages)} 个可安装包（Pyodide {spec.version}, Python {spec.python_version}）。")
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    args = _parser().parse_args(argv)
    log_stream = sys.stderr if args.json else sys.stdout

    def log(message: str = "") -> None:
        print(message, file=log_stream, flush=True)

    try:
        if args.list_libs:
            return _list_libs(
                args.pyodide_version,
                offline=args.offline,
                refresh=args.refresh,
                log=log,
            )

        config = BuildConfig(
            libs=args.libs or [],
            output=Path(args.output),
            pyodide_version=args.pyodide_version,
            offline=args.offline,
            refresh=args.refresh,
            gzip_wasm=not args.no_gzip,
            fetch_only=args.fetch_only,
        )
        result = build(config, log=log)
        if args.json:
            payload = {
                "output": str(result.output) if result.output else None,
                "size": result.size,
                "pyodide_version": result.pyodide_version,
                "python_version": result.python_version,
                "runtime_mode": result.runtime_mode,
                "packages": result.packages,
                "libs": result.user_libs,
                "duration": round(result.duration, 3),
                "assets": result.asset_count,
                "warnings": result.warnings,
            }
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except KeyboardInterrupt:
        print("\n已取消。", file=sys.stderr)
        return 130
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(f"\n构建失败：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
