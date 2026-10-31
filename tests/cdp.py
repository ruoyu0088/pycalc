"""Minimal Chrome DevTools Protocol driver for PyCalc browser tests.

We deliberately avoid Playwright/Selenium: the only dependency is
``websocket-client`` (already present in the pixi environment) and a locally
installed Chrome/Edge.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

import websocket


def find_browser() -> str:
    env = os.environ.get("PYCALC_BROWSER")
    if env and Path(env).exists():
        return env
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    raise RuntimeError("找不到 Chrome/Edge；可设置环境变量 PYCALC_BROWSER")


class Browser:
    def __init__(
        self,
        url: str,
        *,
        profile: Path | None = None,
        headless: bool = True,
        port: int = 0,
        timeout: float = 120.0,
        window_size: str = "1280,900",
    ) -> None:
        self.browser_path = find_browser()
        self.url = url
        self.timeout = timeout
        self._temp_profile = profile is None
        self.profile = Path(profile) if profile else Path(tempfile.mkdtemp(prefix="pycalc-profile-"))
        self.profile.mkdir(parents=True, exist_ok=True)
        self.port = port or self._free_port()
        self.window_size = window_size
        self.proc: subprocess.Popen | None = None
        self.ws: websocket.WebSocket | None = None
        self._id = 0
        self.console: list[str] = []
        self.requests: list[str] = []

    @staticmethod
    def _free_port() -> int:
        import socket

        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        return port

    def __enter__(self) -> "Browser":
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def start(self) -> None:
        args = [
            self.browser_path,
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--remote-allow-origins=*",
            f"--remote-debugging-port={self.port}",
            f"--user-data-dir={self.profile}",
            f"--window-size={self.window_size}",
            self.url,
        ]
        self.proc = subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        page = self._wait_for_page()
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=60)
        self.call("Runtime.enable")
        self.call("Page.enable")
        self.call("Log.enable")
        self.call("Network.enable")

    def _wait_for_page(self) -> dict[str, Any]:
        deadline = time.time() + 30
        last_error: Exception | None = None
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{self.port}/json/list", timeout=1
                ) as response:
                    tabs = json.load(response)
                for tab in tabs:
                    if tab.get("type") == "page":
                        return tab
            except Exception as exc:  # noqa: BLE001 - startup polling
                last_error = exc
            time.sleep(0.1)
        raise RuntimeError(f"DevTools 没有启动：{last_error}")

    def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.ws:
            raise RuntimeError("浏览器尚未启动")
        self._id += 1
        message_id = self._id
        self.ws.send(json.dumps({"id": message_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == message_id:
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message.get("result", {})
            self._handle_event(message)

    def _handle_event(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        params = message.get("params", {})
        if method == "Runtime.consoleAPICalled":
            parts = []
            for arg in params.get("args", []):
                parts.append(str(arg.get("value", arg.get("description", ""))))
            self.console.append(" ".join(parts))
        elif method == "Log.entryAdded":
            entry = params.get("entry", {})
            self.console.append(f"{entry.get('level')}: {entry.get('text')}")
        elif method == "Network.requestWillBeSent":
            self.requests.append(params.get("request", {}).get("url", ""))

    def eval(self, expression: str, *, await_promise: bool = True) -> Any:
        result = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
                "userGesture": True,
            },
        )
        if "exceptionDetails" in result:
            detail = result["exceptionDetails"]
            text = detail.get("exception", {}).get("description") or detail.get("text")
            raise RuntimeError(f"页面脚本异常：{text}")
        return result.get("result", {}).get("value")

    def wait_ready(self, timeout: float | None = None) -> None:
        deadline = time.time() + (timeout if timeout is not None else self.timeout)
        last = None
        while time.time() < deadline:
            error = self.eval("window.__pycalcBootError || null")
            if error:
                raise RuntimeError(f"PyCalc 启动失败：{error}")
            ready = self.eval("window.__pycalcReady === true")
            if ready:
                return
            last = self.eval("document.getElementById('overlay-detail')?.textContent || ''")
            time.sleep(0.25)
        raise TimeoutError(f"PyCalc 在 {timeout or self.timeout}s 内未就绪；最后状态：{last}")

    def run_cell(self, code: str) -> dict[str, Any]:
        expression = (
            "(async () => { const e = await window.__pycalc.runCell("
            + json.dumps(code, ensure_ascii=False)
            + "); return {status:e.status, result:e.result, error:e.error, "
            "stdout:e.stdout, stderr:e.stderr, images:(e.images||[]).length}; })()"
        )
        return self.eval(expression)

    def screenshot(self, path: Path) -> None:
        data = self.call("Page.captureScreenshot", {"format": "png"})
        Path(path).write_bytes(base64.b64decode(data["data"]))

    def close(self) -> None:
        try:
            if self.ws:
                try:
                    self.call("Browser.close")
                except Exception:
                    pass
                self.ws.close()
        finally:
            if self.proc:
                try:
                    self.proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
            if self._temp_profile:
                shutil.rmtree(self.profile, ignore_errors=True)


def file_url(path: Path) -> str:
    return Path(path).resolve().as_uri()
