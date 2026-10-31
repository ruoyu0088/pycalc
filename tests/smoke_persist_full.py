from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cdp import Browser, file_url  # noqa: E402


def check(browser: Browser, label: str):
    print(label, "active:", json.dumps(browser.eval("window.__pycalc.active()"), ensure_ascii=False))
    print(label, "sessions:", json.dumps(browser.eval("window.__pycalc.sessions()"), ensure_ascii=False))
    print(label, "images in history:", json.dumps(browser.eval("window.__pycalc.history().map(e => e.images)"), ensure_ascii=False))
    print(label, "img elements:", browser.eval("document.querySelectorAll('#history img').length"))


def main() -> int:
    target = Path("dist/pycalc.html").resolve()
    profile = Path("dist/profile-persist").resolve()
    shutil.rmtree(profile, ignore_errors=True)
    with Browser(file_url(target), profile=profile, timeout=180) as browser:
        browser.wait_ready(timeout=180)
        browser.eval("window.__pycalc.createSession('持久化测试')")
        browser.wait_ready()
        result = browser.run_cell(
            "import numpy as np\n"
            "import matplotlib.pyplot as plt\n"
            "def twice(x):\n    return x * 2\n"
            "data = np.arange(5)\n"
            "plt.figure(figsize=(2.5, 1.8))\n"
            "plt.plot(data, data ** 2)\n"
            "plt.show()\n"
            "print(twice(21))"
        )
        print("run:", json.dumps(result, ensure_ascii=False))
        browser.eval("window.__pycalc.saveNow()")
        check(browser, "original")
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready(timeout=180)
        check(browser, "after reload")
        print("twice:", json.dumps(browser.run_cell("print(twice(21))"), ensure_ascii=False))
        browser.eval("window.__pycalc.saveNow()")

        # copy the HTML elsewhere; same browser profile -> same IndexedDB
        copy_dir = Path("dist/copy").resolve()
        copy_dir.mkdir(parents=True, exist_ok=True)
        copied = copy_dir / "pycalc.html"
        shutil.copyfile(target, copied)
        browser.call("Page.navigate", {"url": file_url(copied)})
        browser.wait_ready(timeout=180)
        check(browser, "copied path")
        print("twice copy:", json.dumps(browser.run_cell("print(twice(21))"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
