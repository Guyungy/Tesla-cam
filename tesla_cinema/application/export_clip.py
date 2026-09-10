"""Use case: build a strict export request and run the exporter."""

from __future__ import annotations

from pathlib import Path

from tesla_cinema.application.ports import ExportRequestBuilder, StrictExporter
from tesla_cinema.domain.models import CamClip, CamFootage, StrictExportRequest, ViewType


def build_export_job(
    clip: CamClip,
    footage: CamFootage,
    view_type: ViewType,
    *,
    export_start_seconds: float,
    export_duration_seconds: float,
    location_text: str | None = None,
    show_location: bool = True,
    show_drive_data: bool = True,
    request_builder: ExportRequestBuilder | None = None,
) -> StrictExportRequest:
    if request_builder is None:
        from tesla_cinema.services.exporter import build_export_request as request_builder
    return request_builder(
        clip,
        footage,
        view_type,
        export_start_seconds=export_start_seconds,
        export_duration_seconds=export_duration_seconds,
        location_text=location_text if location_text is not None else clip.location_text,
        show_location=show_location,
        show_drive_data=show_drive_data,
    )


def export_clip(
    clip: CamClip,
    footage: CamFootage,
    view_type: ViewType,
    output_path: Path,
    *,
    export_start_seconds: float,
    export_duration_seconds: float,
    location_text: str | None = None,
    show_location: bool = True,
    show_drive_data: bool = True,
    request_builder: ExportRequestBuilder | None = None,
    exporter: StrictExporter | None = None,
) -> StrictExportRequest:
    """Build + run export. Returns the request that was executed."""
    request = build_export_job(
        clip,
        footage,
        view_type,
        export_start_seconds=export_start_seconds,
        export_duration_seconds=export_duration_seconds,
        location_text=location_text,
        show_location=show_location,
        show_drive_data=show_drive_data,
        request_builder=request_builder,
    )
    if exporter is None:
        from tesla_cinema.services.exporter import run_strict_export as exporter
    exporter(request, output_path)
    return request
