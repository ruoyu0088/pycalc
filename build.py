#!/usr/bin/env python3
"""PyCalc single-file build entry point.

Examples:
    python build.py --libs numpy sympy matplotlib
    python build.py --libs numpy --pyodide-version 0.27.8 --output dist/pycalc-027.html
"""

from __future__ import annotations

import sys
from pathlib import Path

# Windows consoles may default to a legacy encoding (cp932/cp936/cp1252) that
# cannot represent Chinese log messages.  Make output UTF-8 and never crash on
# an unencodable glyph.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pycalc_build.cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
