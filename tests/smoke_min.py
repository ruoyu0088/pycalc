"""Quick manual smoke test for a built PyCalc HTML."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cdp import Browser, file_url  # noqa: E402


def main() -> int:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "dist/pycalc-min.html")
    if not target.exists():
        print(f"找不到 {target}", file=sys.stderr)
        return 2
    with Browser(file_url(target)) as browser:
        browser.wait_ready()
        print("title:", browser.eval("document.title"))
        print("engine:", browser.eval("window.__pycalc.engine()"))
        print("sessions:", json.dumps(browser.eval("window.__pycalc.sessions()"), ensure_ascii=False))
        result = browser.run_cell("print('hello from pycalc'); 1 + 1")
        print("run:", json.dumps(result, ensure_ascii=False))
        browser.eval("window.__pycalc.saveNow()")
        print("network requests:", [u for u in browser.requests if u.startswith("http")])
        Path("dist").mkdir(exist_ok=True)
        browser.screenshot(Path("dist/smoke-min.png"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
