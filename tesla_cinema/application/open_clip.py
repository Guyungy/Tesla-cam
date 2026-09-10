"""Use case: open a clip into full footage (segments + optional telemetry)."""

from __future__ import annotations

from tesla_cinema.application.ports import FootageBuilder
from tesla_cinema.domain.models import CamClip, CamFootage, CamSegment, SEIDataPoint


def open_clip(
    clip: CamClip,
    *,
    builder: FootageBuilder | None = None,
    include_sei: bool = True,
) -> CamFootage:
    """Open a clip. Pass ``include_sei=False`` for a fast timeline-only open."""
    if builder is None:
        from tesla_cinema.services.scan import build_footage

        return build_footage(clip, include_sei=include_sei)
    return builder(clip)


def load_clip_sei(clip: CamClip, segments: list[CamSegment]) -> list[SEIDataPoint]:
    """Heavy SEI parse — run off the UI thread."""
    from tesla_cinema.services.scan import extract_clip_sei

    return extract_clip_sei(clip, segments)
