#!/usr/bin/env python3
"""Tkinter GUI for building pycalc.html.

The GUI is a thin layer over pycalc_build.api. Sessions live inside the
generated HTML; this window only builds files.
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

import tkinter as tk
from tkinter import filedialog, messagebox, ttk
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
from pycalc_build.i18n import (  # noqa: E402
    LANGUAGES,
    LANGUAGE_NAMES,
    detect_language,
    tr,
)
from pycalc_build.libraries import (  # noqa: E402
    DEFAULT_LIBRARY_SPEC,
    LibrarySpecError,
    default_aliases,
    format_library_spec,
    parse_library_spec,
)

SETTINGS_PATH = ROOT / "gui_settings.json"
TESTED_VERSIONS = list(KNOWN_VERSIONS.keys())


class PyCalcGui:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.worker: threading.Thread | None = None
        self.queue: queue.Queue = queue.Queue()
        self.building = False
        self.last_output: Path | None = None
        self.open_after_build = False
        self.lang = detect_language()
        self._i18n_widgets: list[tuple[tk.Widget, str]] = []
        self._status_key = "gui.statusReady"
        self._status_params: dict = {}

        self.var_output = tk.StringVar(value=str(DEFAULT_OUTPUT))
        self.var_version = tk.StringVar(value=DEFAULT_PYODIDE_VERSION)
        self.var_offline = tk.BooleanVar(value=False)
        self.var_gzip = tk.BooleanVar(value=True)
        self.var_status = tk.StringVar(value="")
        self.var_language = tk.StringVar(value=LANGUAGE_NAMES[self.lang])

        self._setup_style()
        self._build_widgets()
        self._load_settings()
        self._apply_language(save=False)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.after(120, self._poll_queue)

    # ------------------------------------------------------------------
    # i18n helpers
    # ------------------------------------------------------------------

    def tr(self, key: str, **params) -> str:
        return tr(self.lang, key, **params)

    def _register(self, widget: tk.Widget, key: str) -> None:
        self._i18n_widgets.append((widget, key))
        self._set_text(widget, key)

    @staticmethod
    def _set_text(widget: tk.Widget, text: str) -> None:
        try:
            widget.configure(text=text)
        except tk.TclError:
            pass

    def _apply_language(self, save: bool = True) -> None:
        for widget, key in self._i18n_widgets:
            self._set_text(widget, self.tr(key))
        self.root.title(f"{APP_NAME} {APP_VERSION}")
        self.var_language.set(LANGUAGE_NAMES[self.lang])
        self._render_status()
        self.root.option_add("*TCombobox*Listbox.font", ("Segoe UI", 10))
        if save:
            self._save_settings()

    def _set_status(self, key: str, **params) -> None:
        self._status_key = key
        self._status_params = params
        self._render_status()

    def _render_status(self) -> None:
        self.var_status.set(self.tr(self._status_key, **self._status_params))

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
        outer.rowconfigure(6, weight=1)

        header = ttk.Frame(outer)
        header.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        title = ttk.Label(header, text="", style="Title.TLabel")
        title.pack(side="left")
        self._register(title, "gui.title")
        subtitle = ttk.Label(header, text="", style="Subtle.TLabel")
        subtitle.pack(side="left", padx=(12, 0), pady=(4, 0))
        self._register(subtitle, "gui.subtitle")

        lang_frame = ttk.Frame(header)
        lang_frame.pack(side="right")
        lang_label = ttk.Label(lang_frame, text="", style="Subtle.TLabel")
        lang_label.pack(side="left", padx=(0, 6))
        self._register(lang_label, "gui.language")
        self.lang_box = ttk.Combobox(
            lang_frame,
            textvariable=self.var_language,
            values=[LANGUAGE_NAMES[code] for code in LANGUAGES],
            width=10,
            state="readonly",
        )
        self.lang_box.pack(side="left")
        self.lang_box.bind("<<ComboboxSelected>>", self._on_language_selected)

        options = ttk.LabelFrame(outer, text="", padding=(12, 8, 12, 10))
        options.grid(row=1, column=0, sticky="ew")
        self._register(options, "gui.options")
        options.columnconfigure(1, weight=1)

        output_label = ttk.Label(options, text="")
        output_label.grid(row=0, column=0, sticky="w", pady=3)
        self._register(output_label, "gui.output")
        ttk.Entry(options, textvariable=self.var_output).grid(
            row=0, column=1, sticky="ew", padx=(8, 8), pady=3
        )
        browse = ttk.Button(options, text="", command=self._browse_output)
        browse.grid(row=0, column=2, sticky="ew", pady=3)
        self._register(browse, "gui.browse")

        libs_label = ttk.Label(options, text="")
        libs_label.grid(row=1, column=0, sticky="nw", pady=(6, 2))
        self._register(libs_label, "gui.libs")
        lib_editor = ttk.Frame(options)
        lib_editor.grid(row=1, column=1, columnspan=2, sticky="ew", padx=(8, 0), pady=(6, 2))
        lib_editor.columnconfigure(0, weight=1)
        self.lib_text = ScrolledText(lib_editor, height=9, wrap="word", undo=True)
        self.lib_text.grid(row=0, column=0, sticky="nsew")
        self.lib_text.configure(font=("Consolas", 9))
        lib_hint = ttk.Label(options, text="", style="Subtle.TLabel")
        lib_hint.grid(row=2, column=1, columnspan=2, sticky="w", padx=(8, 0), pady=(0, 4))
        self._register(lib_hint, "gui.libHint")

        version_label = ttk.Label(options, text="")
        version_label.grid(row=3, column=0, sticky="w", pady=3)
        self._register(version_label, "gui.version")
        version_row = ttk.Frame(options)
        version_row.grid(row=3, column=1, columnspan=2, sticky="w", padx=(8, 0), pady=3)
        self.version_box = ttk.Combobox(
            version_row,
            textvariable=self.var_version,
            values=TESTED_VERSIONS,
            width=16,
        )
        self.version_box.pack(side="left")
        version_hint = ttk.Label(version_row, text="", style="Subtle.TLabel")
        version_hint.pack(side="left", padx=(8, 0))
        self._register(version_hint, "gui.versionHint")

        checks = ttk.Frame(options)
        checks.grid(row=4, column=0, columnspan=3, sticky="w", pady=(6, 0))
        gzip = ttk.Checkbutton(checks, text="", variable=self.var_gzip)
        gzip.pack(side="left")
        self._register(gzip, "gui.gzip")
        offline = ttk.Checkbutton(checks, text="", variable=self.var_offline)
        offline.pack(side="left", padx=(18, 0))
        self._register(offline, "gui.offline")

        actions = ttk.Frame(outer)
        actions.grid(row=2, column=0, sticky="ew", pady=(12, 4))
        self.build_btn = ttk.Button(
            actions, text="", style="Build.TButton", command=lambda: self._start_build(False)
        )
        self.build_btn.pack(side="left")
        self._register(self.build_btn, "gui.build")
        self.build_open_btn = ttk.Button(
            actions, text="", command=lambda: self._start_build(True)
        )
        self.build_open_btn.pack(side="left", padx=(8, 0))
        self._register(self.build_open_btn, "gui.buildOpen")
        self.open_btn = ttk.Button(actions, text="", command=self._open_output)
        self.open_btn.pack(side="left", padx=(8, 0))
        self.open_btn.state(["disabled"])
        self._register(self.open_btn, "gui.openOutput")

        self.progress = ttk.Progressbar(outer, mode="indeterminate")
        self.progress.grid(row=3, column=0, sticky="ew", pady=(6, 4))
        self.progress.grid_remove()

        status_row = ttk.Frame(outer)
        status_row.grid(row=4, column=0, sticky="ew", pady=(0, 6))
        ttk.Label(status_row, textvariable=self.var_status, style="Subtle.TLabel").pack(side="left")
        session_note = ttk.Label(status_row, text="", style="Subtle.TLabel")
        session_note.pack(side="right")
        self._register(session_note, "gui.sessionNote")

        log_frame = ttk.LabelFrame(outer, text="", padding=(8, 6))
        log_frame.grid(row=6, column=0, sticky="nsew")
        self._register(log_frame, "gui.log")
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        self.log = ScrolledText(log_frame, height=18, state="disabled", wrap="word")
        self.log.grid(row=0, column=0, sticky="nsew")
        self.log.configure(font=("Consolas", 9))

    # ------------------------------------------------------------------
    # settings
    # ------------------------------------------------------------------

    def _library_text(self) -> str:
        return self.lib_text.get("1.0", "end-1c")

    def _set_library_text(self, text: str) -> None:
        self.lib_text.delete("1.0", "end")
        self.lib_text.insert("1.0", text)

    def _load_settings(self) -> None:
        data: dict = {}
        if SETTINGS_PATH.exists():
            try:
                loaded = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data = loaded
            except Exception:
                data = {}
        language = data.get("language")
        if language in LANGUAGES:
            self.lang = language
        if isinstance(data.get("output"), str):
            self.var_output.set(data["output"])
        if isinstance(data.get("pyodide_version"), str):
            self.var_version.set(data["pyodide_version"])
        self.var_offline.set(bool(data.get("offline", False)))
        self.var_gzip.set(bool(data.get("gzip", True)))

        spec = data.get("library_spec")
        if not isinstance(spec, str):
            old_libs = data.get("libs")
            if isinstance(old_libs, list) and old_libs:
                packages = [str(name) for name in old_libs if str(name)]
                spec = format_library_spec(packages, default_aliases(packages))
            else:
                spec = DEFAULT_LIBRARY_SPEC
        self._set_library_text(spec)

    def _save_settings(self) -> None:
        data = {
            "language": self.lang,
            "output": self.var_output.get(),
            "pyodide_version": self.var_version.get(),
            "library_spec": self._library_text(),
            "offline": self.var_offline.get(),
            "gzip": self.var_gzip.get(),
        }
        try:
            SETTINGS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            pass

    def _on_language_selected(self, _event=None) -> None:
        display = self.var_language.get()
        for code, name in LANGUAGE_NAMES.items():
            if name == display:
                self.lang = code
                break
        self._apply_language()

    # ------------------------------------------------------------------
    # actions
    # ------------------------------------------------------------------

    def _browse_output(self) -> None:
        initial = Path(self.var_output.get() or DEFAULT_OUTPUT)
        chosen = filedialog.asksaveasfilename(
            title=self.tr("gui.output"),
            defaultextension=".html",
            filetypes=[("HTML", "*.html"), ("All files", "*.*")],
            initialdir=str(initial.parent if initial.parent.exists() else ROOT),
            initialfile=initial.name,
        )
        if chosen:
            self.var_output.set(chosen)

    def _open_output(self) -> None:
        path = self.last_output or Path(self.var_output.get())
        if path.exists():
            self._open_path(path)
        else:
            messagebox.showinfo(self.tr("gui.openOutput"), self.tr("gui.errorOutput"))

    @staticmethod
    def _open_path(path: Path) -> None:
        try:
            if sys.platform == "win32":
                os.startfile(str(path))  # type: ignore[attr-defined]
            else:
                webbrowser.open(path.resolve().as_uri())
        except Exception as exc:  # noqa: BLE001 - GUI boundary
            messagebox.showerror("Error", f"{path}\n\n{exc}")

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
        try:
            packages, aliases = parse_library_spec(self._library_text())
        except LibrarySpecError as exc:
            messagebox.showerror(self.tr("gui.errorLibraries"), str(exc))
            self._set_status("gui.statusFailed")
            return
        output_text = self.var_output.get().strip()
        if not output_text:
            messagebox.showerror(self.tr("gui.errorTitle"), self.tr("gui.errorOutput"))
            return
        output = Path(output_text)
        if output.exists() and not messagebox.askyesno(
            self.tr("gui.overwriteTitle"),
            self.tr("gui.overwriteBody", path=str(output)),
        ):
            return
        version = self.var_version.get().strip()
        if not version:
            messagebox.showerror(self.tr("gui.errorTitle"), self.tr("gui.errorVersion"))
            return

        self._save_settings()
        self.building = True
        self.open_after_build = open_after
        self.last_output = None
        self._set_busy(True)
        self._set_status("gui.statusBuilding")
        self._append_log("=" * 72)
        self._append_log(f"PyCalc {APP_VERSION}")

        config = BuildConfig(
            libs=packages,
            aliases=aliases,
            output=output,
            pyodide_version=version,
            offline=self.var_offline.get(),
            gzip_wasm=self.var_gzip.get(),
            lang=self.lang,
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
            self._set_status(
                "gui.statusDone",
                name=result.output.name,
                size=f"{result.size:,}",
                duration=f"{result.duration:.1f}",
            )
            if self.open_after_build:
                self._open_path(result.output)
        else:
            self._set_status("gui.statusCache")
        for warning in result.warnings:
            self._append_log(f"[{self.tr('gui.warning')}] {warning}")

    def _on_build_error(self, message: str, details: str) -> None:
        self.building = False
        self._set_busy(False)
        self._set_status("gui.statusFailed")
        self._append_log(self.tr("build.failed", error=message))
        self._append_log(details)
        messagebox.showerror(self.tr("gui.buildFailed"), message)

    def _set_busy(self, busy: bool) -> None:
        state = ["disabled"] if busy else ["!disabled"]
        for widget in (self.build_btn, self.build_open_btn, self.version_box):
            widget.state(state)
        self.lib_text.configure(state="disabled" if busy else "normal")
        if busy:
            self.progress.grid()
            self.progress.start(12)
        else:
            self.progress.stop()
            self.progress.grid_remove()

    def _on_close(self) -> None:
        if self.building:
            if not messagebox.askyesno(
                self.tr("gui.statusBuilding"), self.tr("gui.closeWhileBuilding")
            ):
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
