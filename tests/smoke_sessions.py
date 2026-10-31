from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cdp import Browser, file_url  # noqa: E402


def show(label, value):
    print(label, json.dumps(value, ensure_ascii=False))


def main() -> int:
    target = Path("dist/pycalc-min.html").resolve()
    profile = Path("dist/profile-sessions").resolve()
    with Browser(file_url(target), profile=profile) as browser:
        browser.wait_ready()
        # A
        a_id = browser.eval("window.__pycalc.createSession('会话 A')")
        browser.wait_ready()
        show("A run", browser.run_cell("a = 10\ndef f(x):\n    return x * 2 + a\nprint(f(20))"))
        browser.eval("window.__pycalc.saveNow()")
        # B
        b_id = browser.eval("window.__pycalc.createSession('会话 B')")
        browser.wait_ready()
        show("B run", browser.run_cell("b = 100\ndef g(x):\n    return x + b\nprint(g(1))"))
        browser.eval("window.__pycalc.saveNow()")
        show("sessions", browser.eval("window.__pycalc.sessions()"))
        # back to A
        browser.eval(f"window.__pycalc.switchSession({json.dumps(a_id)})")
        browser.wait_ready()
        show("back A", browser.eval("window.__pycalc.active()"))
        show("A f", browser.run_cell("print(f(20)); print('b' in globals())"))
        # B
        browser.eval(f"window.__pycalc.switchSession({json.dumps(b_id)})")
        browser.wait_ready()
        show("back B", browser.eval("window.__pycalc.active()"))
        show("B g", browser.run_cell("print(g(1)); print('a' in globals())"))
        browser.eval("window.__pycalc.saveNow()")
        # reload
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready()
        show("after reload active", browser.eval("window.__pycalc.active()"))
        show("after reload sessions", browser.eval("window.__pycalc.sessions()"))
        show("B g after reload", browser.run_cell("print(g(1))"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
