"""Library specification parsing and defaults for PyCalc.

The GUI library editor is line based.  A line without ``=`` or ``:`` is a
package list (commas and whitespace both work).  A line with ``=`` or ``:``
maps a short alias to the module that should be imported:

    numpy, matplotlib, sympy, pandas

    np = numpy
    plt = matplotlib.pyplot
    sp = sympy
    pd = pandas

Sections ``[packages]`` and ``[aliases]`` are also accepted for readability.
"""

from __future__ import annotations

import keyword
import re
from typing import Iterable, Mapping

DEFAULT_LIBRARY_SPEC = """\
# Packages embedded into the HTML (comma or whitespace separated).
# Example: numpy, matplotlib, sympy, pandas
numpy, matplotlib, sympy

# alias = import module (a colon also works)
np = numpy
plt = matplotlib.pyplot
sp = sympy
"""

# Known package -> (alias, module) defaults used by the CLI and old settings.
DEFAULT_LIBRARY_ALIASES: dict[str, tuple[str, str]] = {
    "numpy": ("np", "numpy"),
    "matplotlib": ("plt", "matplotlib.pyplot"),
    "sympy": ("sp", "sympy"),
    "pandas": ("pd", "pandas"),
}

_PACKAGE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
_ALIAS_RE = re.compile(r"^[A-Za-z_]\w*$")
_MODULE_RE = re.compile(r"^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$")
_SECTION_RE = re.compile(r"^\[([A-Za-z_-]+)\]$")


class LibrarySpecError(ValueError):
    """Invalid text in the library editor."""


def _split_package_line(line: str) -> list[str]:
    return [part for part in re.split(r"[,\s]+", line.strip()) if part]


def parse_library_spec(text: str) -> tuple[list[str], dict[str, str]]:
    """Parse the GUI library text into (packages, alias-to-module map)."""

    packages: list[str] = []
    aliases: dict[str, str] = {}
    module_owners: dict[str, str] = {}
    section: str | None = None

    for number, raw in enumerate(str(text or "").splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith(";"):
            continue
        section_match = _SECTION_RE.match(line)
        if section_match:
            name = section_match.group(1).lower()
            if name in ("package", "packages", "libraries"):
                section = "packages"
            elif name in ("alias", "aliases"):
                section = "aliases"
            else:
                raise LibrarySpecError(f"line {number}: unknown section [{name}]")
            continue

        # Allow trailing comments (package and module names cannot contain #).
        line = line.split("#", 1)[0].strip()
        if not line:
            continue

        equals = line.find("=")
        colon = line.find(":")
        separator = min(index for index in (equals, colon) if index >= 0) if (equals >= 0 or colon >= 0) else -1
        if separator >= 0:
            left = line[:separator].strip()
            right = line[separator + 1 :].strip()
            if not left or not right:
                raise LibrarySpecError(
                    f"line {number}: expected 'alias = module' (or 'alias: module')"
                )
            if not _ALIAS_RE.fullmatch(left) or keyword.iskeyword(left):
                raise LibrarySpecError(f"line {number}: invalid alias {left!r}")
            if not _MODULE_RE.fullmatch(right):
                raise LibrarySpecError(f"line {number}: invalid module {right!r}")
            if left in aliases:
                raise LibrarySpecError(f"line {number}: alias {left!r} is defined twice")
            owner = module_owners.get(right)
            if owner is not None:
                raise LibrarySpecError(
                    f"line {number}: module {right!r} is already mapped to alias {owner!r}"
                )
            aliases[left] = right
            module_owners[right] = left
            continue

        if section == "aliases":
            raise LibrarySpecError(
                f"line {number}: aliases must use 'alias = module' (or 'alias: module')"
            )
        for package in _split_package_line(line):
            if not _PACKAGE_RE.fullmatch(package):
                raise LibrarySpecError(f"line {number}: invalid package name {package!r}")
            if package not in packages:
                packages.append(package)

    return packages, aliases


def parse_alias_lines(lines: Iterable[str]) -> dict[str, str]:
    """Parse one-off CLI alias assignments without requiring a package list."""

    text = "\n".join(str(line) for line in lines)
    _packages, aliases = parse_library_spec(text)
    return aliases


def default_aliases(packages: Iterable[str]) -> dict[str, str]:
    """Return the conventional aliases for known packages."""

    result: dict[str, str] = {}
    for package in packages:
        known = DEFAULT_LIBRARY_ALIASES.get(str(package))
        if known is not None:
            result[known[0]] = known[1]
    return result


def format_library_spec(packages: Iterable[str], aliases: Mapping[str, str]) -> str:
    """Produce a readable editor/config representation."""

    package_list = list(dict.fromkeys(str(item) for item in packages if str(item)))
    lines = [
        "# Packages embedded into the HTML (comma or whitespace separated).",
        "# Example: numpy, matplotlib, sympy, pandas",
        ", ".join(package_list) if package_list else "# (no packages)",
        "",
        "# alias = import module (a colon also works)",
    ]
    if aliases:
        for alias, module in aliases.items():
            lines.append(f"{alias} = {module}")
    else:
        lines.append("# (no aliases)")
    return "\n".join(lines).rstrip() + "\n"
