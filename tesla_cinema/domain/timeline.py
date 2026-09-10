"""Timeline helpers over CamFootage — single source of truth for t → segment/telemetry."""

from __future__ import annotations

import bisect

from tesla_cinema.domain.models import CamFootage, CamSegment, SEIDataPoint


def segment_at(footage: CamFootage, clip_seconds: float) -> CamSegment | None:
    """Return the segment that contains *clip_seconds*, or the last segment if past the end."""
    if not footage.segments:
        return None
    for segment in footage.segments:
        if segment.start_seconds <= clip_seconds < segment.start_seconds + segment.duration:
            return segment
    return footage.segments[-1]


def telemetry_at(
    sei_data: list[SEIDataPoint],
    target_seconds: float,
    *,
    offsets: list[float] | None = None,
) -> SEIDataPoint | None:
    """Nearest SEI sample to *target_seconds* (binary search on offset)."""
    if not sei_data:
        return None
    offs = offsets if offsets is not None else [p.offset_seconds for p in sei_data]
    pos = bisect.bisect_left(offs, target_seconds)
    if pos == 0:
        return sei_data[0]
    if pos >= len(sei_data):
        return sei_data[-1]
    before, after = sei_data[pos - 1], sei_data[pos]
    if (target_seconds - before.offset_seconds) <= (after.offset_seconds - target_seconds):
        return before
    return after


def telemetry_at_footage(footage: CamFootage, target_seconds: float) -> SEIDataPoint | None:
    return telemetry_at(footage.sei_data, target_seconds)
