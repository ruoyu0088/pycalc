#!/usr/bin/env python3
"""End-to-end PyCalc acceptance tests.

Run from pycalc-app/:

    python tests/acceptance.py

Builds fresh minimal and full HTML files, drives the installed Chrome/Edge via
CDP, and verifies session persistence, copying, rebuilding and both runtime
layouts.
"""

from __future__ import annotations

import functools
import http.server
import json
import shutil
import socket
import sys
import threading
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


MOBILE_TAP_JS = """(label) => {
  const selector = '.mk-key,.mk-tab,.mk-lib-tab,.mk-drawer-item,.mk-drawer-close';
  const element = [...document.querySelectorAll(selector)]
    .find((item) => item.textContent === label);
  if (!element) throw new Error('no keyboard key ' + label);
  for (const type of ['pointerdown', 'pointerup']) {
    element.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true,
    }));
  }
}"""


def install_mobile_tap(browser: Browser) -> None:
    browser.eval(f"window.__tap = {MOBILE_TAP_JS}")


def tap_keyboard(browser: Browser, label: str) -> None:
    browser.eval(f"window.__tap({json.dumps(label)})")


MOBILE_TAP_RUN_JS = """() => {
  const element = document.querySelector('.mk-key.run');
  if (!element) throw new Error('no run key');
  for (const type of ['pointerdown', 'pointerup']) {
    element.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true,
    }));
  }
}"""


def tap_keyboard_run(browser: Browser) -> None:
    browser.eval(f"window.__tapRun = {MOBILE_TAP_RUN_JS}")
    browser.eval("window.__tapRun()")


MOBILE_TAP_DRAWER_JS = """(name) => {
  const element = document.querySelector(`.mk-key[data-drawer="${name}"]`);
  if (!element) throw new Error(`no drawer key ${name}`);
  for (const type of ['pointerdown', 'pointerup']) {
    element.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true,
    }));
  }
}"""


def tap_keyboard_drawer(browser: Browser, name: str) -> None:
    browser.eval(f"window.__tapDrawer = {MOBILE_TAP_DRAWER_JS}")
    browser.eval(f"window.__tapDrawer({json.dumps(name)})")


def touch_keyboard(browser: Browser, label: str) -> None:
    rect = browser.eval(
        "(() => {"
        f" const element = [...document.querySelectorAll('.mk-key,.mk-tab,.mk-lib-tab')]"
        f"   .find((item) => item.textContent === {json.dumps(label)});"
        " if (!element) throw new Error('no keyboard key');"
        " const r = element.getBoundingClientRect();"
        " return {x: r.x + r.width / 2, y: r.y + r.height / 2};"
        "})()"
    )
    point = {
        "x": rect["x"], "y": rect["y"],
        "radiusX": 2, "radiusY": 2, "force": 1, "id": 1,
    }
    browser.call("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [point]})
    browser.call("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def touch_keyboard_drawer(browser: Browser, name: str) -> None:
    rect = browser.eval(
        "(() => {"
        f" const element = document.querySelector('.mk-key[data-drawer={json.dumps(name)}]');"
        " if (!element) throw new Error('no keyboard drawer key');"
        " const r = element.getBoundingClientRect();"
        " return {x: r.x + r.width / 2, y: r.y + r.height / 2};"
        "})()"
    )
    point = {
        "x": rect["x"], "y": rect["y"],
        "radiusX": 2, "radiusY": 2, "force": 1, "id": 1,
    }
    browser.call("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [point]})
    browser.call("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def test_mobile_keyboard() -> None:
    log("[4] mobile virtual keyboard")
    html = OUT / "full314.html"
    profile = OUT / "profiles" / "mobile-keyboard"
    shutil.rmtree(profile, ignore_errors=True)
    with Browser(file_url(html), profile=profile, timeout=180) as browser:
        browser.call(
            "Emulation.setDeviceMetricsOverride",
            {"width": 390, "height": 844, "deviceScaleFactor": 3, "mobile": True},
        )
        browser.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready(timeout=180)
        install_mobile_tap(browser)

        assert browser.eval("matchMedia('(pointer: coarse)').matches") is True
        assert "viewport-fit=cover" in browser.eval(
            "document.querySelector('meta[name=viewport]').content"
        )
        assert browser.eval("!!document.querySelector('.mobile-keyboard')") is True
        assert browser.eval("document.body.classList.contains('mobile-keyboard-active')") is True
        assert browser.eval("document.querySelectorAll('.mk-tab').length") == 8
        assert browser.eval("[...document.querySelectorAll('.mk-tab')].map(x => x.textContent)") == [
            "计算", "英文", "补全", "[1]", "↑", "↓", "清空", "▼",
        ]

        assert browser.eval(
            "getComputedStyle(document.getElementById('session-bar-toggle')).display"
        ) != "none"
        top_before = browser.eval("document.querySelector('.topbar').getBoundingClientRect().height")
        work_before = browser.eval(
            "document.querySelector('.workspace').getBoundingClientRect().height"
        )
        browser.eval("document.getElementById('session-bar-toggle').click()")
        time.sleep(0.2)
        assert browser.eval("document.body.classList.contains('session-bar-hidden')") is True
        assert browser.eval("getComputedStyle(document.querySelector('.session-bar')).display") == "none"
        top_after = browser.eval("document.querySelector('.topbar').getBoundingClientRect().height")
        work_after = browser.eval(
            "document.querySelector('.workspace').getBoundingClientRect().height"
        )
        assert top_after < top_before, (top_before, top_after)
        assert work_after > work_before, (work_before, work_after)
        browser.eval("document.getElementById('session-bar-toggle').click()")
        time.sleep(0.2)
        assert browser.eval("getComputedStyle(document.querySelector('.session-bar')).display") != "none"
        assert browser.eval(
            "getComputedStyle(document.querySelector('.composer-actions')).display"
        ) == "none"
        assert browser.eval("document.querySelector('.cm-content').getAttribute('inputmode')") == "none"
        height = browser.eval("document.querySelector('.mobile-keyboard').getBoundingClientRect().height")
        assert 220 <= height <= 330, height

        work_expanded = browser.eval(
            "document.querySelector('.workspace').getBoundingClientRect().height"
        )
        tap_keyboard(browser, "▼")
        time.sleep(0.2)
        assert browser.eval("getComputedStyle(document.querySelector('.mk-panel')).display") == "none"
        assert browser.eval(
            "document.querySelector('.mobile-keyboard').getBoundingClientRect().height"
        ) < 80
        assert browser.eval(
            "document.querySelector('.workspace').getBoundingClientRect().height"
        ) > work_expanded
        tap_keyboard(browser, "英文")
        time.sleep(0.2)
        assert browser.eval("getComputedStyle(document.querySelector('.mk-panel')).display") != "none"
        assert browser.eval("document.querySelector('.mk-tab.active').textContent") == "英文"
        tap_keyboard(browser, "计算")

        for label in ["(", "1", "+", "2", ")", "*", "3"]:
            tap_keyboard(browser, label)
        assert browser.eval("window.__pycalc.getEditorValue()") == "(1+2)*3"
        tap_keyboard_run(browser)
        wait_idle(browser)
        assert browser.eval("window.__pycalc.lastEntry().result") == "9"
        assert browser.eval("window.__pycalc.getEditorValue()") == ""
        assert browser.eval("document.activeElement.classList.contains('cm-content')") is True
        assert browser.eval("getComputedStyle(document.querySelector('.cm-cursor')).display") != "none"

        assert browser.eval("document.querySelectorAll('.prompt-btn').length") >= 2
        tap_keyboard(browser, "[1]")
        time.sleep(0.2)
        assert browser.eval("document.body.classList.contains('hide-prompts')") is True
        assert browser.eval(
            "[...document.querySelectorAll('.prompt-btn')]"
            ".every(x => getComputedStyle(x).display === 'none')"
        ) is True
        borders = browser.eval(
            "[getComputedStyle(document.querySelector('.io-input')).borderLeftColor,"
            " getComputedStyle(document.querySelector('.io-output')).borderLeftColor]"
        )
        assert borders[0] != borders[1], borders
        tap_keyboard(browser, "[1]")
        time.sleep(0.2)
        assert browser.eval("document.body.classList.contains('hide-prompts')") is False
        assert browser.eval("window.__pycalc.lastEntry().result") == "9"

        # Arrow buttons move the caret; at the first/last line they navigate
        # input history exactly like the physical ArrowUp/ArrowDown keys.
        browser.eval("window.__pycalc.setEditorText('draft')")
        tap_keyboard(browser, "↑")
        assert browser.eval("window.__pycalc.getEditorValue()") == "(1+2)*3"
        tap_keyboard(browser, "↓")
        assert browser.eval("window.__pycalc.getEditorValue()") == "draft"

        browser.eval("window.__pycalc.setEditorText('clear me')")
        tap_keyboard(browser, "清空")
        assert browser.eval("window.__pycalc.getEditorValue()") == ""

        browser.eval("window.__pycalc.setEditorText('for i in range(10):')")
        tap_keyboard(browser, "⏎")
        assert browser.eval("window.__pycalc.getEditorValue()") == "for i in range(10):\n    "

        browser.eval("window.__pycalc.setEditorText('')")
        tap_keyboard_drawer(browser, "libraries")
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('.mk-lib-tab').length") == 0
        assert "请先勾选扩展库" in browser.eval(
            "document.getElementById('mk-drawer-list').textContent"
        )
        tap_keyboard(browser, "×")
        time.sleep(0.3)

        resolve = lambda raw, alias, before: browser.eval(
            "window.__pycalcKeyboard.resolveInsert("
            f"{json.dumps(raw)}, {json.dumps(alias)}, {json.dumps(before)})"
        )
        assert resolve("?arange(", "np", "") == "np.arange("
        assert resolve("?arange(", "np", "np") == ".arange("
        assert resolve("?arange(", "np", "np.") == "arange("
        assert resolve("?arange(", "np", "x") == "np.arange("
        assert resolve("?.sum(", "np", "np") == ".sum("
        assert resolve("?.sum(", "np", "np.") == "sum("
        assert resolve("?.sum(", "np", "x") == ".sum("
        assert resolve("?.sum(", "np", "x.") == "sum("
        assert resolve("?.sum(", "np", "+") == "np.sum("
        assert resolve("?.sum(", "np", "") == "np.sum("
        assert resolve(".tolist(", "np", "x") == ".tolist("
        assert resolve(".tolist(", "np", "x.") == "tolist("
        assert resolve(".tolist(", "np", "np") is None
        assert resolve(".tolist(", "np", "") is None
        assert resolve(".dtype", "np", "x") == ".dtype"
        assert resolve(".dtype", "np", "x.") == "dtype"
        assert resolve(".T", "np", "x") == ".T"
        assert resolve("?linalg.norm(", "np", "np") == ".linalg.norm("
        assert resolve("?.loc[", "pd", "df") == ".loc["
        assert resolve("?.loc[", "pd", "df.") == "loc["
        assert resolve("np", "np", "") == "np"

        browser.eval("window.__pycalc.selectLibraries(['numpy', 'matplotlib.pyplot'])")
        time.sleep(0.2)
        browser.eval("window.__pycalc.setEditorText('')")
        tap_keyboard_drawer(browser, "libraries")
        time.sleep(0.2)
        assert browser.eval(
            "[...document.querySelectorAll('.mk-lib-tab')].map(x => x.textContent)"
        ) == ["np", "plt"]
        labels = browser.eval(
            "[...document.querySelectorAll('.mk-drawer-item')].map(x => x.textContent)"
        )
        assert "arange" in labels, labels
        assert not any(
            label.startswith(("?", ".")) or "(" in label or "[" in label
            for label in labels
        ), labels
        tap_keyboard(browser, "plt")
        assert "plot" in browser.eval(
            "[...document.querySelectorAll('.mk-drawer-item')].map(x => x.textContent)"
        )
        tap_keyboard(browser, "np")
        tap_keyboard(browser, "arange")
        assert browser.eval("window.__pycalc.getEditorValue()") == "np.arange("
        assert browser.eval("!document.getElementById('mk-drawer').classList.contains('open')") is True

        browser.eval("window.__pycalc.setEditorText('np')")
        tap_keyboard_drawer(browser, "libraries")
        time.sleep(0.2)
        tap_keyboard(browser, "tolist")
        time.sleep(0.2)
        assert browser.eval("window.__pycalc.getEditorValue()") == "np"
        assert "先输入对象名" in browser.eval("document.getElementById('toast').textContent")
        assert browser.eval("document.getElementById('mk-drawer').classList.contains('open')") is True
        tap_keyboard(browser, "×")
        time.sleep(0.3)

        # Manual variable shortcuts come first; a user variable with the same
        # name is not repeated.
        browser.run_cell("x = 123\nq = 7")

        # A real touch (not just a synthetic PointerEvent) must not be
        # swallowed by the backdrop's synthetic click after pointerup.
        touch_keyboard_drawer(browser, "variables")
        time.sleep(0.35)
        assert browser.eval("document.getElementById('mk-drawer').classList.contains('open')") is True
        labels = browser.eval(
            "[...document.querySelectorAll('.mk-drawer-item')].map(x => x.textContent)"
        )
        assert labels[:6] == ["x", "y", "z", "a", "b", "c"], labels
        assert labels.count("x") == 1, labels
        assert "q" in labels, labels
        tap_keyboard(browser, "×")
        time.sleep(0.3)

        browser.eval("window.__pycalc.setEditorText('')")
        tap_keyboard_drawer(browser, "functions")
        time.sleep(0.2)
        labels = browser.eval(
            "[...document.querySelectorAll('.mk-drawer-item')].map(x => x.textContent)"
        )
        assert labels[:3] == ["print", "range", "enumerate"], labels
        tap_keyboard(browser, "print")
        assert browser.eval("window.__pycalc.getEditorValue()") == "print("

        browser.run_cell("def user_fn(a):\n    return a")
        browser.eval("window.__pycalc.setEditorText('')")
        tap_keyboard_drawer(browser, "functions")
        time.sleep(0.2)
        labels = browser.eval(
            "[...document.querySelectorAll('.mk-drawer-item')].map(x => x.textContent)"
        )
        assert labels[0] == "print", labels
        assert labels[-1] == "user_fn", labels
        tap_keyboard(browser, "user_fn")
        assert browser.eval("window.__pycalc.getEditorValue()") == "user_fn("

        browser.eval("window.__pycalc.setEditorText('')")
        tap_keyboard_drawer(browser, "math")
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('.mk-drawer-item').length") == 26
        assert "range" not in browser.eval(
            "[...document.querySelectorAll('.mk-drawer-item')].map(x => x.textContent)"
        )
        tap_keyboard(browser, "sin")
        assert browser.eval("window.__pycalc.getEditorValue()") == "sin("

        tap_keyboard(browser, "英文")
        assert browser.eval(
            "[...document.querySelectorAll('.mk-key')]"
            ".filter(x => 'zxcvbnm'.includes(x.textContent)).length"
        ) == 7
        tap_keyboard(browser, "⇧")
        assert browser.eval(
            "[...document.querySelectorAll('.mk-key')].some(x => x.textContent === 'A')"
        ) is True
        tap_keyboard(browser, "A")
        assert browser.eval("window.__pycalc.getEditorValue()") == "sin(A"
        tap_keyboard(browser, "123")
        assert browser.eval(
            "[...document.querySelectorAll('.mk-key')].some(x => x.textContent === '0')"
        ) is True
        tap_keyboard(browser, "ABC")
        assert browser.eval(
            "[...document.querySelectorAll('.mk-key')].some(x => x.textContent === 'q')"
        ) is True

        browser.eval("window.__pycalc.setLanguage('en')")
        time.sleep(0.2)
        assert browser.eval("[...document.querySelectorAll('.mk-tab')].map(x => x.textContent)") == [
            "Calc", "English", "Comp", "[1]", "↑", "↓", "Clear", "▼",
        ]
        browser.eval("window.__pycalc.setLanguage('zh')")
        time.sleep(0.2)
        browser.screenshot(ART / "keyboard-mobile.png")

        # Back to a normal desktop pointer: no keyboard is created and the
        # composer actions return.
        browser.call("Emulation.clearDeviceMetricsOverride")
        browser.call("Emulation.setTouchEmulationEnabled", {"enabled": False})
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready(timeout=180)
        assert browser.eval("!!document.querySelector('.mobile-keyboard')") is False
        assert browser.eval(
            "getComputedStyle(document.querySelector('.composer-actions')).display"
        ) != "none"
        assert browser.eval(
            "getComputedStyle(document.getElementById('session-bar-toggle')).display"
        ) == "none"
        assert browser.eval("getComputedStyle(document.querySelector('.session-bar')).display") != "none"
        assert browser.eval("document.querySelector('.cm-content').getAttribute('inputmode')") is None
    log("  PASS mobile keyboard")


def test_ios_keyboard() -> None:
    log("[5] iPhone virtual keyboard")
    html = OUT / "full314.html"
    profile = OUT / "profiles" / "ios-keyboard"
    shutil.rmtree(profile, ignore_errors=True)
    user_agent = (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 "
        "Mobile/15E148 Safari/604.1"
    )
    with Browser(file_url(html), profile=profile, timeout=180) as browser:
        browser.call(
            "Emulation.setUserAgentOverride",
            {"userAgent": user_agent, "platform": "iPhone"},
        )
        browser.call(
            "Emulation.setDeviceMetricsOverride",
            {"width": 390, "height": 844, "deviceScaleFactor": 3, "mobile": True},
        )
        browser.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready(timeout=180)
        install_mobile_tap(browser)

        assert browser.eval("document.body.classList.contains('mobile-keyboard-ios')") is True
        assert browser.eval("!!document.querySelector('.mobile-keyboard')") is True
        assert browser.eval("document.querySelector('.cm-content').getAttribute('contenteditable')") == "false"
        assert browser.eval("document.querySelector('.cm-content').getAttribute('tabindex')") == "0"
        assert browser.eval("document.querySelector('.cm-content').getAttribute('inputmode')") == "none"
        assert browser.eval(
            "document.querySelector('.cm-content').getAttribute('virtualkeyboardpolicy')"
        ) == "manual"
        assert browser.eval("document.activeElement.classList.contains('cm-content')") is True
        assert browser.eval("getComputedStyle(document.querySelector('.cm-cursor')).display") == "block"

        left_before = browser.eval("parseFloat(document.querySelector('.cm-cursor').style.left)")
        for label in ["1", "2", "3"]:
            tap_keyboard(browser, label)
        time.sleep(0.2)
        assert browser.eval("window.__pycalc.getEditorValue()") == "123"
        left_after = browser.eval("parseFloat(document.querySelector('.cm-cursor').style.left)")
        assert left_after > left_before, (left_before, left_after)

        line = browser.eval(
            "(() => { const r = document.querySelector('.cm-line').getBoundingClientRect();"
            " return {x: r.left + 8, y: r.top + r.height / 2}; })()"
        )
        browser.call(
            "Input.dispatchMouseEvent",
            {"type": "mousePressed", "x": line["x"], "y": line["y"], "button": "left", "clickCount": 1},
        )
        browser.call(
            "Input.dispatchMouseEvent",
            {"type": "mouseReleased", "x": line["x"], "y": line["y"], "button": "left", "clickCount": 1},
        )
        moved = browser.eval("parseFloat(document.querySelector('.cm-cursor').style.left)")
        assert moved < left_after, (left_after, moved)
        assert browser.eval("window.__pycalc.getEditorValue()") == "123"
        tap_keyboard_run(browser)
        wait_idle(browser)
        assert browser.eval("window.__pycalc.lastEntry().result") == "123"
        assert browser.eval("window.__pycalc.getEditorValue()") == ""
        assert browser.eval(
            "document.querySelector('.cm-content').getAttribute('contenteditable')"
        ) == "false"
        browser.screenshot(ART / "keyboard-ios.png")
    log("  PASS iPhone keyboard")


def test_dataframe_summary() -> None:
    log("[10] DataFrame variable summary")
    html = build_case(
        "dataframe314.html",
        ["numpy", "pandas", "polars"],
        "314.0.7",
        aliases={"pd": "pandas", "pl": "polars"},
    )
    profile = OUT / "profiles" / "dataframe-summary"
    shutil.rmtree(profile, ignore_errors=True)
    with Browser(file_url(html), profile=profile, timeout=180) as browser:
        browser.wait_ready(timeout=180)
        browser.run_cell(
            "import pandas as pd\n"
            "import polars as pl\n"
            "pdf = pd.DataFrame({'alpha': [1, 2], 'beta': [3, 4], 'gamma': [5, 6]})\n"
            "pldf = pl.DataFrame({'alpha': [1, 2], 'beta': [3, 4], 'gamma': [5, 6]})"
        )
        rows = {row["name"]: row for row in browser.eval("window.__pycalc.variables()")}
        for name in ("pdf", "pldf"):
            value = rows[name]["value"]
            assert "shape=(2, 3)" in value, (name, value)
            assert "columns=['alpha', 'beta', 'gamma']" in value, (name, value)
            assert "\n" not in value and "0  1  2" not in value, (name, value)
        pdf_result = browser.run_cell("pdf")
        table = browser.eval("window.__pycalc.lastEntry().resultTable")
        assert table and table["totalRows"] == 2 and table["columns"] == ["alpha", "beta", "gamma"], table
        browser.eval("window.__pycalc.setDisplaySettings({dataframeOutput: 'table'})")
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('.df-table tbody tr').length") == 2
        browser.eval("window.__pycalc.setDisplaySettings({dataframeRows: 1, dataframeOutput: 'table'})")
        one_row = browser.run_cell("pdf")
        assert one_row["status"] == "ok"
        assert browser.eval("window.__pycalc.lastEntry().resultTable.rows.length") == 1
        assert browser.eval("document.querySelectorAll('.df-table tbody tr').length") == 3
        browser.eval("window.__pycalc.setDisplaySettings({dataframeOutput: 'text'})")
        assert browser.eval("document.querySelectorAll('.df-table').length") == 0

        browser.eval(
            "window.__pycalc.setDisplaySettings({dataframeOutput: 'table',"
            " dataframeRows: 20, floatDigits: 6})"
        )
        browser.run_cell(
            "import pandas as pd\n"
            "fdf = pd.DataFrame({'value': [1.23456789, 2.34567891]})\n"
            "fdf"
        )
        time.sleep(0.2)
        cells = browser.eval(
            "[...[...document.querySelectorAll('.df-table')].at(-1)"
            ".querySelectorAll('tbody tr:last-child td')].map(x => x.textContent)"
        )
        assert cells[-1] == "2.34568", cells
        browser.eval("window.__pycalc.setDisplaySettings({floatDigits: 'auto'})")
        time.sleep(0.2)
        cells = browser.eval(
            "[...[...document.querySelectorAll('.df-table')].at(-1)"
            ".querySelectorAll('tbody tr:last-child td')].map(x => x.textContent)"
        )
        assert cells[-1] == "2.34567891", cells

        browser.run_cell(
            "wide = pd.DataFrame({f'c{i}': [i] for i in range(12)})\nwide"
        )
        browser.eval(
            "window.__pycalc.setDisplaySettings({dataframeOutput: 'table',"
            " dataframeRows: 20, dataframeCols: 5})"
        )
        time.sleep(0.2)
        headers = browser.eval(
            "[...[...document.querySelectorAll('.df-table')].at(-1)"
            ".querySelectorAll('thead th')].map(x => x.textContent)"
        )
        assert headers.count("…") == 1, headers
        assert headers[0] == "#", headers
    log("  PASS DataFrame summary")


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
        assert browser.eval("!document.getElementById('display-settings').classList.contains('hidden')")
        assert browser.eval("document.getElementById('engine-badge') === null")
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


def test_worker_responsive() -> None:
    log("[11] worker UI responsiveness")
    html = build_case("worker-ui.html", ["numpy", "sympy", "matplotlib"], "314.0.7")
    profile = OUT / "profiles" / "worker-ui"
    shutil.rmtree(profile, ignore_errors=True)
    with Browser(file_url(html), profile=profile, timeout=180) as browser:
        hidden = False
        ready = True
        deadline = time.time() + 20
        while time.time() < deadline:
            hidden = browser.eval(
                "document.getElementById('overlay').classList.contains('hidden')"
            )
            ready = browser.eval("window.__pycalcReady === true")
            if hidden and not ready:
                break
            time.sleep(0.02)
        assert hidden is True
        assert ready is False
        status = browser.eval(
            "(() => { const n = document.getElementById('runtime-status');"
            " const t = document.querySelector('.topbar');"
            " return {position: getComputedStyle(n).position,"
            "         inTopbar: t.contains(n),"
            "         hidden: n.classList.contains('hidden'),"
            "         text: n.textContent}; })()"
        )
        assert status["position"] == "fixed", status
        assert status["inTopbar"] is False, status
        assert status["hidden"] is False, status
        browser.eval("document.querySelector('.cm-content').focus()")
        started = time.time()
        browser.call("Input.insertText", {"text": "1+1"})
        assert browser.eval("window.__pycalc.getEditorValue()") == "1+1"
        assert time.time() - started < 1.0
        browser.wait_ready(timeout=180)
        assert browser.eval("window.__pycalc.getEditorValue()") == "1+1"
    log("  PASS worker UI responsiveness")


def test_session_title() -> None:
    log("[12] session title / menu")
    html = build_case("session-title.html", ["numpy", "sympy"], "314.0.7")
    profile = OUT / "profiles" / "session-title"
    shutil.rmtree(profile, ignore_errors=True)
    expected = {"en": "Default", "zh": "默认会话", "ja": "デフォルト"}
    with Browser(file_url(html), profile=profile, timeout=180) as browser:
        browser.call(
            "Emulation.setDeviceMetricsOverride",
            {"width": 390, "height": 844, "deviceScaleFactor": 3, "mobile": True},
        )
        browser.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready(timeout=180)
        for lang, default_name in expected.items():
            browser.eval(f"window.__pycalc.setLanguage({lang!r})")
            time.sleep(0.2)
            active = browser.eval("window.__pycalc.active()")
            if active["name"] != default_name:
                browser.eval(f"window.__pycalc.deleteSession({active['id']!r})")
                time.sleep(0.4)
            metrics = browser.eval(
                "(() => {"
                " const n = document.getElementById('session-title-name');"
                " return {text: n.textContent, scroll: n.scrollWidth,"
                "         client: n.clientWidth, height: n.getBoundingClientRect().height};"
                "})()"
            )
            assert metrics["text"] == default_name, (lang, metrics)
            assert metrics["scroll"] <= metrics["client"] + 1, (lang, metrics)
            assert metrics["height"] <= 24, (lang, metrics)
        browser.eval("document.getElementById('session-title').click()")
        time.sleep(0.2)
        assert browser.eval(
            "document.getElementById('session-menu').classList.contains('hidden')"
        ) is False
        assert browser.eval("document.querySelectorAll('.session-menu-item').length") == 1
        browser.eval("document.getElementById('session-title').click()")
        time.sleep(0.2)
        browser.eval("window.__pycalc.createSession('Another session')")
        browser.eval("document.getElementById('session-title').click()")
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('.session-menu-item').length") == 2
        browser.eval("document.getElementById('toast').classList.add('hidden')")
        browser.screenshot(ART / "session-title-menu.png")
        browser.eval(
            "[...document.querySelectorAll('.session-menu-item')]"
            ".find(x => x.textContent.includes('Another session')).click()"
        )
        time.sleep(0.4)
        assert browser.eval("document.getElementById('session-title-name').textContent") == "Another session"
    log("  PASS session title / menu")


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
        assert browser.eval("!document.getElementById('display-settings').classList.contains('hidden')")
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

        # All-math mode also renders containers containing SymPy expressions.
        container = browser.run_cell("container = [x**2, sp.sin(y)]\ncontainer")
        assert "<math" in browser.eval("window.__pycalc.lastEntry().resultMathMLAll")
        browser.eval("window.__pycalc.setSympyOutput('all')")
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('.math-result math').length") >= 3
        browser.screenshot(ART / "math-mode.png")
        browser.eval("window.__pycalc.setSympyOutput('text')")
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('pre.result').length") == 3

        # The gear opens the full display-settings dialog.
        browser.eval("document.getElementById('display-settings').click()")
        time.sleep(0.2)
        assert browser.eval("!document.getElementById('display-dialog').classList.contains('hidden')")
        assert browser.eval(
            "document.querySelector('input[name=sympy-output]:checked').value"
        ) == "text"
        browser.eval("document.getElementById('display-close').click()")

        # Float precision is significant-digit based and applies to history
        # through a per-result number tree; strings inside containers survive.
        float_result = browser.run_cell("0.1 + 0.2")
        assert float_result["result"] == "0.30000000000000004", float_result
        assert browser.eval("[...document.querySelectorAll('pre.result')].at(-1).textContent") == "0.3"
        browser.eval("window.__pycalc.setDisplaySettings({floatDigits: 'auto'})")
        time.sleep(0.2)
        assert browser.eval("[...document.querySelectorAll('pre.result')].at(-1).textContent") == "0.30000000000000004"
        browser.eval("window.__pycalc.setDisplaySettings({floatDigits: 6})")
        time.sleep(0.2)
        assert browser.eval("[...document.querySelectorAll('pre.result')].at(-1).textContent") == "0.3"
        mixed = browser.run_cell("mixed = [1.23456789, '1.23456789']\nmixed")
        assert browser.eval("[...document.querySelectorAll('pre.result')].at(-1).textContent") == "[1.23457, '1.23456789']"
        browser.eval("window.__pycalc.setDisplaySettings({floatDigits: 10})")

        # NumPy pretty mode hides array()/np.float64() wrappers.
        array_result = browser.run_cell("import numpy as np\nnp.array([1, 2, 3])")
        assert array_result["result"].startswith("array(")
        browser.eval("window.__pycalc.setDisplaySettings({numpyOutput: 'pretty'})")
        time.sleep(0.2)
        assert browser.eval("[...document.querySelectorAll('pre.result')].at(-1).textContent") == "[1, 2, 3]"
        browser.eval("window.__pycalc.setDisplaySettings({numpyOutput: 'default'})")

        # A 1-D array is a single table row with no row/column headers. When it
        # exceeds the maximum column count it falls back to Pretty text.
        browser.eval(
            "window.__pycalc.setDisplaySettings({numpyOutput: 'table', numpyCols: 5})"
        )
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('.np-table.np-vector thead th').length") == 0
        assert browser.eval("document.querySelectorAll('.np-table.np-vector tbody tr').length") == 1
        assert browser.eval(
            "[...document.querySelectorAll('.np-table.np-vector tbody td')]"
            ".map(x => x.textContent)"
        ) == ["1", "2", "3"]
        browser.eval("window.__pycalc.setDisplaySettings({numpyCols: 2})")
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('.np-table.np-vector').length") == 0
        assert browser.eval("[...document.querySelectorAll('pre.result')].at(-1).textContent") == "[1, 2, 3]"
        browser.eval(
            "window.__pycalc.setDisplaySettings({numpyOutput: 'default', numpyCols: 10})"
        )

        matrix = browser.run_cell(
            "np.array([[-2.82998, -1.71821, 3.94834],"
            " [-1.39422, -1.4325, 3.04898],"
            " [0.151593, -0.869668, -0.0137923]])"
        )
        assert matrix["status"] == "ok" and matrix["images"] == 0, matrix
        browser.eval(
            "window.__pycalc.setDisplaySettings({numpyOutput: 'pretty', floatDigits: 6})"
        )
        pretty = browser.eval(
            "[...document.querySelectorAll('pre.result')].at(-1).textContent"
        )
        assert pretty.startswith("[[-2.82998"), pretty
        assert "\n [" in pretty, pretty
        browser.eval(
            "window.__pycalc.setDisplaySettings({numpyOutput: 'table',"
            " numpyRows: 2, numpyCols: 2})"
        )
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('.np-table tbody tr').length") == 2
        assert browser.eval("document.querySelectorAll('.np-table thead th').length") == 3
        browser.run_cell("np.arange(24).reshape(2, 3, 4)")
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('.np-tabs .np-tab').length") == 2
        browser.eval("window.__pycalc.setDisplaySettings({numpyTabs: 1})")
        time.sleep(0.2)
        assert browser.eval("document.querySelectorAll('.np-tabs .np-tab').length") == 1
        browser.eval(
            "window.__pycalc.setDisplaySettings({numpyOutput: 'default',"
            " numpyTabs: 5, numpyRows: 20, numpyCols: 10, floatDigits: 10})"
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
        plot_expr = browser.run_cell("plt.figure(figsize=(2, 1))\nplt.plot([1, 2, 3])")
        assert plot_expr["status"] == "ok" and plot_expr["images"] == 1, plot_expr
        assert plot_expr["result"].startswith("[<matplotlib"), plot_expr
        before = browser.eval("document.querySelectorAll('pre.result').length")
        browser.eval("window.__pycalc.setDisplaySettings({hidePlotResult: true})")
        time.sleep(0.2)
        after = browser.eval("document.querySelectorAll('pre.result').length")
        assert after == before - 1, (before, after)
        browser.eval("window.__pycalc.setDisplaySettings({hidePlotResult: false})")
        assert_no_network(browser)
        browser.screenshot(ART / "full314.png")
    log("  PASS full 314")


def test_full_0278() -> None:
    log("[6] full build / 0.27.8 classic")
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
    log("[7] custom library aliases")
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


def test_pwa() -> None:
    log("[3] PWA service worker / offline / file protocol")
    html = OUT / "full314.html"
    assets = ["full314.html", "manifest.json", "sw.js", "icon-192.png", "icon-512.png"]
    for name in assets:
        assert (OUT / name).exists(), name

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    handler = functools.partial(QuietHandler, directory=str(OUT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}/full314.html"
    profile = OUT / "profiles" / "pwa"
    shutil.rmtree(profile, ignore_errors=True)
    try:
        with Browser(url, profile=profile, timeout=180) as browser:
            browser.wait_ready(timeout=180)
            registration = browser.eval(
                "Promise.race([navigator.serviceWorker.ready.then((r) => ({"
                "scope: r.scope, state: r.active && r.active.state})),"
                " new Promise((_, reject) => setTimeout(() => reject("
                "new Error('service worker timeout')), 30000))])"
            )
            assert registration["state"] == "activated", registration
            deadline = time.time() + 30
            names = []
            while time.time() < deadline:
                names = browser.eval("caches.keys()")
                if names:
                    break
                time.sleep(0.25)
            assert any(name.startswith("pycalc-") for name in names), names
            cached = browser.eval(
                "caches.keys().then(async (names) => {"
                " const out = {};"
                " for (const name of names) {"
                "   const cache = await caches.open(name);"
                "   out[name] = (await cache.keys()).map((request) => request.url);"
                " } return out; })"
            )
            flat = [item for values in cached.values() for item in values]
            assert any(item.endswith("/full314.html") for item in flat), flat
            assert any(item.endswith("/manifest.json") for item in flat), flat
            assert any(item.endswith("/icon-192.png") for item in flat), flat

            # The page's fetch shim intentionally blocks external requests, so
            # read the manifest with XHR (the browser's manifest loader also
            # bypasses the page shim).
            manifest = browser.eval(
                "new Promise((resolve, reject) => {"
                " const request = new XMLHttpRequest();"
                " request.open('GET', './manifest.json');"
                " request.onload = () => resolve(JSON.parse(request.responseText));"
                " request.onerror = () => reject(new Error('manifest request failed'));"
                " request.send(); })"
            )
            assert manifest["start_url"] == "./", manifest
            assert manifest["display"] == "standalone", manifest

            browser.call(
                "Network.emulateNetworkConditions",
                {
                    "offline": True,
                    "latency": 0,
                    "downloadThroughput": 0,
                    "uploadThroughput": 0,
                },
            )
            browser.call("Page.reload", {"ignoreCache": True})
            browser.wait_ready(timeout=180)
            assert browser.eval("window.__pycalcVersion")["pyodide"] == "314.0.7"
            assert browser.run_cell("1 + 1")["result"] == "2"
            browser.call(
                "Network.emulateNetworkConditions",
                {
                    "offline": False,
                    "latency": 0,
                    "downloadThroughput": -1,
                    "uploadThroughput": -1,
                },
            )

        # file:// must skip SW registration and remain fully usable.
        with Browser(file_url(html), profile=OUT / "profiles" / "pwa-file", timeout=180) as browser:
            browser.wait_ready(timeout=180)
            assert browser.eval("navigator.serviceWorker.controller") is None
            assert browser.run_cell("1 + 1")["result"] == "2"
            assert not any("Uncaught" in line for line in browser.console), browser.console[-5:]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    log("  PASS PWA")


def test_new_features() -> None:
    log("[8] languages, libraries, tables, compact console, editor behaviour")
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
        time.sleep(0.8)
        popup = browser.eval("document.querySelector('.cm-tooltip-autocomplete')?.textContent || ''")
        assert "reshape" in popup, popup
        assert browser.eval("document.querySelector('#type-hint')?.textContent") == "arr : numpy.ndarray"

        # static inference even before the assignment is executed
        browser.eval("window.__pycalc.setEditorText('pending = np.linspace(1, 2)\\npending')")
        browser.eval("document.querySelector('.cm-content').focus()")
        browser.call("Input.insertText", {"text": ".re"})
        time.sleep(0.8)
        popup = browser.eval("document.querySelector('.cm-tooltip-autocomplete')?.textContent || ''")
        assert "reshape" in popup, popup
        assert browser.eval("document.querySelector('#type-hint')?.textContent") == "pending : numpy.ndarray"

        press(browser, "Escape", "Escape", 27)
        browser.eval("window.__pycalc.setEditorText('np.lin')")
        browser.eval("document.querySelector('.cm-content').focus()")
        press(browser, " ", "Space", 32, modifiers=2)
        time.sleep(1.2)
        popup = browser.eval("document.querySelector('.cm-tooltip-autocomplete')?.textContent || ''")
        assert "linspace" in popup, popup
        assert browser.eval("document.querySelector('#type-hint')?.textContent") == "np : module numpy"

        browser.eval("window.__pycalc.setEditorText('np.linspace(')")
        time.sleep(0.6)
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

        # compact number prompts insert at the cursor without clearing the editor
        prompt_texts = browser.eval(
            "[...document.querySelectorAll('.prompt-btn')].map((item) => item.textContent)"
        )
        assert prompt_texts and all(text.startswith("[") and text.endswith("]")
                                    for text in prompt_texts), prompt_texts
        assert not any("In [" in text or "Out[" in text for text in prompt_texts)
        browser.eval("window.__pycalc.setEditorText('12')")
        browser.eval("window.__pycalc.insertAtCursor('X')")
        assert browser.eval("window.__pycalc.getEditorValue()") == "12X"
        browser.eval("window.__pycalc.setEditorText('prefix ')")
        browser.eval(
            "[...document.querySelectorAll('.entry')]"
            ".find(e => e.textContent.includes('x = 1'))"
            ".querySelector('.prompt-btn.in').click()"
        )
        inserted_input = browser.eval("window.__pycalc.getEditorValue()")
        assert inserted_input.startswith("prefix x = 1"), inserted_input
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
        time.sleep(0.2)
        assert "\n" in browser.eval("window.__pycalc.getEditorValue()")
        browser.eval("window.__pycalc.setEditorText('2 + 3')")
        browser.eval("document.querySelector('.cm-content').focus()")
        press(browser, "Enter", "Enter", 13)
        deadline = time.time() + 5
        while time.time() < deadline and browser.eval("window.__pycalc.getEditorValue()"):
            time.sleep(0.05)
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
        browser.eval(
            "window.__pycalc.setDisplaySettings({numpyOutput: 'pretty',"
            " dataframeOutput: 'table', dataframeRows: 50, floatDigits: 8,"
            " hidePlotResult: true})"
        )
        browser.eval("new Promise(resolve => setTimeout(resolve, 400))")
        browser.call("Page.reload", {"ignoreCache": True})
        browser.wait_ready(timeout=180)
        ui = browser.eval("window.__pycalc.ui()")
        assert ui["language"] == "en" and ui["theme"] == "light" and ui["runKey"] == "enter", ui
        assert ui["sympyOutput"] == "math", ui
        assert ui["numpyOutput"] == "pretty" and ui["dataframeOutput"] == "table", ui
        assert ui["dataframeRows"] == 50 and ui["hidePlotResult"] is True, ui
        assert ui["floatDigits"] == 8, ui
        assert abs(float(ui["sidebarWidth"]) - width_after) < 2, (ui, width_after)
        assert browser.eval("document.querySelector('.side-card h3').textContent") == "Variables"
        assert browser.eval("document.querySelectorAll('.math-result math').length") >= 1
        assert browser.eval("document.documentElement.dataset.theme") == "light"
        assert browser.eval("window.__pycalc.active()")["libraries"] == ["sympy"]
        assert_no_network(browser)
        browser.screenshot(ART / "new-features.png")

        # history undo/redo: remove/restore an entry without touching variables
        browser.eval("window.__pycalc.createSession('history ops')")
        browser.wait_ready()
        browser.run_cell("u = 1")
        browser.run_cell("u + 1")
        assert browser.eval("document.getElementById('history-undo').disabled") is False
        assert browser.eval("document.getElementById('history-redo').disabled") is True
        browser.eval("document.getElementById('history-undo').click()")
        assert browser.eval("window.__pycalc.history()")[-1]["code"] == "u = 1"
        variables = browser.eval("window.__pycalc.variables()")
        assert any(row["name"] == "u" and row["value"] == "1" for row in variables), variables
        assert any(row["name"] == "ans" and row["value"] == "2" for row in variables), variables
        assert browser.eval("document.getElementById('history-redo').disabled") is False
        browser.eval("document.getElementById('history-redo').click()")
        assert browser.eval("window.__pycalc.history()")[-1]["code"] == "u + 1"
        assert browser.eval("document.getElementById('history-redo').disabled") is True
        browser.eval("document.getElementById('history-undo').click()")
        browser.run_cell("3 + 3")
        assert browser.eval("window.__pycalc.history()")[-1]["n"] == 2
        assert browser.eval("document.getElementById('history-redo').disabled") is True

        assert browser.eval("window.__pycalc.clearSession()") is True
        assert browser.eval("window.__pycalc.history()") == []
        assert browser.eval("window.__pycalc.variables()") == []
        assert browser.eval("window.__pycalc.active()")["name"] == "history ops"
        assert browser.eval("document.getElementById('history-undo').disabled") is True

    log("  PASS new features")


def test_cross_version_history() -> None:
    log("[9] cross-version history (314 -> 0.27.8)")
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
        test_pwa()
        test_worker_responsive()
        test_session_title()
        test_mobile_keyboard()
        test_ios_keyboard()
        test_full_0278()
        test_custom_libraries()
        test_dataframe_summary()
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
