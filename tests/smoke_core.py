from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cdp import Browser, file_url  # noqa: E402


def main() -> int:
    target = Path("dist/pycalc-min.html").resolve()
    profile = Path("dist/profile-core").resolve()
    with Browser(file_url(target), profile=profile) as browser:
        browser.wait_ready()
        print("stdout test:", json.dumps(browser.run_cell("print(1); print(2)"), ensure_ascii=False))
        print("def test:", json.dumps(browser.run_cell("def f(x):\n    return x * 2\nprint(f(21))"), ensure_ascii=False))
        browser.eval("window.__pycalc.saveNow()")
        print("sessions:", json.dumps(browser.eval("window.__pycalc.sessions()"), ensure_ascii=False))
        print("history:", json.dumps(browser.eval("window.__pycalc.history()"), ensure_ascii=False))
        Path("dist").mkdir(exist_ok=True)
        browser.screenshot(Path("dist/smoke-core-1.png"))
        # reload in the same browser context
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready()
        print("after reload history:", json.dumps(browser.eval("window.__pycalc.history()"), ensure_ascii=False))
        print("after reload f:", json.dumps(browser.run_cell("print(f(21))"), ensure_ascii=False))
        browser.screenshot(Path("dist/smoke-core-2.png"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
