"""Global constants shared by the CLI, GUI and tests."""

from __future__ import annotations

from pathlib import Path

APP_NAME = "PyCalc"
APP_VERSION = "0.1.0"

# Absolute path of pycalc-app/ (the directory that contains build.py).
PROJECT_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = PROJECT_ROOT / "cache"
DIST_DIR = PROJECT_ROOT / "dist"
DEFAULT_OUTPUT = DIST_DIR / "pycalc.html"

DEFAULT_PYODIDE_VERSION = "314.0.7"

# Versions that have been exercised by the browser smoke tests.
# Other versions are probed automatically (classic asm.js or ESM asm.mjs).
KNOWN_VERSIONS: dict[str, dict[str, str]] = {
    "314.0.7": {"python": "3.14.2", "family": "esm"},
    "0.27.8": {"python": "3.12.7", "family": "classic"},
}

DEFAULT_LIBS = ["numpy", "sympy", "matplotlib"]
PERSISTENCE_PACKAGE = "cloudpickle"

CDN_TEMPLATE = "https://cdn.jsdelivr.net/pyodide/v{version}/full/"

# IndexedDB identity.  These values are injected into the generated HTML and
# must stay stable across rebuilds so that old sessions remain readable.
APP_DB_NAME = "pycalc-app-v1"
APP_ID = "pycalc-app-5c0f9e2a-8f4b-4f1e-9d7a-2b6c1e8f3a41"
SCHEMA_VERSION = 1

USER_AGENT = "PyCalc-Builder/0.1 (+https://github.com/)"
