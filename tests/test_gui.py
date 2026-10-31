from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    import tkinter as tk
except Exception:  # pragma: no cover - tkinter is present on Windows
    tk = None


@unittest.skipUnless(tk is not None, "tkinter is not available")
class GuiLanguageTests(unittest.TestCase):
    def test_language_switch_updates_labels(self):
        import gui

        try:
            root = tk.Tk()
        except tk.TclError:
            self.skipTest("no display available")
        root.withdraw()
        app = gui.PyCalcGui(root)
        try:
            app.var_language.set("English")
            app._on_language_selected()
            labels = [widget.cget("text") for widget, _key in app._i18n_widgets]
            self.assertIn("PyCalc Builder", labels)
            self.assertIn("Build options", labels)

            app.var_language.set("日本語")
            app._on_language_selected()
            labels = [widget.cget("text") for widget, _key in app._i18n_widgets]
            self.assertIn("PyCalc ビルダー", labels)
            self.assertIn("ビルドオプション", labels)

            app.var_language.set("中文")
            app._on_language_selected()
            labels = [widget.cget("text") for widget, _key in app._i18n_widgets]
            self.assertIn("PyCalc 构建器", labels)
        finally:
            root.destroy()
            try:
                gui.SETTINGS_PATH.unlink()
            except OSError:
                pass

    def test_library_editor_settings_roundtrip(self):
        import gui

        try:
            root = tk.Tk()
        except tk.TclError:
            self.skipTest("no display available")
        root.withdraw()
        spec = "numpy, pandas\n\nnp = numpy\npd = pandas\n"
        app = gui.PyCalcGui(root)
        try:
            app._set_library_text(spec)
            app._save_settings()
        finally:
            root.destroy()

        try:
            root = tk.Tk()
            root.withdraw()
            app = gui.PyCalcGui(root)
            try:
                self.assertEqual(app._library_text(), spec)
            finally:
                root.destroy()
        finally:
            try:
                gui.SETTINGS_PATH.unlink()
            except OSError:
                pass

    def test_old_libs_setting_is_migrated(self):
        import json

        import gui

        gui.SETTINGS_PATH.write_text(
            json.dumps({"libs": ["numpy", "sympy"]}),
            encoding="utf-8",
        )
        try:
            try:
                root = tk.Tk()
            except tk.TclError:
                self.skipTest("no display available")
            root.withdraw()
            app = gui.PyCalcGui(root)
            try:
                text = app._library_text()
                self.assertIn("np = numpy", text)
                self.assertIn("sp = sympy", text)
            finally:
                root.destroy()
        finally:
            try:
                gui.SETTINGS_PATH.unlink()
            except OSError:
                pass


if __name__ == "__main__":
    unittest.main()
