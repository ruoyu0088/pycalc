"""Mobile keyboard layout.

This module is the single source of truth for the on-screen keyboard.  The
dictionary is embedded into the generated page as ``CFG.keyboard`` and rendered
by ``assets/keyboard.js``.  Add or reorder keys here, not in the JavaScript.
"""

LAYOUT = {
    "tabs": [
        {
            "id": "calc",
            "labelKey": "keyboard.tab.calc",
            "type": "split",
            "left": {
                "items": [
                    {
                        "labelKey": "keyboard.button.variables",
                        "action": "openDrawer",
                        "drawer": "variables",
                    },
                    {
                        "labelKey": "keyboard.button.functions",
                        "action": "openDrawer",
                        "drawer": "functions",
                    },
                    {
                        "labelKey": "keyboard.button.math",
                        "action": "openDrawer",
                        "drawer": "math",
                    },
                    {
                        "labelKey": "keyboard.button.libraries",
                        "action": "openDrawer",
                        "drawer": "libraries",
                    },
                ],
            },
            "right": {
                "columns": 5,
                "rows": [
                    [
                        {"label": "(", "insert": "("},
                        {"label": ")", "insert": ")"},
                        {"label": "←", "action": "cursorLeft"},
                        {"label": "→", "action": "cursorRight"},
                        {"label": "⌫", "action": "backspace"},
                    ],
                    [
                        {"label": "7", "insert": "7"},
                        {"label": "8", "insert": "8"},
                        {"label": "9", "insert": "9"},
                        {"label": "/", "insert": "/"},
                        {"label": "*", "insert": "*"},
                    ],
                    [
                        {"label": "4", "insert": "4"},
                        {"label": "5", "insert": "5"},
                        {"label": "6", "insert": "6"},
                        {"label": "-", "insert": "-"},
                        {"label": "+", "insert": "+"},
                    ],
                    [
                        {"label": "1", "insert": "1"},
                        {"label": "2", "insert": "2"},
                        {"label": "3", "insert": "3"},
                        {"label": ".", "insert": "."},
                        {"label": ",", "insert": ","},
                    ],
                    [
                        {"label": "0", "insert": "0", "span": 3},
                        {"label": "=", "action": "run", "style": "run", "span": 2},
                    ],
                ],
            },
        },
        {
            "id": "en",
            "labelKey": "keyboard.tab.en",
            "type": "keyboard",
            "views": {
                "letters": [
                    "q w e r t y u i o p",
                    "a s d f g h j k l",
                    [
                        {"label": "⇧", "action": "shift"},
                        "z x c v b n m",
                        {"label": "⌫", "action": "backspace"},
                        {"label": "123", "action": "view:numbers"},
                    ],
                    "( ) [ ] { } : , . =",
                    [
                        {
                            "labelKey": "keyboard.key.space",
                            "action": "space",
                            "wide": True,
                        },
                        {"label": "←", "action": "cursorLeft"},
                        {"label": "→", "action": "cursorRight"},
                        {
                            "labelKey": "keyboard.key.enter",
                            "action": "enter",
                            "wide": True,
                        },
                    ],
                ],
                "numbers": [
                    "1 2 3 4 5 6 7 8 9 0",
                    "- / * + = _ < > % |",
                    "\" ' ` ~ ^ & @ # $ !",
                    [
                        {"label": "ABC", "action": "view:letters", "wide": True},
                        {
                            "labelKey": "keyboard.key.space",
                            "action": "space",
                            "wide": True,
                        },
                        {"label": "←", "action": "cursorLeft"},
                        {"label": "→", "action": "cursorRight"},
                        {
                            "labelKey": "keyboard.key.enter",
                            "action": "enter",
                            "wide": True,
                        },
                    ],
                ],
            },
        },
    ],
    "drawers": {
        "variables": {
            "titleKey": "keyboard.button.variables",
            "source": "variables",
            "insertField": "name",
            "emptyKey": "keyboard.empty.variables",
        },
        "functions": {
            "titleKey": "keyboard.button.functions",
            "source": "functions",
            "insertField": "name",
            "suffix": "(",
            "emptyKey": "keyboard.empty.functions",
        },
        "libraries": {
            "titleKey": "keyboard.button.libraries",
            "source": "libraries",
            "insertField": "alias",
            "displayField": "alias",
            "emptyKey": "keyboard.empty.libraries",
        },
        "math": {
            "titleKey": "keyboard.button.math",
            "items": [
                {"label": "sin", "insert": "sin("},
                {"label": "cos", "insert": "cos("},
                {"label": "tan", "insert": "tan("},
                {"label": "asin", "insert": "asin("},
                {"label": "acos", "insert": "acos("},
                {"label": "atan", "insert": "atan("},
                {"label": "sqrt", "insert": "sqrt("},
                {"label": "exp", "insert": "exp("},
                {"label": "log", "insert": "log("},
                {"label": "log10", "insert": "log10("},
                {"label": "log2", "insert": "log2("},
                {"label": "abs", "insert": "abs("},
                {"label": "floor", "insert": "floor("},
                {"label": "ceil", "insert": "ceil("},
                {"label": "round", "insert": "round("},
                {"label": "factorial", "insert": "factorial("},
                {"label": "gcd", "insert": "gcd("},
                {"label": "lcm", "insert": "lcm("},
                {"label": "hypot", "insert": "hypot("},
                {"label": "degrees", "insert": "degrees("},
                {"label": "radians", "insert": "radians("},
                {"label": "pi", "insert": "pi"},
                {"label": "e", "insert": "e"},
                {"label": "tau", "insert": "tau"},
                {"label": "inf", "insert": "inf"},
                {"label": "nan", "insert": "nan"},
            ],
        },
    },
}
