"""Assemble the single-file HTML from template, runtime text and assets."""

from __future__ import annotations

import json
from pathlib import Path

from .config import PROJECT_ROOT

ASSETS_DIR = PROJECT_ROOT / "pycalc_build" / "assets"
TEMPLATE_PATH = PROJECT_ROOT / "pycalc_build" / "templates" / "page.html"


class RenderError(RuntimeError):
    pass


def _check_inline_script(source: str, label: str) -> None:
    lowered = source.lower()
    if "</script" in lowered:
        raise RenderError(f"{label} 中含有 </script，无法安全内联")
    if "<!--" in source:
        raise RenderError(f"{label} 中含有 <!--，无法安全内联")


def _read_text(path: Path, label: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise RenderError(f"缺少构建资源：{label}（{path}）") from exc


def _editor_bundle() -> str:
    path = ASSETS_DIR / "editor.bundle.js"
    if path.exists():
        source = path.read_text(encoding="utf-8")
        _check_inline_script(source, "CodeMirror bundle")
        return f"<script>{source}</script>"
    return ""


def render_page(
    *,
    config: dict,
    assets: dict[str, dict],
    runtime_mode: str,
    asm_source: str,
    pyodide_js: str,
) -> str:
    template = _read_text(TEMPLATE_PATH, "page.html")
    css = _read_text(ASSETS_DIR / "app.css", "app.css")
    app_js = _read_text(ASSETS_DIR / "app.js", "app.js")
    glue = _read_text(ASSETS_DIR / "python_glue.py", "python_glue.py")
    editor_js = _editor_bundle()

    _check_inline_script(pyodide_js, "pyodide.js")
    _check_inline_script(app_js, "app.js")
    _check_inline_script(glue, "python_glue.py")
    _check_inline_script(asm_source, f"pyodide asm ({runtime_mode})")

    if runtime_mode == "esm":
        asm_block = (
            '<script type="text/plain" id="pycalc-asm-mjs">'
            + asm_source
            + "</script>"
        )
    else:
        asm_block = "<script>" + asm_source + "</script>"

    config_json = json.dumps(config, ensure_ascii=False, separators=(",", ":"))
    assets_json = json.dumps(assets, ensure_ascii=False, separators=(",", ":"))
    if "</script" in config_json.lower() or "</script" in assets_json.lower():
        raise RenderError("配置或资源 JSON 中含有 </script，无法安全内联")

    replacements = {
        "__PYCALC_CSS__": css,
        "__PYCALC_CONFIG__": config_json,
        "__PYCALC_ASSETS__": assets_json,
        "__PYCALC_GLUE__": glue,
        "__PYCALC_ASM__": asm_block,
        "__PYCALC_PYODIDE_JS__": pyodide_js,
        "__PYCALC_EDITOR_JS__": editor_js,
        "__PYCALC_APP_JS__": app_js,
    }
    page = template
    for token, value in replacements.items():
        if token not in page:
            raise RenderError(f"模板缺少占位符 {token}")
        page = page.replace(token, value, 1)

    if "__PYCALC_" in page:
        raise RenderError("模板中仍存在未替换的占位符")
    return page
