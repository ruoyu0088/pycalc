from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pycalc_build.api import available_libraries  # noqa: E402
from pycalc_build.libraries import (  # noqa: E402
    DEFAULT_LIBRARY_SPEC,
    LibrarySpecError,
    default_aliases,
    format_library_spec,
    parse_alias_lines,
    parse_library_spec,
)
from pycalc_build.resolve import Package  # noqa: E402


class LibrarySpecTests(unittest.TestCase):
    def test_default_spec(self):
        packages, aliases = parse_library_spec(DEFAULT_LIBRARY_SPEC)
        self.assertEqual(packages, ["numpy", "matplotlib", "sympy"])
        self.assertEqual(
            aliases,
            {"np": "numpy", "plt": "matplotlib.pyplot", "sp": "sympy"},
        )

    def test_user_example(self):
        packages, aliases = parse_library_spec(
            "numpy,matplotlib,sympy,pandas\n"
            "np:numpy\n"
            "plt:matplotlib.pyplot\n"
            "sp:sympy\n"
            "pd:pandas\n"
        )
        self.assertEqual(packages, ["numpy", "matplotlib", "sympy", "pandas"])
        self.assertEqual(aliases["pd"], "pandas")
        self.assertEqual(aliases["plt"], "matplotlib.pyplot")

    def test_sections_and_comments(self):
        packages, aliases = parse_library_spec(
            "# comment\n"
            "[packages]\n"
            "numpy\n"
            "pandas\n"
            "\n"
            "[aliases]\n"
            "np = numpy  # inline\n"
            "pd: pandas\n"
        )
        self.assertEqual(packages, ["numpy", "pandas"])
        self.assertEqual(aliases, {"np": "numpy", "pd": "pandas"})

    def test_format_roundtrip(self):
        text = format_library_spec(["numpy", "pandas"], {"np": "numpy", "pd": "pandas"})
        self.assertEqual(parse_library_spec(text), (["numpy", "pandas"], {"np": "numpy", "pd": "pandas"}))

    def test_invalid_duplicates(self):
        with self.assertRaisesRegex(LibrarySpecError, "defined twice"):
            parse_library_spec("numpy\nnp = numpy\nnp = numpy\n")
        with self.assertRaisesRegex(LibrarySpecError, "already mapped"):
            parse_library_spec("numpy\nnp = numpy\nnumpy = numpy\n")
        with self.assertRaisesRegex(LibrarySpecError, "invalid alias"):
            parse_library_spec("numpy\nfor = numpy\n")

    def test_alias_lines(self):
        self.assertEqual(
            parse_alias_lines(["np=numpy", "pd:pandas"]),
            {"np": "numpy", "pd": "pandas"},
        )

    def test_defaults(self):
        self.assertEqual(
            default_aliases(["numpy", "matplotlib", "sympy", "pandas"]),
            {
                "np": "numpy",
                "plt": "matplotlib.pyplot",
                "sp": "sympy",
                "pd": "pandas",
            },
        )

    def test_provider_resolution_and_error(self):
        packages = [
            Package(
                name="numpy",
                version="1",
                file_name="numpy.whl",
                sha256="",
                depends=(),
                package_type="package",
                info={"imports": ["numpy"]},
            ),
            Package(
                name="matplotlib",
                version="1",
                file_name="matplotlib.whl",
                sha256="",
                depends=("numpy",),
                package_type="package",
                info={"imports": ["matplotlib", "pylab"]},
            ),
        ]
        rows = available_libraries(packages, {"plt": "matplotlib.pyplot"})
        self.assertEqual(rows[0]["package"], "matplotlib")
        self.assertEqual(rows[0]["id"], "matplotlib.pyplot")
        with self.assertRaisesRegex(ValueError, "no selected package"):
            available_libraries(packages, {"pd": "pandas"})


if __name__ == "__main__":
    unittest.main()
