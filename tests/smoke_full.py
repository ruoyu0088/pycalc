from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cdp import Browser, file_url  # noqa: E402


def main() -> int:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "dist/pycalc.html").resolve()
    with Browser(file_url(target), timeout=180) as browser:
        browser.wait_ready(timeout=180)
        print("version:", browser.eval("window.__pycalcVersion || ''"))
        print("packages:", browser.eval("document.getElementById('engine-badge').textContent"))
        print("sympy:", json.dumps(browser.run_cell("import sympy as sp\nx = sp.symbols('x')\nprint(sp.integrate(x**2, x))"), ensure_ascii=False))
        print("numpy:", json.dumps(browser.run_cell("import numpy as np\na = np.array([1, 2, 3])\nprint(a.mean())"), ensure_ascii=False))
        result = browser.run_cell("import matplotlib.pyplot as plt\nplt.figure(figsize=(3, 2))\nplt.plot([1, 2, 3], [1, 4, 9])\nplt.title('demo')\nplt.show()")
        print("plot:", json.dumps(result, ensure_ascii=False))
        browser.screenshot(Path("dist/smoke-full.png"))
        print("network requests:", [u for u in browser.requests if u.startswith("http")])
        browser.eval("window.__pycalc.saveNow()")
        print("sessions:", json.dumps(browser.eval("window.__pycalc.sessions()"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
