#!/usr/bin/env python3
"""Tkinter GUI for building pycalc.html.

The GUI is deliberately small: choose libraries, Pyodide version and output
path, then build.  Sessions live inside the generated HTML (IndexedDB), not in
this builder.
"""

from __future__ import annotations

import json
import os
import queue
import sys
import threading
import traceback
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox
import tkinter as tk
from tkinter import ttk
from tkinter.scrolledtext import ScrolledText

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pycalc_build.api import BuildConfig, build  # noqa: E402
from pycalc_build.config import (  # noqa: E402
    APP_NAME,
    APP_VERSION,
    DEFAULT_OUTPUT,
    DEFAULT_PYODIDE_VERSION,
    KNOWN_VERSIONS,
)

SETTINGS_PATH = ROOT / "gui_settings.json"
TESTED_VERSIONS = list(KNOWN_VERSIONS.keys())
KNOWN_LIBS = ["numpy", "sympy", "matplotlib"]


def open_path(path: Path) -> None:
    try:
        if sys.platform == "win32":
            os.startfile(str(path))  # type: ignore[attr-defined]
        else:
            webbrowser.open(path.resolve().as_uri())
    except Exception as exc:  # noqa: BLE001 - GUI boundary
        messagebox.showerror("打开失败", f"无法打开：\n{path}\n\n{exc}")


class PyCalcGui:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.worker: threading.Thread | None = None
        self.queue: queue.Queue = queue.Queue()
        self.building = False
        self.last_output: Path | None = None
        self.open_after_build = False

        root.title(f"{APP_NAME} 构建器 {APP_VERSION}")
        root.geometry("880x680")
        root.minsize(760, 560)

        self.var_output = tk.StringVar(value=str(DEFAULT_OUTPUT))
        self.var_version = tk.StringVar(value=DEFAULT_PYODIDE_VERSION)
        self.var_offline = tk.BooleanVar(value=False)
        self.var_gzip = tk.BooleanVar(value=True)
        self.var_extra = tk.StringVar(value="")
        self.var_status = tk.StringVar(value="就绪")
        self.var_libs = {name: tk.BooleanVar(value=True) for name in KNOWN_LIBS}

        self._setup_style()
        self._build_widgets()
        self._load_settings()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.after(120, self._poll_queue)

    # ------------------------------------------------------------------
    # layout
    # ------------------------------------------------------------------

    def _setup_style(self) -> None:
        style = ttk.Style(self.root)
        for theme in ("vista", "clam"):
            if theme in style.theme_names():
                try:
                    style.theme_use(theme)
                    break
                except tk.TclError:
                    continue
        try:
            self.root.tk.call("tk", "scaling", 1.15)
        except tk.TclError:
            pass
        style.configure("Title.TLabel", font=("Segoe UI", 15, "bold"))
        style.configure("Subtle.TLabel", foreground="#6b7280")
        style.configure("Build.TButton", font=("Segoe UI", 10, "bold"))

    def _build_widgets(self) -> None:
        outer = ttk.Frame(self.root, padding=(18, 14, 18, 14))
        outer.grid(row=0, column=0, sticky="nsew")
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        outer.columnconfigure(0, weight=1)
        outer.rowconfigure(5, weight=1)

        header = ttk.Frame(outer)
        header.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        ttk.Label(header, text="PyCalc 构建器", style="Title.TLabel").pack(side="left")
        ttk.Label(
            header,
            text="把 Pyodide 和选定库打包成一个可双击运行的单文件 HTML",
            style="Subtle.TLabel",
        ).pack(side="left", padx=(12, 0), pady=(4, 0))

        options = ttk.LabelFrame(outer, text="构建选项", padding=(12, 8, 12, 10))
        options.grid(row=1, column=0, sticky="ew")
        options.columnconfigure(1, weight=1)

        ttk.Label(options, text="输出文件").grid(row=0, column=0, sticky="w", pady=3)
        ttk.Entry(options, textvariable=self.var_output).grid(
            row=0, column=1, sticky="ew", padx=(8, 8), pady=3
        )
        ttk.Button(options, text="浏览…", command=self._browse_output).grid(
            row=0, column=2, sticky="ew", pady=3
        )

        ttk.Label(options, text="包含库").grid(row=1, column=0, sticky="nw", pady=6)
        libs_frame = ttk.Frame(options)
        libs_frame.grid(row=1, column=1, columnspan=2, sticky="w", padx=(8, 0), pady=6)
        for name in KNOWN_LIBS:
            ttk.Checkbutton(libs_frame, text=name, variable=self.var_libs[name]).pack(
                side="left", padx=(0, 14)
            )
        ttk.Label(libs_frame, text="其他包").pack(side="left", padx=(8, 4))
        ttk.Entry(libs_frame, textvariable=self.var_extra, width=22).pack(side="left")
        ttk.Label(
            libs_frame, text="（逗号分隔，需存在于 Pyodide lock）", style="Subtle.TLabel"
        ).pack(side="left", padx=(6, 0))

        ttk.Label(options, text="Pyodide 版本").grid(row=2, column=0, sticky="w", pady=3)
        version_row = ttk.Frame(options)
        version_row.grid(row=2, column=1, columnspan=2, sticky="w", padx=(8, 0), pady=3)
        self.version_box = ttk.Combobox(
            version_row,
            textvariable=self.var_version,
            values=TESTED_VERSIONS,
            width=16,
        )
        self.version_box.pack(side="left")
        ttk.Label(
            version_row,
            text="（默认最新；0.27.8 为 Python 3.12 LTS 兼容版）",
            style="Subtle.TLabel",
        ).pack(side="left", padx=(8, 0))

        checks = ttk.Frame(options)
        checks.grid(row=3, column=0, columnspan=3, sticky="w", pady=(6, 0))
        ttk.Checkbutton(checks, text="gzip 压缩 wasm（推荐，文件更小）", variable=self.var_gzip).pack(
            side="left"
        )
        ttk.Checkbutton(checks, text="仅使用缓存（离线）", variable=self.var_offline).pack(
            side="left", padx=(18, 0)
        )

        actions = ttk.Frame(outer)
        actions.grid(row=2, column=0, sticky="ew", pady=(12, 4))
        self.build_btn = ttk.Button(
            actions, text="构建", style="Build.TButton", command=lambda: self._start_build(False)
        )
        self.build_btn.pack(side="left")
        self.build_open_btn = ttk.Button(
            actions, text="构建并打开", command=lambda: self._start_build(True)
        )
        self.build_open_btn.pack(side="left", padx=(8, 0))
        self.open_btn = ttk.Button(actions, text="打开输出文件", command=self._open_output)
        self.open_btn.pack(side="left", padx=(8, 0))
        self.open_btn.state(["disabled"])

        self.progress = ttk.Progressbar(outer, mode="indeterminate")
        self.progress.grid(row=3, column=0, sticky="ew", pady=(6, 4))
        self.progress.grid_remove()

        status_row = ttk.Frame(outer)
        status_row.grid(row=4, column=0, sticky="ew", pady=(0, 6))
        ttk.Label(status_row, textvariable=self.var_status, style="Subtle.TLabel").pack(side="left")
        ttk.Label(
            status_row,
            text="会话数据在浏览器中，与输出路径无关。",
            style="Subtle.TLabel",
        ).pack(side="right")

        log_frame = ttk.LabelFrame(outer, text="构建日志", padding=(8, 6))
        log_frame.grid(row=5, column=0, sticky="nsew")
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        self.log = ScrolledText(log_frame, height=18, state="disabled", wrap="word")
        self.log.grid(row=0, column=0, sticky="nsew")
        self.log.configure(font=("Consolas", 9))

    # ------------------------------------------------------------------
    # settings / helpers
    # ------------------------------------------------------------------

    def _load_settings(self) -> None:
        if not SETTINGS_PATH.exists():
            return
        try:
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except Exception:
            return
        if isinstance(data.get("output"), str):
            self.var_output.set(data["output"])
        if isinstance(data.get("pyodide_version"), str):
            self.var_version.set(data["pyodide_version"])
        libs = data.get("libs")
        if isinstance(libs, list):
            for name in KNOWN_LIBS:
                self.var_libs[name].set(name in libs)
            extra = [name for name in libs if name not in KNOWN_LIBS]
            self.var_extra.set(", ".join(extra))
        self.var_offline.set(bool(data.get("offline", False)))
        self.var_gzip.set(bool(data.get("gzip", True)))

    def _save_settings(self) -> None:
        data = {
            "output": self.var_output.get(),
            "pyodide_version": self.var_version.get(),
            "libs": self._selected_libs(),
            "offline": self.var_offline.get(),
            "gzip": self.var_gzip.get(),
        }
        try:
            SETTINGS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            pass

    def _selected_libs(self) -> list[str]:
        libs = [name for name in KNOWN_LIBS if self.var_libs[name].get()]
        extra = self.var_extra.get().replace(",", " ").split()
        for name in extra:
            if name not in libs:
                libs.append(name)
        return libs

    def _browse_output(self) -> None:
        initial = Path(self.var_output.get() or DEFAULT_OUTPUT)
        chosen = filedialog.asksaveasfilename(
            title="选择输出 HTML",
            defaultextension=".html",
            filetypes=[("HTML 文件", "*.html"), ("所有文件", "*.*")],
            initialdir=str(initial.parent if initial.parent.exists() else ROOT),
            initialfile=initial.name,
        )
        if chosen:
            self.var_output.set(chosen)

    def _open_output(self) -> None:
        path = self.last_output or Path(self.var_output.get())
        if path.exists():
            open_path(path)
        else:
            messagebox.showinfo("还没有输出", "请先构建 HTML。")

    def _append_log(self, message: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", message + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    # ------------------------------------------------------------------
    # build lifecycle
    # ------------------------------------------------------------------

    def _start_build(self, open_after: bool) -> None:
        if self.building:
            return
        libs = self._selected_libs()
        output_text = self.var_output.get().strip()
        if not output_text:
            messagebox.showerror("输出路径为空", "请选择一个输出 HTML 路径。")
            return
        output = Path(output_text)
        if output.exists() and not messagebox.askyesno(
            "覆盖文件", f"{output}\n已存在，是否覆盖？"
        ):
            return
        version = self.var_version.get().strip()
        if not version:
            messagebox.showerror("版本为空", "请填写 Pyodide 版本，例如 314.0.7。")
            return

        self._save_settings()
        self.building = True
        self.open_after_build = open_after
        self.last_output = None
        self._set_busy(True)
        self.var_status.set("正在准备构建…")
        self._append_log("=" * 72)
        self._append_log(f"{APP_NAME} {APP_VERSION}：构建开始")
        self._append_log(f"库：{', '.join(libs) if libs else '（仅标准库）'}；版本：{version}")

        config = BuildConfig(
            libs=libs,
            output=output,
            pyodide_version=version,
            offline=self.var_offline.get(),
            gzip_wasm=self.var_gzip.get(),
        )

        def worker() -> None:
            try:
                result = build(config, log=lambda message: self.queue.put(("log", message)))
                self.queue.put(("done", result))
            except Exception as exc:  # noqa: BLE001 - reported in the GUI
                self.queue.put(("error", (str(exc), traceback.format_exc())))

        self.worker = threading.Thread(target=worker, daemon=True)
        self.worker.start()

    def _poll_queue(self) -> None:
        try:
            while True:
                kind, payload = self.queue.get_nowait()
                if kind == "log":
                    self._append_log(str(payload))
                elif kind == "done":
                    self._on_build_done(payload)
                elif kind == "error":
                    self._on_build_error(*payload)
        except queue.Empty:
            pass
        self.root.after(120, self._poll_queue)

    def _on_build_done(self, result) -> None:
        self.building = False
        self._set_busy(False)
        self.last_output = result.output
        if result.output:
            self.open_btn.state(["!disabled"])
            self.var_status.set(
                f"完成：{result.output.name} · {result.size:,} 字节 · {result.duration:.1f}s"
            )
            self._append_log(f"构建完成：{result.output} ({result.size:,} bytes)")
            if self.open_after_build:
                open_path(result.output)
        else:
            self.var_status.set("缓存准备完成")
        for warning in result.warnings:
            self._append_log(f"[警告] {warning}")

    def _on_build_error(self, message: str, details: str) -> None:
        self.building = False
        self._set_busy(False)
        self.var_status.set("构建失败")
        self._append_log("构建失败：")
        self._append_log(details)
        messagebox.showerror("构建失败", message)

    def _set_busy(self, busy: bool) -> None:
        state = ["disabled"] if busy else ["!disabled"]
        for widget in (self.build_btn, self.build_open_btn, self.version_box):
            widget.state(state)
        if busy:
            self.progress.grid()
            self.progress.start(12)
        else:
            self.progress.stop()
            self.progress.grid_remove()

    def _on_close(self) -> None:
        if self.building:
            if not messagebox.askyesno("正在构建", "构建仍在进行，确定退出吗？"):
                return
        self._save_settings()
        self.root.destroy()


def main() -> int:
    if sys.platform == "win32":
        try:
            import ctypes

            ctypes.windll.shcore.SetProcessDpiAwareness(1)  # type: ignore[attr-defined]
        except Exception:
            pass
    root = tk.Tk()
    PyCalcGui(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
