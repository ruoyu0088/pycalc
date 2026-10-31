"""Python glue executed once inside Pyodide.

Everything here lives in __main__ and is deliberately prefixed with
``_pycalc_`` so the snapshot filter and the namespace reset can ignore it.
"""

import ast
import builtins
import io
import json
import os
import sys
import traceback
import types

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

_pycalc_engine = None
_pycalc_last_failed = []
_pycalc_last_size = 0


def _pycalc_user_globals():
    return __main__.__dict__


def _pycalc_is_module(value):
    return isinstance(value, types.ModuleType)


def _pycalc_is_figure(value):
    cls = type(value)
    return cls.__name__ == "Figure" and str(cls.__module__).startswith("matplotlib")


def _pycalc_is_file(value):
    return isinstance(value, io.IOBase)


def _pycalc_snapshotable(name, value):
    if name in _PYCALC_PROTECTED or name in _PYCALC_SKIP_NAMES:
        return False
    if name.startswith("_pycalc_") or name.startswith("__"):
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
        raise TypeError("嵌套过深")
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_pycalc_json_safe(item, depth + 1) for item in value]
    if isinstance(value, dict):
        return {str(key): _pycalc_json_safe(item, depth + 1) for key, item in value.items()}
    raise TypeError(f"无法 JSON 序列化：{type(value).__name__}")


def _pycalc_detect_engine():
    global _pycalc_engine
    if _pycalc_engine:
        return _pycalc_engine
    try:
        import cloudpickle

        def _probe(x):
            return x + 1

        if cloudpickle.loads(cloudpickle.dumps(_probe))(41) != 42:
            raise RuntimeError("cloudpickle 自检失败")
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

            blob = cloudpickle.dumps(
                {"array": array, "fn": lambda x: x * 2}
            )
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


def _pycalc_snapshot_to_file(path):
    """Serialize the user namespace to *path*; return info as JSON."""

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
    """Restore a snapshot from *path* into __main__; return JSON."""

    global _pycalc_engine
    engine = _pycalc_detect_engine()
    try:
        with open(path, "rb") as fh:
            payload = fh.read()
    except Exception as exc:
        return json.dumps(
            {"ok": False, "error": f"读取快照失败：{type(exc).__name__}: {exc}", "failed": []},
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
                    "error": f"反序列化失败：{type(exc).__name__}: {exc}",
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
            {"ok": False, "error": "快照格式不是字典", "failed": []}, ensure_ascii=False
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
            {"ok": False, "error": f"JSON 快照恢复失败：{exc}", "failed": []},
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


def _pycalc_truncate(text):
    if text is None:
        return None
    if len(text) <= _PYCALC_MAX_RESULT:
        return text
    omitted = len(text) - _PYCALC_MAX_RESULT
    return text[:_PYCALC_MAX_RESULT] + f"\n…（已截断 {omitted} 个字符）"


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
                # Like Jupyter/IPython: a trailing expression evaluating to
                # None does not produce an Out[] cell.
                result = None
            else:
                globals_dict["_"] = value
                result = _pycalc_truncate(repr(value))
        else:
            exec(compile(tree, "<cell>", "exec"), globals_dict)
            result = None
        return json.dumps({"ok": True, "result": result}, ensure_ascii=False)
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


# Set the backend before any user code imports pyplot.
os.environ.setdefault("MPLBACKEND", "Agg")
try:
    import warnings

    # We capture figures ourselves; Agg's plt.show() warning is just noise.
    warnings.filterwarnings("ignore", message=".*FigureCanvasAgg is non-interactive.*")
except Exception:
    pass
try:
    import matplotlib

    matplotlib.use("Agg", force=True)
except Exception:
    pass
