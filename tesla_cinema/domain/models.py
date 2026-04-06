from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal


ClipType = Literal["recent", "saved", "sentry"]
CamName = Literal["front", "back", "left", "right", "left_pillar", "right_pillar"]
ViewType = Literal["grid6", "grid4", "grid4old", "front", "back", "left", "right", "left_pillar", "right_pillar"]
GearState = Literal["P", "R", "N", "D", "UNKNOWN"]
APStatus = Literal["OFF", "STANDBY", "AP", "FSD", "UNKNOWN"]

ALL_CAMS: tuple[CamName, ...] = (
    "front",
    "back",
    "left",
    "right",
    "left_pillar",
    "right_pillar",
)


@dataclass(slots=True)
class CamClipEvent:
    timestamp: str = ""
    city: str = ""
    street: str = ""
    est_lat: str = ""
    est_lon: str = ""
    reason: str = ""
    camera: str = ""


@dataclass(slots=True)
class SEIDataPoint:
    offset_seconds: float
    speed_kph: float
    gear: GearState
    steering_angle_deg: float
    brake_pct: float
    throttle_pct: float
    ap_status: APStatus
    latitude: float
    longitude: float


@dataclass(slots=True)
class CamSegment:
    name: str
    duration: float = 0.0
    start_seconds: float = 0.0
    cameras: dict[CamName, Path] = field(default_factory=dict)


@dataclass(slots=True)
class CamClip:
    name: str
    type: ClipType = "saved"
    save_type: str = ""
    videos: list[Path] = field(default_factory=list)
    thumb: Path | None = None
    event: CamClipEvent | None = None
    source_paths: list[Path] = field(default_factory=list)

    @property
    def location_text(self) -> str:
        if not self.event:
            return "Unknown location"
        parts = [part for part in [self.event.city, self.event.street] if part]
        return ", ".join(parts) if parts else "Unknown location"


@dataclass(slots=True)
class CamFootage:
    segments: list[CamSegment]
    duration: float
    sei_data: list[SEIDataPoint] = field(default_factory=list)


@dataclass(slots=True)
class StrictExportSegment:
    name: str
    duration_seconds: float
    trim_start_seconds: float
    cameras: dict[CamName, Path]


@dataclass(slots=True)
class StrictTelemetryFrame:
    timestamp_text: str
    speed_kph: float
    gear: str
    ap_status: str


@dataclass(slots=True)
class StrictExportRequest:
    file_name: str
    clip_name: str
    view_type: ViewType
    width: int
    height: int
    video_height: int
    fps: int
    export_start_seconds: float
    export_duration_seconds: float
    segments: list[StrictExportSegment]
    telemetry_frames: list[StrictTelemetryFrame]
    location_text: str
    show_location: bool
    show_drive_data: bool
    camera_labels: dict[CamName, str]
    brand_text: str = "TESLA CINEMA"
