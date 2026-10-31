from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pycalc_build.i18n import MESSAGES  # noqa: E402
from pycalc_build.keyboard_layout import LAYOUT  # noqa: E402


def walk_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"labelKey", "emptyKey", "titleKey"}:
                yield child
            else:
                yield from walk_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_keys(child)


class KeyboardLayoutTests(unittest.TestCase):
    def test_tabs_and_calc_grid(self):
        tabs = {tab["id"]: tab for tab in LAYOUT["tabs"]}
        self.assertEqual(list(tabs), ["calc", "en"])
        calc = tabs["calc"]
        self.assertEqual(calc["type"], "split")
        self.assertEqual(len(calc["left"]["items"]), 4)
        self.assertEqual(calc["right"]["columns"], 5)
        self.assertEqual(len(calc["right"]["rows"]), 5)
        for row in calc["right"]["rows"]:
            total = sum(int(item.get("span", 1)) for item in row)
            self.assertEqual(total, 5)
        self.assertEqual(calc["right"]["rows"][-1][0]["label"], "0")
        self.assertEqual(calc["right"]["rows"][-1][1]["action"], "run")

    def test_en_views(self):
        en = next(tab for tab in LAYOUT["tabs"] if tab["id"] == "en")
        self.assertEqual(en["type"], "keyboard")
        self.assertEqual(set(en["views"]), {"letters", "numbers"})
        for rows in en["views"].values():
            self.assertIn(len(rows), (4, 5))
            for row in rows:
                if isinstance(row, str):
                    self.assertLessEqual(len(row.split()), 10, row)
                else:
                    self.assertLessEqual(len(row), 5, row)
        letters = en["views"]["letters"]
        self.assertEqual(letters[0].split()[0], "q")
        self.assertEqual(letters[3].split()[0], "(")

    def test_drawers_and_math(self):
        drawers = LAYOUT["drawers"]
        self.assertEqual(set(drawers), {"variables", "functions", "libraries", "math"})
        self.assertTrue(drawers["libraries"]["tabs"])
        self.assertEqual(drawers["functions"]["suffix"], "(")
        math = drawers["math"]["items"]
        self.assertEqual(len(math), 26)
        self.assertEqual(len({item["label"] for item in math}), 26)
        self.assertTrue(any(item["label"] == "sin" and item["insert"] == "sin(" for item in math))
        self.assertTrue(any(item["label"] == "pi" and item["insert"] == "pi" for item in math))

    def test_library_quick(self):
        quick = LAYOUT["library_quick"]
        for library in (
            "numpy", "numpy.linalg", "sympy", "matplotlib.pyplot", "pandas", "polars",
        ):
            self.assertIn(library, quick)
            self.assertTrue(quick[library])
            for item in quick[library]:
                self.assertNotIn("?", item["label"])
                self.assertNotIn("(", item["label"])
                self.assertNotIn("[", item["label"])
                self.assertFalse(item["label"].startswith("."))
                raw = item["insert"]
                if raw.startswith("?."):
                    body = raw[2:]
                elif raw.startswith("?"):
                    body = raw[1:]
                elif raw.startswith("."):
                    body = raw[1:]
                else:
                    body = raw
                self.assertTrue(body, item)
                self.assertFalse(body.startswith("."), item)
                if body.endswith("("):
                    body = body[:-1]
                elif body.endswith("["):
                    body = body[:-1]
                self.assertTrue(body, item)
        self.assertIn(
            {"label": "tolist", "insert": ".tolist("}, quick["numpy"]
        )
        self.assertIn(
            {"label": "group_by", "insert": ".group_by("}, quick["polars"]
        )
        self.assertIn(
            {"label": "loc", "insert": ".loc["}, quick["pandas"]
        )

    def test_layout_is_json_serializable(self):
        encoded = json.dumps(LAYOUT, ensure_ascii=False)
        self.assertIn('"keyboard.tab.calc"', encoded)

    def test_all_translation_keys_exist(self):
        keys = set(walk_keys(LAYOUT))
        for language, table in MESSAGES.items():
            missing = sorted(key for key in keys if key not in table)
            self.assertFalse(missing, f"{language} missing {missing}")


if __name__ == "__main__":
    unittest.main()
