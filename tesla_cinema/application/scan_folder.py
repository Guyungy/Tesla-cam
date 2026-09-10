"""Use case: scan a TeslaCam root folder into clip summaries."""

from __future__ import annotations

from pathlib import Path

from tesla_cinema.application.ports import ClipScanner
from tesla_cinema.domain.models import CamClip


def scan_folder(
    folder: Path,
    *,
    scanner: ClipScanner | None = None,
    include_recent: bool = False,
) -> list[CamClip]:
    if scanner is None:
        from tesla_cinema.services.scan import scan_teslacam_folder

        return scan_teslacam_folder(folder, include_recent=include_recent)
    return scanner(folder)
