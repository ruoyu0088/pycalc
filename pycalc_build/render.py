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
        raise RenderError(f"{label} contains </script and cannot be inlined safely")
    if "<!--" in source:
        raise RenderError(f"{label} contains <!-- and cannot be inlined safely")


def _read_text(path: Path, label: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise RenderError(f"Missing build asset: {label} ({path})") from exc


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
    i18n: dict,
    runtime_mode: str,
    asm_source: str,
    pyodide_js: str,
    plotly_js: str = "",
) -> str:
    template = _read_text(TEMPLATE_PATH, "page.html")
    css = _read_text(ASSETS_DIR / "app.css", "app.css")
    keyboard_css = _read_text(ASSETS_DIR / "keyboard.css", "keyboard.css")
    app_js = _read_text(ASSETS_DIR / "app.js", "app.js")
    keyboard_js = _read_text(ASSETS_DIR / "keyboard.js", "keyboard.js")
    worker_js = _read_text(ASSETS_DIR / "runtime_worker.js", "runtime_worker.js")
    glue = _read_text(ASSETS_DIR / "python_glue.py", "python_glue.py")
    editor_js = _editor_bundle()

    _check_inline_script(pyodide_js, "pyodide.js")
    _check_inline_script(app_js, "app.js")
    _check_inline_script(keyboard_js, "keyboard.js")
    _check_inline_script(worker_js, "runtime_worker.js")
    _check_inline_script(glue, "python_glue.py")
    _check_inline_script(asm_source, f"pyodide asm ({runtime_mode})")
    if plotly_js:
        _check_inline_script(plotly_js, "plotly.min.js")

    if runtime_mode == "esm":
        asm_block = (
            '<script type="text/plain" id="pycalc-asm-mjs">'
            + asm_source
            + "</script>"
        )
    else:
        asm_block = (
            '<script type="text/plain" id="pycalc-asm-js">'
            + asm_source
            + "</script>"
        )

    config_json = json.dumps(config, ensure_ascii=False, separators=(",", ":"))
    assets_json = json.dumps(assets, ensure_ascii=False, separators=(",", ":"))
    i18n_json = json.dumps(i18n, ensure_ascii=False, separators=(",", ":"))
    if (
        "</script" in config_json.lower()
        or "</script" in assets_json.lower()
        or "</script" in i18n_json.lower()
    ):
        raise RenderError("JSON payload contains </script and cannot be inlined")

    plotly_block = f"<script>{plotly_js}</script>" if plotly_js else ""

    replacements = {
        "__PYCALC_CSS__": css,
        "__PYCALC_KEYBOARD_CSS__": keyboard_css,
        "__PYCALC_KEYBOARD_JS__": keyboard_js,
        "__PYCALC_CONFIG__": config_json,
        "__PYCALC_ASSETS__": assets_json,
        "__PYCALC_I18N__": i18n_json,
        "__PYCALC_GLUE__": glue,
        "__PYCALC_ASM__": asm_block,
        "__PYCALC_PYODIDE_JS__": pyodide_js,
        "__PYCALC_WORKER_JS__": worker_js,
        "__PYCALC_EDITOR_JS__": editor_js,
        "__PYCALC_PLOTLY_JS__": plotly_block,
        "__PYCALC_APP_JS__": app_js,
    }
    page = template
    for token, value in replacements.items():
        if token not in page:
            raise RenderError(f"Template is missing placeholder {token}")
        page = page.replace(token, value, 1)

    if "__PYCALC_" in page:
        raise RenderError("Template still contains unreplaced placeholders")
    return page
