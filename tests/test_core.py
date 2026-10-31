from __future__ import annotations

import base64
import gzip
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pycalc_build.api import normalize_libs  # noqa: E402
from pycalc_build.config import APP_DB_NAME, APP_ID, DEFAULT_PYODIDE_VERSION  # noqa: E402
from pycalc_build.embed import encode_asset  # noqa: E402
from pycalc_build.render import RenderError, _check_inline_script  # noqa: E402
from pycalc_build.resolve import resolve_closure  # noqa: E402
from pycalc_build.runtime import validate_version  # noqa: E402

LOCK = {
    "info": {"python": "3.14.2"},
    "packages": {
        "matplotlib": {
            "version": "3.10.8",
            "file_name": "matplotlib.whl",
            "sha256": "a" * 64,
            "depends": ["numpy", "pillow"],
            "package_type": "package",
        },
        "numpy": {
            "version": "2.4.6",
            "file_name": "numpy.whl",
            "sha256": "b" * 64,
            "depends": [],
            "package_type": "package",
        },
        "pillow": {
            "version": "12.2.0",
            "file_name": "pillow.whl",
            "sha256": "c" * 64,
            "depends": [],
            "package_type": "package",
        },
    },
}


class CoreTests(unittest.TestCase):
    def test_normalize_libs(self):
        self.assertEqual(
            normalize_libs(["numpy, sympy", " numpy ", "", "matplotlib"]),
            ["numpy", "sympy", "matplotlib"],
        )

    def test_closure_orders_dependencies_first(self):
        names = [pkg.name for pkg in resolve_closure(LOCK, ["matplotlib"])]
        self.assertLess(names.index("numpy"), names.index("matplotlib"))
        self.assertLess(names.index("pillow"), names.index("matplotlib"))
        self.assertEqual(set(names), {"numpy", "pillow", "matplotlib"})

    def test_closure_deduplicates(self):
        closure = resolve_closure(LOCK, ["numpy", "matplotlib", "numpy"])
        self.assertEqual([pkg.name for pkg in closure].count("numpy"), 1)

    def test_closure_missing_package_has_hint(self):
        with self.assertRaisesRegex(ValueError, "没有库"):
            resolve_closure(LOCK, ["numpyy"])

    def test_closure_cycle_detected(self):
        lock = {
            "packages": {
                "a": {"version": "1", "file_name": "a", "depends": ["b"], "package_type": "package"},
                "b": {"version": "1", "file_name": "b", "depends": ["a"], "package_type": "package"},
            }
        }
        with self.assertRaisesRegex(ValueError, "循环依赖"):
            resolve_closure(lock, ["a"])

    def test_encode_asset_gzip_roundtrip(self):
        raw = b"x" * 100_000
        encoded = encode_asset(raw, gzip_ok=True)
        self.assertEqual(encoded["enc"], "gzip")
        self.assertEqual(encoded["size"], len(raw))
        self.assertEqual(gzip.decompress(base64.b64decode(encoded["data"])), raw)

    def test_encode_asset_small_stays_raw(self):
        encoded = encode_asset(b"abc", gzip_ok=True)
        self.assertEqual(encoded["enc"], "raw")
        self.assertEqual(base64.b64decode(encoded["data"]), b"abc")

    def test_inline_script_rejects_script_close(self):
        with self.assertRaises(RenderError):
            _check_inline_script("var x = '</script>';", "test")

    def test_validate_version(self):
        self.assertEqual(validate_version(" 314.0.7 "), "314.0.7")
        with self.assertRaises(ValueError):
            validate_version("../../etc/passwd")
        with self.assertRaises(ValueError):
            validate_version("")

    def test_stable_database_identity(self):
        # Tripwire: changing these makes old sessions invisible.
        self.assertEqual(APP_DB_NAME, "pycalc-app-v1")
        self.assertEqual(APP_ID, "pycalc-app-5c0f9e2a-8f4b-4f1e-9d7a-2b6c1e8f3a41")
        self.assertEqual(DEFAULT_PYODIDE_VERSION, "314.0.7")


if __name__ == "__main__":
    unittest.main()
