from __future__ import annotations

from pathlib import Path

from send2trash import send2trash


def trash_paths(paths: list[Path]) -> None:
    for path in paths:
        send2trash(str(path))
