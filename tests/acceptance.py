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


def build_case(
    name: str,
    libs: list[str],
    version: str,
    aliases: dict[str, str] | None = None,
) -> Path:
    output = OUT / name
    result = build(
        BuildConfig(
            libs=libs,
            aliases=aliases,
            output=output,
            pyodide_version=version,
        ),
        log=lambda message: None,
    )
    assert result.output and result.output.exists()
    assert result.size > 1_000_000
    log(f"  built {name}: {result.size:,} bytes, {result.python_version}, {result.runtime_mode}")
    return result.output


def press(browser: Browser, name: str, code: str, vk: int, modifiers: int = 0) -> None:
    for event_type in ("keyDown", "keyUp"):
        browser.call(
            "Input.dispatchKeyEvent",
            {
                "type": event_type,
                "key": name,
                "code": code,
                "windowsVirtualKeyCode": vk,
                "nativeVirtualKeyCode": vk,
                "modifiers": modifiers,
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
        assert browser.eval("document.getElementById('sympy-output-wrap').classList.contains('hidden')")
        assert browser.eval("document.querySelectorAll('.lib-chip').length") == 0
        run_and_check(browser, "print(1 + 1)", "2\n")
        assert browser.eval("window.__pycalc.getEditorValue()") == ""
        run_and_check(browser, "print(sin(pi / 2))", "1.0\n")
        assert browser.eval("document.querySelectorAll('.cell').length") == 0
        assert browser.eval("document.querySelectorAll('.entry').length") >= 2
        assert_no_network(browser)

        # ans keeps the latest non-None cell result
        assert browser.run_cell("1 + 1")["result"] == "2"
        assert any(row["name"] == "ans" and row["value"] == "2"
                   for row in browser.eval("window.__pycalc.variables()"))
        assert browser.run_cell("print('side effect')")["result"] is None
        assert browser.run_cell("ans")["result"] == "2"
        assert browser.run_cell("None")["result"] is None
        assert browser.run_cell("ans")["result"] == "2"
        assert browser.run_cell("ans * 2")["result"] == "4"
        assert browser.run_cell("1 / 0")["status"] == "error"
        assert browser.run_cell("ans")["result"] == "4"
        assert browser.run_cell("0")["result"] == "0"
        assert browser.run_cell("ans")["result"] == "0"
        assert browser.run_cell("2 + 2")["result"] == "4"

        run_and_check(
            browser,
            "def f(x):\n    return x * 2\nprint(f(21))",
            "42\n",
        )
        browser.eval("window.__pycalc.saveNow()")
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready()
        assert browser.run_cell("ans")["result"] == "4"
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
        chip_values = browser.eval(
            "[...document.querySelectorAll('.lib-chip input')].map((item) => item.value)"
        )
        assert set(chip_values) == {"numpy", "matplotlib.pyplot", "sympy"}, chip_values
        run_and_check(
            browser,
            "import sympy as sp\nx = sp.symbols('x')\nprint(sp.integrate(x**2, x))",
            "x**3/3\n",
        )
        assert browser.eval("!document.getElementById('sympy-output-wrap').classList.contains('hidden')")
        sympy_result = browser.run_cell("sp.integrate(x**2, x)")
        assert sympy_result["result"] == "x**3/3", sympy_result
        entry = browser.eval("window.__pycalc.lastEntry()")
        assert "<math" in entry["resultMathML"], entry
        assert browser.eval("document.querySelectorAll('pre.result').length") == 1
        assert browser.eval("document.querySelectorAll('.math-result math').length") == 0
        browser.eval("window.__pycalc.setSympyOutput('math')")
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('pre.result').length") == 0
        assert browser.eval("document.querySelectorAll('.math-result math').length") == 1

        # &InvisibleTimes; is a MathML named entity that the XML parser
        # rejects; this expression must still render as math, not fall back.
        expand = browser.run_cell("x, y = sp.symbols('x y')\nsp.expand((x + y)**3)")
        assert expand["result"] == "x**3 + 3*x**2*y + 3*x*y**2 + y**3", expand
        assert "&InvisibleTimes;" in browser.eval("window.__pycalc.lastEntry().resultMathML")
        assert browser.eval("document.querySelectorAll('.math-result math').length") == 2
        browser.screenshot(ART / "math-mode.png")
        browser.eval("window.__pycalc.setSympyOutput('text')")
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('pre.result').length") == 2

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
        sympy_result = browser.run_cell("sp.integrate(x**2, x)")
        assert sympy_result["result"] == "x**3/3", sympy_result
        assert "<math" in browser.eval("window.__pycalc.lastEntry().resultMathML")
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


def test_custom_libraries() -> None:
    log("[4] custom library aliases")
    html = build_case(
        "custom314.html",
        ["numpy"],
        "314.0.7",
        aliases={"np": "numpy", "la": "numpy.linalg"},
    )
    profile = OUT / "profiles" / "custom-libs"
    shutil.rmtree(profile, ignore_errors=True)
    with Browser(file_url(html), profile=profile, timeout=180) as browser:
        browser.wait_ready(timeout=180)
        chips = browser.eval(
            "[...document.querySelectorAll('.lib-chip')].map((item) => ({"
            "value: item.querySelector('input').value, text: item.textContent}))"
        )
        assert {item["value"] for item in chips} == {"numpy", "numpy.linalg"}, chips
        assert any("la" in item["text"] for item in chips), chips

        assert browser.eval("window.__pycalc.selectLibraries(['la'])") == ["numpy.linalg"]
        run_and_check(browser, "print(la.norm([3, 4]))", "5.0\n")
        run_and_check(browser, "print('np' in globals())", "False\n")
        browser.eval("window.__pycalc.selectLibraries(['np'])")
        run_and_check(browser, "print(np.array([1, 2]).sum())", "3\n")
        assert_no_network(browser)
    log("  PASS custom libraries")


def test_new_features() -> None:
    log("[5] languages, libraries, tables, compact console, editor behaviour")
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
        assert any(item["label"] == "f" and item["detail"] == "(a, b=2)"
                   for item in browser.eval("window.__pycalc.completions()"))

        # autocomplete: type "pri", accept, auto-close the bracket, and show
        # the function-call signature hint.
        browser.eval("window.__pycalc.setEditorText('')")
        browser.eval("document.querySelector('.cm-content').focus()")
        browser.call("Input.insertText", {"text": "pri"})
        time.sleep(0.35)
        popup = browser.eval("document.querySelector('.cm-tooltip-autocomplete')?.textContent || ''")
        assert "print" in popup, popup
        press(browser, "Enter", "Enter", 13)
        assert browser.eval("window.__pycalc.getEditorValue()") == "print"
        browser.call("Input.insertText", {"text": "("})
        assert browser.eval("window.__pycalc.getEditorValue()") == "print()"
        time.sleep(0.2)
        sig = browser.eval("document.querySelector('.signature-tip')?.textContent || ''")
        assert "print" in sig, sig
        browser.eval("window.__pycalc.setEditorText('f(')")
        time.sleep(0.2)
        sig = browser.eval("document.querySelector('.signature-tip')?.textContent || ''")
        assert "a, b=2" in sig, sig

        # attribute completion and type inference from the live namespace
        browser.run_cell("arr = np.linspace(1, 2)")
        attrs = browser.eval("window.__pycalc.attributes('arr')")
        assert attrs["type"] == "numpy.ndarray", attrs
        assert any(row["label"] == "reshape" and row["type"] == "method" for row in attrs["items"])
        assert not any(item["label"] in ("if", "for", "while")
                       for item in browser.eval("window.__pycalc.completions()"))

        browser.eval("window.__pycalc.setEditorText('')")
        browser.eval("document.querySelector('.cm-content').focus()")
        browser.call("Input.insertText", {"text": "arr.re"})
        time.sleep(0.4)
        popup = browser.eval("document.querySelector('.cm-tooltip-autocomplete')?.textContent || ''")
        assert "reshape" in popup, popup
        assert browser.eval("document.querySelector('#type-hint')?.textContent") == "arr : numpy.ndarray"

        # static inference even before the assignment is executed
        browser.eval("window.__pycalc.setEditorText('pending = np.linspace(1, 2)\\npending')")
        browser.eval("document.querySelector('.cm-content').focus()")
        browser.call("Input.insertText", {"text": ".re"})
        time.sleep(0.4)
        popup = browser.eval("document.querySelector('.cm-tooltip-autocomplete')?.textContent || ''")
        assert "reshape" in popup, popup
        assert browser.eval("document.querySelector('#type-hint')?.textContent") == "pending : numpy.ndarray"

        press(browser, "Escape", "Escape", 27)
        browser.eval("window.__pycalc.setEditorText('np.lin')")
        browser.eval("document.querySelector('.cm-content').focus()")
        press(browser, " ", "Space", 32, modifiers=2)
        time.sleep(0.5)
        popup = browser.eval("document.querySelector('.cm-tooltip-autocomplete')?.textContent || ''")
        assert "linspace" in popup, popup
        assert browser.eval("document.querySelector('#type-hint')?.textContent") == "np : module numpy"

        browser.eval("window.__pycalc.setEditorText('np.linspace(')")
        time.sleep(0.3)
        sig = browser.eval("document.querySelector('.signature-tip')?.textContent || ''")
        assert "start, stop" in sig, sig

        # bracket / quote auto-completion
        browser.eval("window.__pycalc.setEditorText('')")
        browser.eval("document.querySelector('.cm-content').focus()")
        for typed, expected in (("[", "[]"), ('"', '""')):
            browser.eval("window.__pycalc.setEditorText('')")
            browser.call("Input.insertText", {"text": typed})
            assert browser.eval("window.__pycalc.getEditorValue()") == expected

        # selection is visibly coloured
        browser.eval("window.__pycalc.setEditorText('hello world')")
        browser.eval("document.querySelector('.cm-content').focus()")
        press(browser, "a", "KeyA", 65, modifiers=2)
        time.sleep(0.25)
        assert browser.eval("window.getSelection().toString()") == "hello world"
        background = browser.eval(
            "(() => { const e = document.querySelector('.cm-selectionBackground');"
            " return e ? getComputedStyle(e).backgroundColor : ''; })()"
        )
        assert background not in ("", "transparent", "rgba(0, 0, 0, 0)"), background
        browser.eval("window.__pycalc.setEditorText('')")

        # sidebar width is draggable and remembered
        width_before = browser.eval(
            "parseFloat(getComputedStyle(document.documentElement)"
            ".getPropertyValue('--sidebar-width'))"
        )
        browser.eval(
            "(() => { const r = document.getElementById('sidebar-resizer');"
            " const rect = r.getBoundingClientRect();"
            " const opts = {bubbles: true, pointerId: 1, clientY: rect.top + 20};"
            " r.dispatchEvent(new PointerEvent('pointerdown', {...opts, clientX: rect.left + 2}));"
            " window.dispatchEvent(new PointerEvent('pointermove', {...opts, clientX: rect.left + 90}));"
            " window.dispatchEvent(new PointerEvent('pointerup', {...opts, clientX: rect.left + 90}));"
            " })()"
        )
        width_after = browser.eval(
            "parseFloat(getComputedStyle(document.documentElement)"
            ".getPropertyValue('--sidebar-width'))"
        )
        assert width_after > width_before, (width_before, width_after)

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
        browser.run_cell("sp.symbols('z')")

        # global UI preferences survive a reload; library choice is per session
        browser.eval("window.__pycalc.setLanguage('en')")
        browser.eval("window.__pycalc.setTheme('light')")
        browser.eval("window.__pycalc.setRunKey('enter')")
        browser.eval("window.__pycalc.setSympyOutput('math')")
        browser.eval("new Promise(resolve => setTimeout(resolve, 400))")
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready(timeout=180)
        ui = browser.eval("window.__pycalc.ui()")
        assert ui["language"] == "en" and ui["theme"] == "light" and ui["runKey"] == "enter", ui
        assert ui["sympyOutput"] == "math", ui
        assert abs(float(ui["sidebarWidth"]) - width_after) < 2, (ui, width_after)
        assert browser.eval("document.querySelector('.side-card h3').textContent") == "Variables"
        assert browser.eval("document.getElementById('sympy-output').value") == "math"
        assert browser.eval("document.querySelectorAll('.math-result math').length") >= 1
        assert browser.eval("document.documentElement.dataset.theme") == "light"
        assert browser.eval("window.__pycalc.active()")["libraries"] == ["sympy"]
        assert_no_network(browser)
        browser.screenshot(ART / "new-features.png")
    log("  PASS new features")


def test_cross_version_history() -> None:
    log("[6] cross-version history (314 -> 0.27.8)")
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
        test_custom_libraries()
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
