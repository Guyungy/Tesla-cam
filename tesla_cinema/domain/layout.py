"""View-layout rules: which cameras belong on which canvas (pure domain)."""

from __future__ import annotations

from tesla_cinema.domain.models import ALL_CAMS, CamName, ViewType


def cameras_for_view(view_type: ViewType) -> list[CamName]:
    """Cameras required to compose *view_type*."""
    if view_type == "grid6":
        return list(ALL_CAMS)
    if view_type in {"grid4", "grid4old"}:
        return ["front", "back", "left", "right"]
    return [view_type]  # type: ignore[list-item]


def camera_labels() -> dict[CamName, str]:
    """Stable English labels for HUD / export overlays."""
    return {
        "front": "Front",
        "back": "Rear",
        "left": "Left",
        "right": "Right",
        "left_pillar": "L-Pillar",
        "right_pillar": "R-Pillar",
    }


def is_grid_view(view_type: ViewType) -> bool:
    return view_type in {"grid4", "grid4old", "grid6"}
