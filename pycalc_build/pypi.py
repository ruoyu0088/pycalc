"""Embed pure-Python PyPI wheels that Pyodide does not ship itself.

Pyodide's lock file only knows about packages that were built for its
Emscripten ABI.  A lot of useful libraries (Plotly, for example) are pure
Python and work unchanged in the browser once their wheel is installed.  This
module resolves those packages from PyPI, downloads their wheels and builds
synthetic entries for the embedded ``pyodide-lock.json``.

Only pure-Python wheels are accepted.  A wheel with a platform tag other than
``any`` cannot run in the Pyodide interpreter and is rejected with a clear
error instead of producing a broken HTML file at runtime.
"""

from __future__ import annotations

import email.parser
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import quote

from .cache import DownloadError, download, ensure_sha256

PYPI_JSON = "https://pypi.org/pypi/{name}/json"

# ``plotly.express`` is usable without pandas for plain Python lists, but its
# normal data-frame API needs pandas.  Plotly deliberately keeps pandas
# optional, so declare it here when the user selects Plotly.
OPTIONAL_DEPENDENCIES = {
    "plotly": ("pandas",),
}

_NAME_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")
_REQUIREMENT_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


@dataclass(frozen=True)
class ExternalPackage:
    """A pure-Python wheel that will be added to the Pyodide lock."""

    name: str
    version: str
    file_name: str
    sha256: str
    depends: tuple[str, ...]
    path: Path
    js_name: str | None = None
    js_source: str | None = None


def canonical_name(name: str) -> str:
    """Return the PEP 503 spelling used to compare lock entries."""

    return re.sub(r"[-_.]+", "-", str(name).strip()).lower()


def _lock_names(lock: dict) -> dict[str, str]:
    return {
        canonical_name(name): name
        for name in (lock.get("packages") or {})
    }


def _json_cache(cache_dir: Path, name: str) -> Path:
    return cache_dir / "pypi" / f"{canonical_name(name)}.json"


def _wheel_cache(cache_dir: Path, pyodide_version: str, file_name: str) -> Path:
    return cache_dir / "wheels" / pyodide_version / file_name


def _fetch_project(
    name: str,
    *,
    cache_dir: Path,
    offline: bool,
    refresh: bool,
    log: Callable[[str], None] | None,
    lang: str,
) -> dict:
    path = _json_cache(cache_dir, name)
    download(
        PYPI_JSON.format(name=quote(name)),
        path,
        offline=offline,
        refresh=refresh,
        log=log,
        lang=lang,
    )
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        raise DownloadError(f"Invalid PyPI metadata for {name}: {path}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("releases"), dict):
        raise DownloadError(f"Invalid PyPI metadata for {name}: {path}")
    return data


def _wheel_candidates(project: dict) -> list[dict]:
    files = project.get("urls")
    if not isinstance(files, list):
        files = []
    candidates = [
        item for item in files
        if isinstance(item, dict)
        and str(item.get("filename", "")).endswith(".whl")
        and str(item.get("packagetype", "")) == "bdist_wheel"
    ]
    pure = [
        item for item in candidates
        if str(item.get("filename", "")).endswith("-none-any.whl")
    ]
    return pure


def _select_wheel(project: dict, name: str) -> dict:
    candidates = _wheel_candidates(project)
    if not candidates:
        raise DownloadError(
            f"{name} does not publish a pure-Python wheel (looking for "
            "*‑none-any.whl). PyCalc can only embed packages that do not need "
            "a native Emscripten build."
        )
    # Prefer a Python-3-only wheel, then the universal py2.py3 wheel.
    candidates.sort(
        key=lambda item: (
            0 if "-py3-none-any.whl" in str(item.get("filename", "")) else 1,
            0 if "-py2.py3-none-any.whl" in str(item.get("filename", "")) else 1,
            str(item.get("filename", "")),
        )
    )
    chosen = candidates[0]
    if not chosen.get("url") or not chosen.get("filename"):
        raise DownloadError(f"PyPI returned an incomplete wheel record for {name}")
    return chosen


def _metadata(wheel: Path) -> tuple[tuple[str, ...], str]:
    """Read Requires-Dist entries and the Python requirement from a wheel."""

    try:
        with zipfile.ZipFile(wheel) as archive:
            names = archive.namelist()
            metadata_name = next(
                (item for item in names if item.endswith(".dist-info/METADATA")),
                None,
            )
            if metadata_name is None:
                raise DownloadError(f"{wheel.name} has no METADATA file")
            raw = archive.read(metadata_name).decode("utf-8", "replace")
    except (OSError, zipfile.BadZipFile) as exc:
        raise DownloadError(f"Cannot read wheel {wheel}: {exc}") from exc

    metadata = email.parser.Parser().parsestr(raw)
    depends: list[str] = []
    for requirement in metadata.get_all("Requires-Dist") or ():
        # Drop environment markers.  In particular, an ``extra == ...``
        # requirement is optional and must not be installed for a plain
        # ``import plotly``.
        marker = ""
        if ";" in requirement:
            requirement, marker = requirement.split(";", 1)
        if "extra" in marker:
            continue
        match = _REQUIREMENT_RE.match(requirement)
        if not match:
            continue
        dependency = match.group(1)
        if canonical_name(dependency) not in {canonical_name(item) for item in depends}:
            depends.append(dependency)
    return tuple(depends), str(metadata.get("Requires-Python") or "")


def _plotly_javascript(wheel: Path) -> tuple[str | None, str | None]:
    """Plotly ships its matching plotly.js bundle inside the Python wheel."""

    if canonical_name(wheel.name.split("-")[0]) != "plotly":
        return None, None
    try:
        with zipfile.ZipFile(wheel) as archive:
            source = archive.read("plotly/package_data/plotly.min.js").decode("utf-8")
    except (KeyError, OSError, zipfile.BadZipFile, UnicodeDecodeError):
        return None, None
    return "plotly.min.js", source


def _synthetic_lock_entry(
    package: ExternalPackage,
    lock_depends: Iterable[str],
) -> dict:
    return {
        "depends": list(dict.fromkeys(lock_depends)),
        "file_name": package.file_name,
        "imports": [package.name],
        "install_dir": "site",
        "name": package.name,
        "package_type": "package",
        "sha256": package.sha256,
        "tool": {},
        "unvendored_tests": False,
        "version": package.version,
    }


def resolve_external_packages(
    lock: dict,
    roots: Iterable[str],
    *,
    pyodide_version: str,
    cache_dir: Path,
    offline: bool = False,
    refresh: bool = False,
    log: Callable[[str], None] | None = None,
    lang: str = "en",
) -> list[ExternalPackage]:
    """Resolve and download pure-Python packages that are not in *lock*.

    The returned list is dependency-first.  The caller can merge each entry
    into a copy of ``lock`` and then use the normal closure resolver.
    """

    lock_by_canonical = _lock_names(lock)
    state: dict[str, int] = {}  # 0 = visiting, 1 = done
    ordered: list[ExternalPackage] = []
    external: dict[str, ExternalPackage] = {}

    def resolve(raw_name: str, chain: tuple[str, ...]) -> None:
        canonical = canonical_name(raw_name)
        if canonical in lock_by_canonical:
            return
        if canonical in state:
            if state[canonical] == 0:
                cycle = " -> ".join(chain + (canonical,))
                raise DownloadError(f"Circular PyPI dependency: {cycle}")
            return

        project = _fetch_project(
            canonical,
            cache_dir=cache_dir,
            offline=offline,
            refresh=refresh,
            log=log,
            lang=lang,
        )
        info = project.get("info") or {}
        version = str(info.get("version") or "")
        if not version:
            raise DownloadError(f"PyPI did not report a version for {canonical}")

        chosen = _select_wheel(project, canonical)
        file_name = str(chosen["filename"])
        digest = str((chosen.get("digests") or {}).get("sha256") or "")
        if not digest:
            raise DownloadError(f"PyPI did not provide a SHA-256 for {file_name}")

        dest = _wheel_cache(cache_dir, pyodide_version, file_name)
        download(
            str(chosen["url"]),
            dest,
            offline=offline,
            refresh=refresh,
            log=log,
            lang=lang,
        )
        ensure_sha256(dest, digest, log)
        depends, _requires_python = _metadata(dest)
        js_name, js_source = _plotly_javascript(dest)

        state[canonical] = 0
        for dependency in depends:
            resolve(dependency, chain + (canonical,))
        state[canonical] = 1

        package = ExternalPackage(
            name=canonical,
            version=version,
            file_name=file_name,
            sha256=digest,
            depends=depends,
            path=dest,
            js_name=js_name,
            js_source=js_source,
        )
        external[canonical] = package
        ordered.append(package)

    for root in roots:
        resolve(str(root), ())

    # Materialise the external dependency names.  Dependencies already in the
    # Pyodide lock keep their original spelling.
    augmented: list[ExternalPackage] = []
    for package in ordered:
        depends: list[str] = []
        for dependency in package.depends:
            canonical = canonical_name(dependency)
            if canonical in lock_by_canonical:
                depends.append(lock_by_canonical[canonical])
            elif canonical in external:
                depends.append(canonical)
            else:
                raise DownloadError(
                    f"{package.name} depends on {dependency}, which could not be resolved"
                )
        for optional in OPTIONAL_DEPENDENCIES.get(package.name, ()):
            canonical = canonical_name(optional)
            if canonical in lock_by_canonical:
                depends.append(lock_by_canonical[canonical])
            elif canonical in external:
                depends.append(canonical)
        augmented.append(
            ExternalPackage(
                name=package.name,
                version=package.version,
                file_name=package.file_name,
                sha256=package.sha256,
                depends=tuple(dict.fromkeys(depends)),
                path=package.path,
                js_name=package.js_name,
                js_source=package.js_source,
            )
        )
    return augmented


def merge_lock_entries(lock: dict, packages: Iterable[ExternalPackage]) -> dict:
    """Return a copy of *lock* containing synthetic entries for *packages*."""

    merged = json.loads(json.dumps(lock))
    packages_list = list(packages)
    for package in packages_list:
        merged.setdefault("packages", {})[package.name] = _synthetic_lock_entry(
            package, package.depends
        )
    return merged


def javascript_assets(packages: Iterable[ExternalPackage]) -> dict[str, str]:
    """Return ``asset name -> source`` for JavaScript shipped in wheels."""

    result: dict[str, str] = {}
    for package in packages:
        if package.js_name and package.js_source:
            result[package.js_name] = package.js_source
    return result
