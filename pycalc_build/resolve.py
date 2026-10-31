"""Dependency resolution against pyodide-lock.json."""

from __future__ import annotations

import difflib
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class Package:
    name: str
    version: str
    file_name: str
    sha256: str
    depends: tuple[str, ...]
    package_type: str
    info: dict

    @classmethod
    def from_lock(cls, name: str, data: dict) -> "Package":
        return cls(
            name=name,
            version=str(data.get("version", "")),
            file_name=str(data.get("file_name", "")),
            sha256=str(data.get("sha256", "")),
            depends=tuple(data.get("depends") or ()),
            package_type=str(data.get("package_type", "package")),
            info=data,
        )


def package_names(lock: dict) -> list[str]:
    return sorted(lock.get("packages", {}))


def selectable_packages(lock: dict) -> dict[str, Package]:
    """Packages a user may reasonably ask for."""
    result: dict[str, Package] = {}
    for name, data in lock.get("packages", {}).items():
        if data.get("package_type", "package") == "package":
            result[name] = Package.from_lock(name, data)
    return result


def suggest_name(name: str, candidates: Iterable[str]) -> str:
    matches = difflib.get_close_matches(name, list(candidates), n=5, cutoff=0.55)
    return "、".join(matches)


def resolve_closure(lock: dict, roots: Iterable[str]) -> list[Package]:
    """Return the transitive dependency closure, dependencies first.

    Raises ValueError with a helpful message for unknown package names.
    """

    packages = lock.get("packages", {})
    ordered: list[Package] = []
    state: dict[str, int] = {}  # 0 = visiting, 1 = done

    def visit(name: str, chain: tuple[str, ...]) -> None:
        if name in state:
            if state[name] == 0:
                cycle = " -> ".join(chain + (name,))
                raise ValueError(f"pyodide-lock.json 中存在循环依赖：{cycle}")
            return
        data = packages.get(name)
        if data is None:
            hint = suggest_name(name, packages)
            extra = f"；你是不是想找：{hint}" if hint else ""
            raise ValueError(f"Pyodide lock 中没有库 {name!r}{extra}")
        state[name] = 0
        pkg = Package.from_lock(name, data)
        for dep in pkg.depends:
            visit(dep, chain + (name,))
        state[name] = 1
        ordered.append(pkg)

    for root in roots:
        visit(root, ())

    # de-duplicate while preserving order (roots may overlap)
    seen: set[str] = set()
    result: list[Package] = []
    for pkg in ordered:
        if pkg.name in seen:
            continue
        seen.add(pkg.name)
        result.append(pkg)
    return result


def package_version_map(packages: Iterable[Package]) -> dict[str, str]:
    return {pkg.name: pkg.version for pkg in packages}
