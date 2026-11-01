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
                    {
                        "labelKey": "keyboard.button.python",
                        "action": "openDrawer",
                        "drawer": "python",
                    },
                ],
            },
            "right": {
                "columns": 7,
                "rows": [
                    [
                        {"label": '"', "insert": '"'},
                        {"label": "@", "insert": "@"},
                        {"label": "(", "insert": "("},
                        {"label": ")", "insert": ")"},
                        {"label": "←", "action": "cursorLeft"},
                        {"label": "→", "action": "cursorRight"},
                        {"label": "⌫", "action": "backspace"},
                    ],
                    [
                        {"label": "%", "insert": "%"},
                        {"label": ":", "insert": ":"},
                        {"label": "7", "insert": "7"},
                        {"label": "8", "insert": "8"},
                        {"label": "9", "insert": "9"},
                        {"label": "/", "insert": "/"},
                        {"label": "*", "insert": "*"},
                    ],
                    [
                        {"label": ">", "insert": ">"},
                        {"label": "=", "insert": "="},
                        {"label": "4", "insert": "4"},
                        {"label": "5", "insert": "5"},
                        {"label": "6", "insert": "6"},
                        {"label": "-", "insert": "-"},
                        {"label": "+", "insert": "+"},
                    ],
                    [
                        {"label": "<", "insert": "<"},
                        {"label": "π", "insert": "pi"},
                        {"label": "1", "insert": "1"},
                        {"label": "2", "insert": "2"},
                        {"label": "3", "insert": "3"},
                        {"label": ".", "insert": "."},
                        {"label": ",", "insert": ","},
                    ],
                    [
                        {"label": "␣", "insert": " "},
                        {"label": "⏎", "insert": "\n"},
                        {"label": "[", "insert": "["},
                        {"label": "]", "insert": "]"},
                        {"label": "0", "insert": "0"},
                        {"label": "▶", "action": "run", "style": "run", "span": 2},
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
                    [
                        {"label": "123", "action": "view:numbers"},
                        {"label": "←", "action": "cursorLeft"},
                        {"label": "→", "action": "cursorRight"},
                        {
                            "labelKey": "keyboard.key.space",
                            "action": "space",
                        },
                        {
                            "label": "⏎",
                            "action": "enter",
                        },
                        {"label": "⌫", "action": "backspace"},
                    ],
                    "q w e r t y u i o p",
                    "a s d f g h j k l",
                    [
                        {"label": "⇧", "action": "shift"},
                        'z x c v b n m "',
                    ],
                    "( ) [ ] { } : , . =",
                ],
                "numbers": [
                    [
                        {"label": "ABC", "action": "view:letters"},
                        {"label": "←", "action": "cursorLeft"},
                        {"label": "→", "action": "cursorRight"},
                        {
                            "labelKey": "keyboard.key.space",
                            "action": "space",
                        },
                        {
                            "label": "⏎",
                            "action": "enter",
                        },
                        {"label": "⌫", "action": "backspace"},
                    ],
                    "1 2 3 4 5 6 7 8 9 0",
                    "+ - * / _ < > % ? |",
                    "\" ' ` ~ ^ & @ # $ !",
                    "( ) [ ] { } : , . =",
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
            # Manual entries appear first; user variables with the same name
            # are omitted from the automatic part.
            "items": ["x", "y", "z", "a", "b", "c", "i", "j", "k"],
        },
        "functions": {
            "titleKey": "keyboard.button.functions",
            "source": "functions",
            "insertField": "name",
            "suffix": "(",
            "emptyKey": "keyboard.empty.functions",
            # Manual entries appear first, then functions defined in the
            # current session.  Add/remove names here to customise the drawer.
            "items": [
                "print",
                "range",
                "enumerate",
                "len",
                "int",
                "float",
                "str",
                "list",
                "dict",
                "set",
                "tuple",
                "sum",
                "min",
                "max",
                "sorted",
                "zip",
                "map",
                "filter",
            ],
        },
        "libraries": {
            "titleKey": "keyboard.button.libraries",
            "source": "libraries",
            "tabs": True,
            "emptyKey": "keyboard.empty.libraryTabs",
            "emptyQuickKey": "keyboard.empty.libraryQuick",
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
        "python": {
            "titleKey": "keyboard.button.python",
            "items": [
                {"label": "False", "insert": "False"},
                {"label": "None", "insert": "None"},
                {"label": "True", "insert": "True"},
                {"label": "and", "insert": " and "},
                {"label": "as", "insert": " as "},
                {"label": "break", "insert": "break"},
                {"label": "class", "insert": "class "},
                {"label": "continue", "insert": "continue"},
                {"label": "def", "insert": "def "},
                {"label": "del", "insert": "del "},
                {"label": "elif", "insert": "elif "},
                {"label": "else", "insert": "else:"},
                {"label": "for", "insert": "for "},
                {"label": "from", "insert": "from "},
                {"label": "global", "insert": "global "},
                {"label": "if", "insert": "if "},
                {"label": "import", "insert": "import "},
                {"label": "in", "insert": " in "},
                {"label": "is", "insert": " is "},
                {"label": "lambda", "insert": "lambda "},
                {"label": "not", "insert": "not "},
                {"label": "or", "insert": " or "},
                {"label": "return", "insert": "return "},
                {"label": "while", "insert": "while "},
                {"label": "with", "insert": "with "},
                {"label": "yield", "insert": "yield "},
            ],
        },
    },
    "library_quick": {
        "numpy": [
            {"label": "np", "insert": "np"},
            {"label": "array", "insert": "?array("},
            {"label": "arange", "insert": "?arange("},
            {"label": "linspace", "insert": "?linspace("},
            {"label": "ogrid", "insert": "?ogrid["},
            {"label": "zeros", "insert": "?zeros("},
            {"label": "ones", "insert": "?ones("},
            {"label": "where", "insert": "?where("},
            {"label": "reshape", "insert": "?.reshape("},
            {"label": "sum", "insert": "?.sum("},
            {"label": "mean", "insert": "?.mean("},
            {"label": "max", "insert": "?.max("},
            {"label": "min", "insert": "?.min("},
            {"label": "std", "insert": "?.std("},
            {"label": "dot", "insert": "?.dot("},
            {"label": "copy", "insert": "?.copy("},
            {"label": "astype", "insert": ".astype("},
            {"label": "tolist", "insert": ".tolist("},
            {"label": "flatten", "insert": ".flatten("},
            {"label": "shape", "insert": ".shape"},
            {"label": "dtype", "insert": ".dtype"},
            {"label": "T", "insert": ".T"},
            {"label": "norm", "insert": "?linalg.norm("},
            {"label": "inv", "insert": "?linalg.inv("},
            {"label": "det", "insert": "?linalg.det("},
            {"label": "solve", "insert": "?linalg.solve("},
            {"label": "lstsq", "insert": "?linalg.lstsq("},
            {"label": "svd", "insert": "?linalg.svd("},
        ],
        "numpy.linalg": [
            {"label": "norm", "insert": "?norm("},
            {"label": "inv", "insert": "?inv("},
            {"label": "det", "insert": "?det("},
            {"label": "solve", "insert": "?solve("},
            {"label": "eig", "insert": "?eig("},
            {"label": "svd", "insert": "?svd("},
            {"label": "qr", "insert": "?qr("},
            {"label": "matrix_rank", "insert": "?matrix_rank("},
            {"label": "pinv", "insert": "?pinv("},
        ],
        "sympy": [
            # Module alias
            {"label": "sp",        "insert": "sp"},

            # Symbol definition
            {"label": "symbols",   "insert": "?symbols("},
            {"label": "var",       "insert": "?var("},

            # Simplification and rewriting
            {"label": "simplify",  "insert": "?.simplify("},
            {"label": "expand",    "insert": "?.expand("},
            {"label": "factor",    "insert": "?.factor("},
            {"label": "together",  "insert": "?.together("},   # combine fractions
            {"label": "cancel",    "insert": "?.cancel("},     # cancel common factors
            {"label": "trigsimp",  "insert": "?.trigsimp("},   # trig identities

            # Calculus
            {"label": "diff",      "insert": "?.diff("},
            {"label": "integrate", "insert": "?.integrate("},
            {"label": "limit",     "insert": "?limit("},
            {"label": "series",    "insert": "?.series("},     # Taylor / Laurent expansion
            {"label": "summation", "insert": "?summation("},
            {"label": "dsolve",    "insert": "?dsolve("},      # ordinary differential equations

            # Equation solving
            {"label": "solve",     "insert": "?solve("},
            {"label": "nsolve",    "insert": "?nsolve("},      # numerical root finding
            {"label": "Eq",        "insert": "?Eq("},

            # Linear algebra
            {"label": "Matrix",    "insert": "?Matrix("},

            # Evaluation and output
            {"label": "subs",      "insert": ".subs("},
            {"label": "evalf",     "insert": ".evalf("},
            {"label": "latex",     "insert": "?latex("},

            # Constants
            {"label": "pi",        "insert": "?pi"},
            {"label": "oo",        "insert": "?oo"},
        ],      
        "matplotlib.pyplot": [
            # Module alias
            {"label": "plt",          "insert": "plt"},

            # Figure and axes
            {"label": "figure",       "insert": "?figure("},
            {"label": "subplots",     "insert": "?subplots("},
            {"label": "fig",          "insert": "fig"},
            {"label": "ax",           "insert": "ax"},
            {"label": "3D",           "insert": "?subplot(projection='3d')"},

            # Basic plots
            {"label": "plot",         "insert": "?plot("},
            {"label": "scatter",      "insert": "?scatter("},
            {"label": "bar",          "insert": "?bar("},
            {"label": "hist",         "insert": "?hist("},
            {"label": "imshow",       "insert": "?imshow("},

            # Statistical and error plots
            {"label": "errorbar",     "insert": "?errorbar("},     # error bars
            {"label": "fill_between", "insert": "?fill_between("}, # confidence bands

            # Scale and 2D field plots
            {"label": "semilogx",     "insert": "?semilogx("},     # log X axis
            {"label": "semilogy",     "insert": "?semilogy("},     # log Y axis
            {"label": "loglog",       "insert": "?loglog("},       # log-log
            {"label": "contourf",     "insert": "?contourf("},     # filled contours
            {"label": "colorbar",     "insert": "?colorbar("},     # color scale

            # Axis limits, ticks, annotations
            {"label": "xlim",         "insert": "?xlim("},
            {"label": "ylim",         "insert": "?ylim("},

            # Layout and display
            {"label": "legend",       "insert": "?.legend("},
            {"label": "grid",         "insert": "?grid("},
            {"label": "twinx",        "insert": "?twinx("},        # second Y axis
        ],
        "pandas": [
            {"label": "pd", "insert": "pd"},
            {"label": "DataFrame", "insert": "?DataFrame("},
            {"label": "Series", "insert": "?Series("},
            {"label": "read_csv", "insert": "?read_csv("},
            {"label": "concat", "insert": "?concat("},
            {"label": "merge", "insert": "?.merge("},
            {"label": "to_datetime", "insert": "?to_datetime("},
            {"label": "date_range", "insert": "?date_range("},
            {"label": "isna", "insert": "?.isna("},
            {"label": "notna", "insert": "?.notna("},
            {"label": "melt", "insert": "?melt("},
            {"label": "pivot_table", "insert": "?pivot_table("},
            {"label": "get_dummies", "insert": "?get_dummies("},
            {"label": "head", "insert": ".head("},
            {"label": "tail", "insert": ".tail("},
            {"label": "info", "insert": ".info("},
            {"label": "describe", "insert": ".describe("},
            {"label": "groupby", "insert": ".groupby("},
            {"label": "sort_values", "insert": ".sort_values("},
            {"label": "dropna", "insert": ".dropna("},
            {"label": "fillna", "insert": ".fillna("},
            {"label": "to_csv", "insert": ".to_csv("},
            {"label": "plot", "insert": ".plot("},
            {"label": "loc", "insert": ".loc["},
            {"label": "iloc", "insert": ".iloc["},
            {"label": "sum", "insert": ".sum("},
            {"label": "mean", "insert": ".mean("},
        ],
        "polars": [
            # Module alias
            {"label": "pl",           "insert": "pl"},

            # Constructors
            {"label": "DataFrame",    "insert": "?DataFrame("},

            # Eager I/O
            {"label": "read_csv",     "insert": "?read_csv("},

            # Expression helpers
            {"label": "col",          "insert": "?col("},
            {"label": "lit",          "insert": "?lit("},
            {"label": "when",         "insert": "?when("},
            {"label": "len",          "insert": "?len("},

            # Frame operations
            {"label": "concat",       "insert": "?concat("},
            {"label": "select",       "insert": ".select("},
            {"label": "filter",       "insert": ".filter("},
            {"label": "with_columns", "insert": ".with_columns("},
            {"label": "group_by",     "insert": ".group_by("},
            {"label": "agg",          "insert": ".agg("},
            {"label": "sort",         "insert": ".sort("},

            # Row inspection
            {"label": "head",         "insert": ".head("},
            {"label": "tail",         "insert": ".tail("},
            {"label": "describe",     "insert": ".describe("},
            {"label": "value_counts", "insert": ".value_counts("},
            {"label": "n_unique",     "insert": ".n_unique("},
            {"label": "unique",       "insert": ".unique("},

            # Data cleaning
            {"label": "drop_nulls",   "insert": ".drop_nulls("},
            {"label": "fill_null",    "insert": ".fill_null("},

            # Joins and reshaping
            {"label": "join",         "insert": ".join("},
            {"label": "explode",      "insert": ".explode("},
            {"label": "rename",       "insert": ".rename("},
            {"label": "cast",         "insert": ".cast("},

            # Window / transforms
            {"label": "over",         "insert": ".over("},          # window function
            {"label": "shift",        "insert": ".shift("},
            {"label": "diff",         "insert": ".diff("},
            {"label": "cum_sum",      "insert": ".cum_sum("},
        ],
    },
}
