"""Python glue executed once inside Pyodide.

Everything here lives in a private module namespace and is exposed through
``_pycalc_*`` functions on ``__main__``.  Application-level identifiers and
messages are English; translated UI strings live in i18n.py and app.js.
"""

import ast
import builtins
import codeop
import inspect
import io
import json
import os
import reprlib
import sys
import traceback
import types
import warnings

import __main__

_PYCALC_PROTECTED = {
    "__name__",
    "__doc__",
    "__package__",
    "__loader__",
    "__spec__",
    "__builtins__",
    "_pyodide_core",
}

_PYCALC_SKIP_NAMES = {
    "In", "Out", "get_ipython", "exit", "quit", "open",
    "_", "__", "___", "_i", "_ii", "_iii", "_ih", "_oh", "_dh", "_sh",
}

_PYCALC_MAX_SNAPSHOT = 32 * 1024 * 1024
_PYCALC_MAX_RESULT = 20000
_PYCALC_MAX_IMAGES = 20
_PYCALC_MAX_ROWS = 300

_PYCALC_MATH_NAMES = (
    "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
    "sinh", "cosh", "tanh", "sqrt", "exp", "log", "log10", "log2",
    "pow", "factorial", "floor", "ceil", "trunc", "fabs", "degrees",
    "radians", "hypot", "gcd", "lcm", "pi", "e", "tau", "inf", "nan",
)

_PYCALC_ALLOWED_LIBRARIES = {"numpy", "pyplot", "sympy"}

_pycalc_engine = None
_pycalc_auto = {}
_pycalc_last_failed = []
_pycalc_last_size = 0

_REPR = reprlib.Repr()
_REPR.maxstring = 90
_REPR.maxlist = 5
_REPR.maxdict = 5
_REPR.maxother = 90
_REPR.maxlevel = 2


def _pycalc_user_globals():
    return __main__.__dict__


def _pycalc_is_module(value):
    return isinstance(value, types.ModuleType)


def _pycalc_is_figure(value):
    cls = type(value)
    return cls.__name__ == "Figure" and str(cls.__module__).startswith("matplotlib")


def _pycalc_is_file(value):
    return isinstance(value, io.IOBase)


def _pycalc_is_auto(name, value):
    return _pycalc_auto.get(name) is value


def _pycalc_snapshotable(name, value):
    if name in _PYCALC_PROTECTED or name in _PYCALC_SKIP_NAMES:
        return False
    if name.startswith("_pycalc_") or name.startswith("__"):
        return False
    if _pycalc_is_auto(name, value):
        return False
    if _pycalc_is_module(value) or _pycalc_is_figure(value) or _pycalc_is_file(value):
        return False
    return True


def _pycalc_filtered_globals():
    result = {}
    for name, value in list(_pycalc_user_globals().items()):
        if _pycalc_snapshotable(name, value):
            result[name] = value
    return result


def _pycalc_json_safe(value, depth=0):
    if depth > 30:
        raise TypeError("nesting is too deep")
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_pycalc_json_safe(item, depth + 1) for item in value]
    if isinstance(value, dict):
        return {str(key): _pycalc_json_safe(item, depth + 1) for key, item in value.items()}
    raise TypeError(f"cannot JSON-serialize {type(value).__name__}")


def _pycalc_detect_engine():
    global _pycalc_engine
    if _pycalc_engine:
        return _pycalc_engine
    try:
        import cloudpickle

        def _probe(x):
            return x + 1

        if cloudpickle.loads(cloudpickle.dumps(_probe))(41) != 42:
            raise RuntimeError("cloudpickle self-test failed")
        _pycalc_engine = "cloudpickle"
    except Exception:
        _pycalc_engine = "json"
    return _pycalc_engine


def _pycalc_self_test():
    engine = _pycalc_detect_engine()
    info = {
        "engine": engine,
        "python": sys.version.split()[0],
        "numpy": False,
    }
    try:
        import numpy as np

        array = np.arange(6).reshape(2, 3)
        if engine == "cloudpickle":
            import cloudpickle

            blob = cloudpickle.dumps({"array": array, "fn": lambda x: x * 2})
            restored = cloudpickle.loads(blob)
            info["numpy"] = bool(
                restored["array"].shape == (2, 3) and restored["fn"](21) == 42
            )
        else:
            info["numpy"] = bool(int(array.sum()) == 15)
    except Exception as exc:
        info["numpy_error"] = f"{type(exc).__name__}: {exc}"
    try:
        import matplotlib

        info["matplotlib"] = str(matplotlib.__version__)
    except Exception:
        pass
    return json.dumps(info, ensure_ascii=False)


def _pycalc_bind(name, value, conflicts):
    """Bind an auto-import name unless the user already owns that name."""

    globals_dict = _pycalc_user_globals()
    existing = globals_dict.get(name, _PYCALC_MISSING)
    if existing is not _PYCALC_MISSING and not _pycalc_is_auto(name, existing):
        if existing is not value:
            conflicts.append(name)
            return
    globals_dict[name] = value
    _pycalc_auto[name] = value


_PYCALC_MISSING = object()


def _pycalc_apply_math(conflicts):
    import math

    _pycalc_bind("math", math, conflicts)
    for name in _PYCALC_MATH_NAMES:
        _pycalc_bind(name, getattr(math, name), conflicts)


def _pycalc_apply_numpy(conflicts):
    import numpy

    _pycalc_bind("np", numpy, conflicts)


def _pycalc_apply_pyplot(conflicts):
    import matplotlib

    matplotlib.use("Agg", force=False)
    import matplotlib.pyplot as plt

    _pycalc_bind("plt", plt, conflicts)


def _pycalc_apply_sympy(conflicts):
    import sympy

    _pycalc_bind("sp", sympy, conflicts)


def _pycalc_set_libraries(ids_json):
    """Apply Math plus the selected extension libraries.

    Returns JSON with ``conflicts`` (names already owned by the user) so the
    UI can warn instead of silently overwriting user variables.
    """

    try:
        selected = json.loads(ids_json)
    except Exception:
        selected = []
    if not isinstance(selected, list):
        selected = []
    selected = [str(item) for item in selected if str(item) in _PYCALC_ALLOWED_LIBRARIES]

    globals_dict = _pycalc_user_globals()
    desired = set(_PYCALC_MATH_NAMES) | {"math"}
    if "numpy" in selected:
        desired.add("np")
    if "pyplot" in selected:
        desired.add("plt")
    if "sympy" in selected:
        desired.add("sp")

    # Drop aliases that are no longer selected, but never touch user values.
    for name in list(_pycalc_auto):
        if name in desired:
            continue
        value = _pycalc_auto.get(name)
        if globals_dict.get(name, _PYCALC_MISSING) is value:
            del globals_dict[name]
        _pycalc_auto.pop(name, None)

    conflicts: list[str] = []
    _pycalc_apply_math(conflicts)
    if "numpy" in selected:
        _pycalc_apply_numpy(conflicts)
    if "pyplot" in selected:
        _pycalc_apply_pyplot(conflicts)
    if "sympy" in selected:
        _pycalc_apply_sympy(conflicts)

    return json.dumps(
        {"applied": selected, "conflicts": conflicts}, ensure_ascii=False
    )


def _pycalc_is_complete(code):
    """Return whether pressing Enter should execute *code*."""

    if not code or not code.strip():
        return json.dumps({"complete": False})
    meaningful = [
        line for line in code.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if not meaningful:
        return json.dumps({"complete": False})
    try:
        compiled = codeop.compile_command(code, "<cell>", "exec")
    except (SyntaxError, OverflowError, ValueError):
        return json.dumps({"complete": False})
    return json.dumps({"complete": compiled is not None})


def _pycalc_set_plot_theme(theme):
    try:
        import matplotlib

        if str(theme) == "dark":
            matplotlib.style.use("dark_background")
        else:
            matplotlib.style.use("default")
        return json.dumps({"ok": True})
    except Exception as exc:
        return json.dumps(
            {"ok": False, "error": f"{type(exc).__name__}: {exc}"},
            ensure_ascii=False,
        )


def _pycalc_snapshot_to_file(path):
    global _pycalc_last_failed, _pycalc_last_size
    engine = _pycalc_detect_engine()
    data = _pycalc_filtered_globals()
    failed = []

    if engine == "cloudpickle":
        import cloudpickle

        try:
            payload = cloudpickle.dumps(data, protocol=4)
        except Exception:
            items = {}
            for name, value in data.items():
                try:
                    items[name] = cloudpickle.dumps(value, protocol=4)
                except Exception as exc:
                    failed.append({"name": name, "error": f"{type(exc).__name__}: {exc}"})
            payload = cloudpickle.dumps(
                {"__pycalc_format__": "per-object", "items": items}, protocol=4
            )
    else:
        try:
            safe = {name: _pycalc_json_safe(value) for name, value in data.items()}
            payload = json.dumps(
                {"__pycalc_format__": "json", "items": safe}, ensure_ascii=False
            ).encode("utf-8")
        except Exception as exc:
            failed.append({"name": "<namespace>", "error": f"{type(exc).__name__}: {exc}"})
            payload = json.dumps(
                {"__pycalc_format__": "json", "items": {}}, ensure_ascii=False
            ).encode("utf-8")

    size = len(payload)
    _pycalc_last_failed = failed
    _pycalc_last_size = size
    if size > _PYCALC_MAX_SNAPSHOT:
        return json.dumps(
            {
                "ok": False,
                "engine": engine,
                "size": size,
                "failed": failed,
                "reason": "too-large",
            },
            ensure_ascii=False,
        )
    try:
        with open(path, "wb") as fh:
            fh.write(payload)
    except Exception as exc:
        return json.dumps(
            {
                "ok": False,
                "engine": engine,
                "size": size,
                "failed": failed,
                "reason": f"write-failed: {type(exc).__name__}: {exc}",
            },
            ensure_ascii=False,
        )
    return json.dumps(
        {"ok": True, "engine": engine, "size": size, "failed": failed},
        ensure_ascii=False,
    )


def _pycalc_restore_from_file(path):
    engine = _pycalc_detect_engine()
    try:
        with open(path, "rb") as fh:
            payload = fh.read()
    except Exception as exc:
        return json.dumps(
            {"ok": False, "error": f"read failed: {type(exc).__name__}: {exc}", "failed": []},
            ensure_ascii=False,
        )

    if engine == "cloudpickle":
        import cloudpickle

        try:
            obj = cloudpickle.loads(payload)
        except Exception as exc:
            return json.dumps(
                {
                    "ok": False,
                    "error": f"deserialization failed: {type(exc).__name__}: {exc}",
                    "failed": [],
                },
                ensure_ascii=False,
            )
        if isinstance(obj, dict) and obj.get("__pycalc_format__") == "per-object":
            failed = []
            restored = 0
            for name, blob in obj.get("items", {}).items():
                try:
                    _pycalc_user_globals()[name] = cloudpickle.loads(blob)
                    restored += 1
                except Exception as exc:
                    failed.append({"name": name, "error": f"{type(exc).__name__}: {exc}"})
            return json.dumps(
                {"ok": True, "restored": restored, "failed": failed}, ensure_ascii=False
            )
        if isinstance(obj, dict):
            _pycalc_user_globals().update(obj)
            return json.dumps(
                {"ok": True, "restored": len(obj), "failed": []}, ensure_ascii=False
            )
        return json.dumps(
            {"ok": False, "error": "snapshot is not a dict", "failed": []},
            ensure_ascii=False,
        )

    try:
        obj = json.loads(payload.decode("utf-8"))
        items = obj.get("items", {}) if isinstance(obj, dict) else {}
        _pycalc_user_globals().update(items)
        return json.dumps(
            {"ok": True, "restored": len(items), "failed": []}, ensure_ascii=False
        )
    except Exception as exc:
        return json.dumps(
            {"ok": False, "error": f"JSON restore failed: {exc}", "failed": []},
            ensure_ascii=False,
        )


def _pycalc_reset():
    try:
        import matplotlib.pyplot as plt

        plt.close("all")
    except Exception:
        pass
    globals_dict = _pycalc_user_globals()
    for name in list(globals_dict):
        if name in _PYCALC_PROTECTED or name.startswith("__"):
            continue
        if name.startswith("_pycalc_"):
            continue
        del globals_dict[name]
    _pycalc_auto.clear()


def _pycalc_replay_imports(codes_json):
    try:
        codes = json.loads(codes_json)
    except Exception:
        codes = []
    failed = []
    for code in codes:
        try:
            tree = ast.parse(code, "<import-replay>", "exec")
        except Exception:
            continue
        for node in tree.body:
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            if isinstance(node, ast.ImportFrom) and node.module == "__future__":
                continue
            try:
                module = ast.Module(body=[node], type_ignores=[])
                exec(compile(module, "<import-replay>", "exec"), _pycalc_user_globals())
            except Exception as exc:
                try:
                    label = ast.unparse(node)
                except Exception:
                    label = "<import>"
                failed.append(f"{label}: {type(exc).__name__}: {exc}")
    return json.dumps({"failed": failed}, ensure_ascii=False)


def _pycalc_type_name(value):
    cls = type(value)
    # Compact table: int, ndarray, Symbol, ...
    return str(cls.__qualname__)


def _pycalc_safe_repr(value):
    try:
        text = _REPR.repr(value)
    except Exception:
        return "<unrepresentable>"
    text = text.replace("\n", " ").replace("\r", " ")
    if len(text) > 120:
        text = text[:117] + "..."
    return text


def _pycalc_list_vars():
    rows = []
    for name, value in list(_pycalc_user_globals().items()):
        if not _pycalc_snapshotable(name, value):
            continue
        if isinstance(value, (types.FunctionType, types.BuiltinFunctionType, types.MethodType)):
            continue
        if inspect.isroutine(value):
            continue
        rows.append(
            {
                "name": name,
                "type": _pycalc_type_name(value),
                "value": _pycalc_safe_repr(value),
            }
        )
    rows.sort(key=lambda row: row["name"].lower())
    return json.dumps(rows[:_PYCALC_MAX_ROWS], ensure_ascii=False)


def _pycalc_list_funcs():
    rows = []
    for name, value in list(_pycalc_user_globals().items()):
        if name in _PYCALC_PROTECTED or name in _PYCALC_SKIP_NAMES:
            continue
        if name.startswith("_pycalc_") or name.startswith("__"):
            continue
        if _pycalc_is_auto(name, value):
            continue
        if not isinstance(value, types.FunctionType):
            continue
        module = getattr(value, "__module__", None)
        if module not in ("__main__", None):
            continue
        try:
            params = str(inspect.signature(value))
        except Exception:
            params = "(?)"
        rows.append({"name": name, "params": params})
    rows.sort(key=lambda row: row["name"].lower())
    return json.dumps(rows[:_PYCALC_MAX_ROWS], ensure_ascii=False)


def _pycalc_completion_items():
    rows = []
    for name, value in list(_pycalc_user_globals().items()):
        if name in _PYCALC_PROTECTED or name in _PYCALC_SKIP_NAMES:
            continue
        if name.startswith("__") or name.startswith("_pycalc_"):
            continue
        if isinstance(value, types.ModuleType):
            kind = "namespace"
            detail = "module"
        elif isinstance(value, (types.FunctionType, types.BuiltinFunctionType, types.MethodType)):
            kind = "function"
            try:
                detail = str(inspect.signature(value))
            except Exception:
                detail = "(...)"
        elif isinstance(value, type):
            kind = "class"
            detail = _pycalc_type_name(value)
        else:
            kind = "variable"
            detail = _pycalc_type_name(value)
        rows.append({"label": name, "type": kind, "detail": detail})
    rows.sort(key=lambda row: row["label"].lower())
    return json.dumps(rows[:500], ensure_ascii=False)


_STATIC_CONSTRUCTORS = {}
for _pycalc_name in (
    "array", "asarray", "asanyarray", "zeros", "ones", "empty", "full",
    "arange", "linspace", "logspace", "geomspace", "identity", "eye", "diag",
    "fromiter", "frombuffer", "copy", "concatenate", "stack", "hstack",
    "vstack", "dstack", "column_stack", "block",
):
    _STATIC_CONSTRUCTORS[f"numpy.{_pycalc_name}"] = ("numpy", "ndarray")
for _pycalc_name in (
    "rand", "randn", "random", "uniform", "normal", "standard_normal",
    "randint", "choice",
):
    _STATIC_CONSTRUCTORS[f"numpy.random.{_pycalc_name}"] = ("numpy", "ndarray")
_STATIC_CONSTRUCTORS["sympy.symbols"] = ("sympy", "Symbol")
_STATIC_CONSTRUCTORS["sympy.Symbol"] = ("sympy", "Symbol")
_STATIC_CONSTRUCTORS["matplotlib.pyplot.figure"] = ("matplotlib.figure", "Figure")


def _pycalc_dotted_name(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def _pycalc_static_expr_type(node, user_globals):
    if isinstance(node, ast.List):
        return list
    if isinstance(node, ast.Tuple):
        return tuple
    if isinstance(node, ast.Dict):
        return dict
    if isinstance(node, ast.Set):
        return set
    if isinstance(node, ast.Constant):
        return type(node.value)
    if isinstance(node, ast.JoinedStr):
        return str
    if isinstance(node, ast.Call):
        path = _pycalc_dotted_name(node.func)
        if not path:
            return None
        parts = path.split(".")
        root = user_globals.get(parts[0])
        if isinstance(root, types.ModuleType):
            parts[0] = root.__name__
        target = _STATIC_CONSTRUCTORS.get(".".join(parts))
        if not target:
            return None
        module_name, class_name = target
        module = sys.modules.get(module_name)
        if module is None:
            try:
                module = __import__(module_name, fromlist=[class_name])
            except Exception:
                return None
        try:
            return getattr(module, class_name)
        except Exception:
            return None
    if isinstance(node, (ast.Name, ast.Attribute, ast.Subscript)):
        try:
            return type(eval(compile(ast.Expression(node), "<completion>", "eval"), user_globals, user_globals))
        except Exception:
            return None
    return None


def _pycalc_static_assignment_type(name, code):
    prefix = str(code or "").rsplit("\n", 1)[0]
    if not prefix.strip():
        return None
    try:
        tree = ast.parse(prefix)
    except Exception:
        return None
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            if any(isinstance(target, ast.Name) and target.id == name for target in node.targets):
                found.append((getattr(node, "lineno", 0), node))
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and node.target.id == name:
                found.append((getattr(node, "lineno", 0), node))
    if not found:
        return None
    node = sorted(found, key=lambda item: item[0])[-1][1]
    if isinstance(node, ast.AnnAssign):
        try:
            annotation = eval(
                compile(ast.Expression(node.annotation), "<completion>", "eval"),
                _pycalc_user_globals(),
                _pycalc_user_globals(),
            )
        except Exception:
            return None
        return annotation if isinstance(annotation, type) else None
    return _pycalc_static_expr_type(node.value, _pycalc_user_globals())


def _pycalc_type_label(value):
    if isinstance(value, types.ModuleType):
        return f"module {value.__name__}"
    cls = value if isinstance(value, type) else type(value)
    module = str(getattr(cls, "__module__", ""))
    name = str(getattr(cls, "__qualname__", cls.__name__))
    return name if module in ("builtins", "__main__") else f"{module.split('.')[0]}.{name}"


def _pycalc_attribute_items(expr, code=""):
    parts = str(expr).split(".")
    if not parts or any(not part.isidentifier() for part in parts):
        return json.dumps({"expr": str(expr), "type": None, "items": []})
    user_globals = _pycalc_user_globals()
    source = "live"
    found_live = True
    try:
        obj = eval(str(expr), user_globals, user_globals)
    except Exception:
        found_live = False
        obj = None
    if not found_live:
        if len(parts) == 1:
            obj = _pycalc_static_assignment_type(str(expr), code)
            source = "static" if obj is not None else "live"
        if obj is None:
            return json.dumps({"expr": str(expr), "type": None, "items": []})

    type_label = _pycalc_type_label(obj)
    parent_is_module = isinstance(obj, types.ModuleType)
    rows = []
    for name in dir(obj):
        if name.startswith("_pycalc_"):
            continue
        try:
            value = getattr(obj, name)
        except Exception:
            continue
        if isinstance(value, types.ModuleType):
            kind = "namespace"
            detail = "module"
        elif isinstance(value, type):
            kind = "class"
            detail = f"class {value.__name__}"
        elif isinstance(value, property):
            kind = "property"
            detail = "property"
        elif inspect.isroutine(value):
            kind = "function" if parent_is_module else "method"
            try:
                signature = inspect.signature(value)
                if source == "static" and isinstance(obj, type):
                    params = list(signature.parameters.values())
                    if params and params[0].name in ("self", "cls"):
                        signature = signature.replace(parameters=params[1:])
                detail = str(signature)
            except Exception:
                detail = "(...)"
        else:
            kind = "variable"
            try:
                detail = _pycalc_type_name(value)
            except Exception:
                detail = "object"
        rows.append({"label": name, "type": kind, "detail": detail})

    # Public members first; dunders are still available when the user types "_".
    rows.sort(key=lambda row: (row["label"].startswith("_"), row["label"].lower()))
    return json.dumps(
        {"expr": str(expr), "type": type_label, "source": source, "items": rows[:1200]},
        ensure_ascii=False,
    )


def _pycalc_truncate(text):
    if text is None:
        return None
    if len(text) <= _PYCALC_MAX_RESULT:
        return text
    omitted = len(text) - _PYCALC_MAX_RESULT
    return text[:_PYCALC_MAX_RESULT] + f"\n... ({omitted} characters omitted)"


def _pycalc_sympy_math(value):
    try:
        if not str(type(value).__module__).startswith("sympy"):
            return None, None
        import sympy
        from sympy.printing.mathml import mathml as mathml_printer

        markup = mathml_printer(value, printer="presentation")
        if not str(markup).lstrip().startswith("<math"):
            markup = (
                '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">'
                + str(markup)
                + "</math>"
            )
        latex = sympy.latex(value)
        if len(markup) > 400_000:
            markup = None
        if latex is not None:
            latex = str(latex)[:20000]
        return markup, latex
    except Exception:
        return None, None


def _pycalc_run(code):
    globals_dict = _pycalc_user_globals()
    try:
        tree = ast.parse(code, "<cell>", "exec")
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            body = ast.Module(body=tree.body[:-1], type_ignores=[])
            if body.body:
                exec(compile(body, "<cell>", "exec"), globals_dict)
            expression = ast.Expression(body=tree.body[-1].value)
            value = eval(compile(expression, "<cell>", "eval"), globals_dict)
            if value is None:
                result = None
                result_mathml = None
                result_latex = None
            else:
                globals_dict["_"] = value
                result = _pycalc_truncate(repr(value))
                result_mathml, result_latex = _pycalc_sympy_math(value)
        else:
            exec(compile(tree, "<cell>", "exec"), globals_dict)
            result = None
            result_mathml = None
            result_latex = None
        return json.dumps(
            {
                "ok": True,
                "result": result,
                "resultMathML": result_mathml,
                "resultLatex": result_latex,
            },
            ensure_ascii=False,
        )
    except BaseException:
        return json.dumps(
            {"ok": False, "error": _pycalc_truncate(traceback.format_exc())},
            ensure_ascii=False,
        )


def _pycalc_figures():
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return "[]"
    import base64

    images = []
    try:
        for number in list(plt.get_fignums())[:_PYCALC_MAX_IMAGES]:
            figure = plt.figure(number)
            buffer = io.BytesIO()
            figure.savefig(buffer, format="png", dpi=110, bbox_inches="tight")
            images.append(base64.b64encode(buffer.getvalue()).decode("ascii"))
            plt.close(figure)
        plt.close("all")
    except Exception:
        try:
            plt.close("all")
        except Exception:
            pass
    return json.dumps(images)


def _pycalc_namespace_info():
    return json.dumps(
        {
            "engine": _pycalc_detect_engine(),
            "failed": _pycalc_last_failed,
            "size": _pycalc_last_size,
        },
        ensure_ascii=False,
    )


# Set the backend before user code imports pyplot.
os.environ.setdefault("MPLBACKEND", "Agg")
try:
    warnings.filterwarnings("ignore", message=".*FigureCanvasAgg is non-interactive.*")
    warnings.filterwarnings("ignore", message=".*missing from font.*")
except Exception:
    pass
try:
    import matplotlib

    matplotlib.use("Agg", force=True)
except Exception:
    pass
