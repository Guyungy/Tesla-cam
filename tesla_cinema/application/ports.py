"""Infrastructure ports (Protocols). Domain/application depend only on these shapes."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from tesla_cinema.domain.models import (
    CamClip,
    CamFootage,
    StrictExportRequest,
    ViewType,
)


class ClipScanner(Protocol):
    def __call__(self, folder: Path) -> list[CamClip]: ...


class FootageBuilder(Protocol):
    def __call__(self, clip: CamClip) -> CamFootage: ...


class ExportRequestBuilder(Protocol):
    def __call__(
        self,
        clip: CamClip,
        footage: CamFootage,
        view_type: ViewType,
        export_start_seconds: float,
        export_duration_seconds: float,
        location_text: str,
        show_location: bool,
        show_drive_data: bool,
    ) -> StrictExportRequest: ...


class StrictExporter(Protocol):
    def __call__(self, request: StrictExportRequest, output_path: Path) -> None: ...


class TrashService(Protocol):
    def __call__(self, paths: list[Path]) -> None: ...
