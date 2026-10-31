from __future__ import annotations

import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pycalc_build.pwa import PWA_FILENAMES, write_pwa_files  # noqa: E402


class PwaTests(unittest.TestCase):
    def test_writes_all_siblings_and_injects_version_and_entry(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "pycalc.html"
            html = "<!doctype html><title>one</title>"
            files = write_pwa_files(output, html)
            self.assertEqual({path.name for path in files}, set(PWA_FILENAMES))
            for name in PWA_FILENAMES:
                self.assertTrue((Path(temp) / name).exists(), name)

            manifest = json.loads((Path(temp) / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["start_url"], "./")
            self.assertEqual(manifest["scope"], "./")
            self.assertEqual(manifest["display"], "standalone")
            self.assertEqual(
                [item["src"] for item in manifest["icons"]],
                ["./icon-192.png", "./icon-512.png"],
            )

            sw = (Path(temp) / "sw.js").read_text(encoding="utf-8")
            self.assertIn('const ENTRY = "./pycalc.html";', sw)
            match = re.search(r"pycalc-([0-9a-f]{8})", sw)
            self.assertIsNotNone(match)
            for size in (192, 512):
                data = (Path(temp) / f"icon-{size}.png").read_bytes()
                self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))

    def test_hash_changes_only_when_html_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "pycalc.html"
            write_pwa_files(output, "<title>one</title>")
            sw_one = (Path(temp) / "sw.js").read_text(encoding="utf-8")
            version_one = re.search(r"pycalc-([0-9a-f]{8})", sw_one).group(1)
            write_pwa_files(output, "<title>one</title>")
            sw_same = (Path(temp) / "sw.js").read_text(encoding="utf-8")
            self.assertEqual(sw_one, sw_same)
            write_pwa_files(output, "<title>two</title>")
            sw_two = (Path(temp) / "sw.js").read_text(encoding="utf-8")
            version_two = re.search(r"pycalc-([0-9a-f]{8})", sw_two).group(1)
            self.assertNotEqual(version_one, version_two)

    def test_index_uses_scope_as_entry(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "index.html"
            write_pwa_files(output, "<title>index</title>")
            sw = (Path(temp) / "sw.js").read_text(encoding="utf-8")
            self.assertIn('const ENTRY = "./";', sw)


if __name__ == "__main__":
    unittest.main()
