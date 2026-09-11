"""Service layer.

Re-exports from the submodules are resolved on first attribute access rather
than at import time (PEP 562). The star-imports this replaces ran eagerly and
pulled PySide6 in through ``.settings``, which made every module in this
package -- including the pure-computation ``.sei`` and ``.scan`` -- fail to
import anywhere Qt is not installed. Nothing in the repository relied on the
aggregated names; callers import the submodule they want directly.
"""

from __future__ import annotations

import importlib
from types import ModuleType
from typing import Any

#: Submodules whose public names are re-exported, in the original order.
_SUBMODULES = (".exporter", ".scan", ".settings", ".trash")


def _importable() -> tuple[list[ModuleType], dict[str, BaseException]]:
    """Import every submodule that can be imported right now.

    A submodule that fails to import (``.settings`` without PySide6) is not an
    error here -- the rest of the package is still perfectly usable. It is
    only reported if a caller asks for a name we could not find anywhere.
    """
    modules: list[ModuleType] = []
    failures: dict[str, BaseException] = {}
    for target in _SUBMODULES:
        try:
            modules.append(importlib.import_module(target, __name__))
        except ImportError as exc:  # pragma: no cover - depends on environment
            failures[target] = exc
    return modules, failures


def __getattr__(name: str) -> Any:
    # Never serve dunders from a submodule: the import machinery probes names
    # like __all__ and __path__ on the package, and answering those from a
    # submodule would silently change what `import *` picks up.
    if name.startswith("__") and name.endswith("__"):
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    modules, failures = _importable()
    for module in modules:
        if hasattr(module, name):
            return getattr(module, name)

    # Stay an AttributeError (so hasattr/duck-typing keep working) but say why
    # the name might be missing rather than looking like a plain typo.
    hint = ""
    if failures:
        detail = "; ".join(f"{t} ({e})" for t, e in sorted(failures.items()))
        hint = f" -- note these submodules are unavailable: {detail}"
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}{hint}")


def __dir__() -> list[str]:
    modules, _ = _importable()
    names: set[str] = set()
    for module in modules:
        names.update(getattr(module, "__all__", None) or dir(module))
    return sorted(names)
