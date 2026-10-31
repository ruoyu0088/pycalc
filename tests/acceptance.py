#!/usr/bin/env python3
"""End-to-end PyCalc acceptance tests.

Run from pycalc-app/:

    python tests/acceptance.py

Builds fresh minimal and full HTML files, drives the installed Chrome/Edge via
CDP, and verifies session persistence, copying, rebuilding and both runtime
layouts.
"""

from __future__ import annotations

import json
import shutil
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from cdp import Browser, file_url  # noqa: E402
from pycalc_build import BuildConfig, build  # noqa: E402

OUT = ROOT / "dist" / "acceptance"
ART = ROOT / "tests" / "artifacts"


def log(message: str) -> None:
    print(message, flush=True)


def build_case(name: str, libs: list[str], version: str) -> Path:
    output = OUT / name
    result = build(
        BuildConfig(libs=libs, output=output, pyodide_version=version),
        log=lambda message: None,
    )
    assert result.output and result.output.exists()
    assert result.size > 1_000_000
    log(f"  built {name}: {result.size:,} bytes, {result.python_version}, {result.runtime_mode}")
    return result.output


def press(browser: Browser, name: str, code: str, vk: int) -> None:
    for event_type in ("keyDown", "keyUp"):
        browser.call(
            "Input.dispatchKeyEvent",
            {
                "type": event_type,
                "key": name,
                "code": code,
                "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk,
            },
        )


def wait_idle(browser: Browser, timeout: float = 60.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = browser.eval("(window.__pycalc.lastEntry() || {}).status || ''")
        if status != "running":
            return
        time.sleep(0.1)
    raise TimeoutError("execution did not finish")


def assert_no_network(browser: Browser) -> None:
    external = [url for url in browser.requests if url.startswith(("http://", "https://"))]
    assert not external, f"unexpected external requests: {external[:5]}"


def run_and_check(browser: Browser, code: str, expected_stdout: str) -> None:
    result = browser.run_cell(code)
    assert result["status"] == "ok", result
    assert result["stdout"] == expected_stdout, (result["stdout"], expected_stdout)


def test_minimal_314() -> None:
    log("[1] minimal build / 314.0.7")
    html = build_case("min314.html", [], "314.0.7")
    profile = OUT / "profiles" / "min314"
    shutil.rmtree(profile, ignore_errors=True)
    with Browser(file_url(html), profile=profile, timeout=120) as browser:
        browser.wait_ready()
        version = browser.eval("window.__pycalcVersion")
        assert version["pyodide"] == "314.0.7" and version["python"] == "3.14.2", version
        assert browser.eval("window.__pycalc.engine()") == "cloudpickle"
        run_and_check(browser, "print(1 + 1)", "2\n")
        assert browser.eval("window.__pycalc.getEditorValue()") == ""
        run_and_check(browser, "print(sin(pi / 2))", "1.0\n")
        assert browser.eval("document.querySelectorAll('.cell').length") == 0
        assert browser.eval("document.querySelectorAll('.entry').length") >= 2
        assert_no_network(browser)

        run_and_check(
            browser,
            "def f(x):\n    return x * 2\nprint(f(21))",
            "42\n",
        )
        browser.eval("window.__pycalc.saveNow()")
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready()
        run_and_check(browser, "print(f(21))", "42\n")
        browser.screenshot(ART / "min314.png")

        # multi-session isolation
        a_id = browser.eval("window.__pycalc.createSession('会话 A')")
        browser.wait_ready()
        run_and_check(browser, "a = 10\ndef fa(x):\n    return x * 2 + a\nprint(fa(20))", "50\n")
        browser.eval("window.__pycalc.saveNow()")
        b_id = browser.eval("window.__pycalc.createSession('会话 B')")
        browser.wait_ready()
        run_and_check(browser, "b = 100\ndef fb(x):\n    return x + b\nprint(fb(1))", "101\n")
        browser.eval("window.__pycalc.saveNow()")

        browser.eval(f"window.__pycalc.switchSession({json.dumps(a_id)})")
        browser.wait_ready()
        run_and_check(browser, "print(fa(20)); print('b' in globals())", "50\nFalse\n")
        browser.eval(f"window.__pycalc.switchSession({json.dumps(b_id)})")
        browser.wait_ready()
        run_and_check(browser, "print(fb(1)); print('a' in globals())", "101\nFalse\n")
        browser.eval("window.__pycalc.saveNow()")

        # rename + delete a temporary session
        assert browser.eval("window.__pycalc.renameSession('会话 B2')") is True
        assert browser.eval("window.__pycalc.active()")["name"] == "会话 B2"
        temp_id = browser.eval("window.__pycalc.createSession('临时会话')")
        browser.wait_ready()
        assert browser.eval("window.__pycalc.active()")["name"] == "临时会话"
        assert browser.eval(f"window.__pycalc.deleteSession({json.dumps(temp_id)})") is True
        browser.wait_ready()
        names_now = [s["name"] for s in browser.eval("window.__pycalc.sessions()")]
        assert "临时会话" not in names_now, names_now
        assert browser.eval("window.__pycalc.active()")["name"] == "会话 B2"
        run_and_check(browser, "print(fb(1))", "101\n")
        browser.eval("window.__pycalc.saveNow()")

        # copy the HTML to another directory: same browser profile -> same DB
        copied = OUT / "copied" / "min314.html"
        copied.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(html, copied)
        browser.call("Page.navigate", {"url": file_url(copied)})
        browser.wait_ready()
        names = [s["name"] for s in browser.eval("window.__pycalc.sessions()")]
        assert "会话 A" in names and "会话 B2" in names, names
        assert browser.eval("window.__pycalc.active()")["name"] == "会话 B2"
        run_and_check(browser, "print(fb(1))", "101\n")

    # rebuild a new HTML (same version) and reopen with the same profile
    rebuilt = build_case("min314-rebuilt.html", [], "314.0.7")
    with Browser(file_url(rebuilt), profile=profile, timeout=120) as browser:
        browser.wait_ready()
        names = [s["name"] for s in browser.eval("window.__pycalc.sessions()")]
        assert "会话 A" in names and "会话 B2" in names, names
        assert browser.eval("window.__pycalc.active()")["name"] == "会话 B2"
        run_and_check(browser, "print(fb(1))", "101\n")
    log("  PASS minimal 314")


def test_full_314() -> None:
    log("[2] full build / 314.0.7")
    html = build_case("full314.html", ["numpy", "sympy", "matplotlib"], "314.0.7")
    profile = OUT / "profiles" / "full314"
    shutil.rmtree(profile, ignore_errors=True)
    with Browser(file_url(html), profile=profile, timeout=180) as browser:
        browser.wait_ready(timeout=180)
        run_and_check(
            browser,
            "import sympy as sp\nx = sp.symbols('x')\nprint(sp.integrate(x**2, x))",
            "x**3/3\n",
        )
        run_and_check(
            browser,
            "import numpy as np\nprint(np.array([1, 2, 3]).mean())",
            "2.0\n",
        )
        result = browser.run_cell(
            "import matplotlib.pyplot as plt\n"
            "plt.figure(figsize=(3, 2))\n"
            "plt.plot([1, 2, 3], [1, 4, 9])\n"
            "plt.title('acceptance')\n"
            "plt.show()"
        )
        assert result["status"] == "ok", result
        assert result["images"] == 1, result
        assert browser.eval("document.querySelectorAll('#console img').length") >= 1
        assert_no_network(browser)
        browser.screenshot(ART / "full314.png")
    log("  PASS full 314")


def test_full_0278() -> None:
    log("[3] full build / 0.27.8 classic")
    html = build_case("full0278.html", ["numpy", "sympy", "matplotlib"], "0.27.8")
    profile = OUT / "profiles" / "full0278"
    shutil.rmtree(profile, ignore_errors=True)
    with Browser(file_url(html), profile=profile, timeout=180) as browser:
        browser.wait_ready(timeout=180)
        version = browser.eval("window.__pycalcVersion")
        assert version["pyodide"] == "0.27.8", version
        assert version["runtime"] == "classic", version
        run_and_check(
            browser,
            "import sympy as sp\nx = sp.symbols('x')\nprint(sp.integrate(x**2, x))",
            "x**3/3\n",
        )
        run_and_check(
            browser,
            "import numpy as np\nprint(np.array([1, 2, 3]).mean())",
            "2.0\n",
        )
        result = browser.run_cell(
            "import matplotlib.pyplot as plt\n"
            "plt.figure(figsize=(2.5, 1.8))\n"
            "plt.plot([1, 2, 3])\n"
            "plt.show()"
        )
        assert result["status"] == "ok" and result["images"] == 1, result
        assert_no_network(browser)
    log("  PASS full 0.27.8")


def test_new_features() -> None:
    log("[4] languages, libraries, tables, compact console, editor behaviour")
    html = OUT / "full314.html"
    profile = OUT / "profiles" / "new-features"
    shutil.rmtree(profile, ignore_errors=True)
    with Browser(file_url(html), profile=profile, timeout=180) as browser:
        browser.wait_ready(timeout=180)
        browser.eval("window.__pycalc.setLanguage('en')")
        assert browser.eval("document.querySelector('.side-card h3').textContent") == "Variables"
        browser.eval("window.__pycalc.setLanguage('ja')")
        assert browser.eval("document.querySelector('.side-card h3').textContent") == "変数"
        browser.eval("window.__pycalc.setLanguage('zh')")
        assert browser.eval("document.querySelector('.side-card h3').textContent") == "变量"

        browser.eval("window.__pycalc.selectLibraries(['numpy', 'pyplot', 'sympy'])")
        run_and_check(
            browser,
            "print(np.array([1, 2, 3]).sum()); print(plt.__name__); print(sp.__name__)",
            "6\nmatplotlib.pyplot\nsympy\n",
        )
        # one continuous console; no per-cell success/time header
        assert browser.eval("document.querySelectorAll('.cell-head').length") == 0
        assert browser.eval("document.querySelectorAll('#console .entry').length") >= 1

        run_and_check(
            browser,
            "x = 1\ndef f(a, b=2):\n    return a + b\nprint(f(1))",
            "3\n",
        )
        variables = browser.eval("window.__pycalc.variables()")
        functions = browser.eval("window.__pycalc.functions()")
        assert any(row["name"] == "x" and row["type"] == "int" for row in variables), variables
        assert any(row["name"] == "f" and "b=2" in row["params"] for row in functions), functions

        # clickable In/Out prompts insert at the cursor instead of replacing
        browser.eval("window.__pycalc.setEditorText('12')")
        browser.eval("window.__pycalc.insertAtCursor('X')")
        assert browser.eval("window.__pycalc.getEditorValue()") == "12X"
        browser.eval("window.__pycalc.setEditorText('')")
        browser.eval(
            "[...document.querySelectorAll('.entry')]"
            ".find(e => e.textContent.includes('x = 1'))"
            ".querySelector('.prompt-btn.in').click()"
        )
        assert "x = 1" in browser.eval("window.__pycalc.getEditorValue()")
        browser.eval("window.__pycalc.setEditorText('')")
        browser.eval(
            "[...document.querySelectorAll('.prompt-btn.out')].at(-1).click()"
        )
        assert browser.eval("window.__pycalc.getEditorValue()").strip() != ""

        # Enter mode: incomplete code stays, complete code runs and clears
        browser.eval("window.__pycalc.setRunKey('enter')")
        browser.eval("window.__pycalc.setEditorText('def pending():')")
        assert browser.eval("window.__pycalc.tryRunOnEnter()") is False
        assert browser.eval("window.__pycalc.getEditorValue()") == "def pending():"
        browser.eval("window.__pycalc.setEditorText('1 + 1')")
        assert browser.eval("window.__pycalc.tryRunOnEnter()") is True
        assert browser.eval("window.__pycalc.getEditorValue()") == ""
        assert browser.eval("window.__pycalc.historyNav(-1)") is True
        assert browser.eval("window.__pycalc.getEditorValue()") == "1 + 1"

        # The real CodeMirror keymaps (not just the debug helpers) must work.
        browser.eval("window.__pycalc.setEditorText('def pending():')")
        browser.eval("document.querySelector('.cm-content').focus()")
        press(browser, "Enter", "Enter", 13)
        assert "\n" in browser.eval("window.__pycalc.getEditorValue()")
        browser.eval("window.__pycalc.setEditorText('2 + 3')")
        browser.eval("document.querySelector('.cm-content').focus()")
        press(browser, "Enter", "Enter", 13)
        wait_idle(browser)
        assert browser.eval("window.__pycalc.getEditorValue()") == ""
        assert browser.eval("window.__pycalc.history()")[-1]["code"] == "2 + 3"
        browser.eval("document.querySelector('.cm-content').focus()")
        press(browser, "ArrowUp", "ArrowUp", 38)
        assert browser.eval("window.__pycalc.getEditorValue()") == "2 + 3"

        # theme controls CodeMirror, CSS and future matplotlib figures only
        browser.eval("window.__pycalc.setTheme('dark')")
        assert browser.eval("document.documentElement.dataset.theme") == "dark"
        dark_rc = browser.run_cell(
            "import matplotlib\nprint(matplotlib.rcParams['figure.facecolor'])"
        )
        assert dark_rc["stdout"].strip() == "black", dark_rc
        dark_plot = browser.run_cell(
            "import matplotlib.pyplot as plt\n"
            "plt.figure(figsize=(2, 1.5))\nplt.plot([1, 2, 3])\nplt.show()"
        )
        assert dark_plot["images"] == 1, dark_plot
        browser.eval("window.__pycalc.setTheme('light')")
        light_rc = browser.run_cell(
            "import matplotlib\nprint(matplotlib.rcParams['figure.facecolor'])"
        )
        assert light_rc["stdout"].strip() == "white", light_rc
        # Changing the theme must not re-render previous figures.
        assert browser.eval("document.querySelectorAll('#console img').length") == 1
        light_plot = browser.run_cell(
            "import matplotlib.pyplot as plt\n"
            "plt.figure(figsize=(2, 1.5))\nplt.plot([1, 2, 3])\nplt.show()"
        )
        assert light_plot["images"] == 1, light_plot
        assert browser.eval("document.querySelectorAll('#console img').length") == 2

        # library selection is per session and restores the aliases
        a_id = browser.eval("window.__pycalc.createSession('lib A')")
        browser.wait_ready()
        browser.eval("window.__pycalc.selectLibraries(['numpy'])")
        b_id = browser.eval("window.__pycalc.createSession('lib B')")
        browser.wait_ready()
        browser.eval("window.__pycalc.selectLibraries(['sympy'])")
        browser.eval(f"window.__pycalc.switchSession({json.dumps(a_id)})")
        browser.wait_ready()
        assert browser.eval("window.__pycalc.active()")["libraries"] == ["numpy"]
        run_and_check(browser, "print(np.array([1, 2]).sum())", "3\n")
        browser.eval(f"window.__pycalc.switchSession({json.dumps(b_id)})")
        browser.wait_ready()
        assert browser.eval("window.__pycalc.active()")["libraries"] == ["sympy"]
        run_and_check(browser, "print(sp.symbols('x'))", "x\n")

        # global UI preferences survive a reload; library choice is per session
        browser.eval("window.__pycalc.setLanguage('en')")
        browser.eval("window.__pycalc.setTheme('light')")
        browser.eval("window.__pycalc.setRunKey('enter')")
        browser.eval("new Promise(resolve => setTimeout(resolve, 400))")
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready(timeout=180)
        ui = browser.eval("window.__pycalc.ui()")
        assert ui["language"] == "en" and ui["theme"] == "light" and ui["runKey"] == "enter", ui
        assert browser.eval("document.querySelector('.side-card h3').textContent") == "Variables"
        assert browser.eval("document.documentElement.dataset.theme") == "light"
        assert browser.eval("window.__pycalc.active()")["libraries"] == ["sympy"]
        assert_no_network(browser)
        browser.screenshot(ART / "new-features.png")
    log("  PASS new features")


def test_cross_version_history() -> None:
    log("[5] cross-version history (314 -> 0.27.8)")
    profile = OUT / "profiles" / "cross-version"
    shutil.rmtree(profile, ignore_errors=True)
    with Browser(file_url(OUT / "full314.html"), profile=profile, timeout=180) as browser:
        browser.wait_ready(timeout=180)
        browser.eval("window.__pycalc.createSession('跨版本会话')")
        browser.wait_ready()
        run_and_check(
            browser,
            "import numpy as np\narr = np.arange(3)\nprint(int(arr.sum()))",
            "3\n",
        )
        browser.eval("window.__pycalc.saveNow()")
    with Browser(file_url(OUT / "full0278.html"), profile=profile, timeout=180) as browser:
        browser.wait_ready(timeout=180)
        names = [s["name"] for s in browser.eval("window.__pycalc.sessions()")]
        assert "跨版本会话" in names, names
        assert len(browser.eval("window.__pycalc.history()")) >= 1
        run_and_check(browser, "print('history survives')", "history survives\n")
        banner_text = browser.eval("document.getElementById('banner').textContent")
        assert "Pyodide" in banner_text, banner_text
    log("  PASS cross-version history")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    ART.mkdir(parents=True, exist_ok=True)
    log(f"PyCalc acceptance — {ROOT}")
    try:
        test_minimal_314()
        test_full_314()
        test_full_0278()
        test_new_features()
        test_cross_version_history()
    except Exception:
        log("FAIL")
        traceback.print_exc()
        return 1
    log("ALL PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
