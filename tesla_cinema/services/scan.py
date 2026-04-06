from __future__ import annotations

import json
from pathlib import Path

from tesla_cinema.domain.models import CamClip, CamClipEvent, CamFootage, CamName, CamSegment
from tesla_cinema.services.sei import convert_to_data_points, extract_sei_from_file


RECENT_DIR_NAME = "RecentClips"


def parse_time(text: str | None) -> str:
    if not text:
        return ""
    ymd = text[:10]
    hour = text[11:13]
    minute = text[14:16]
    second = text[17:19]
    return f"{ymd} {hour}:{minute}:{second}"


def resolve_clip_type(parent_name: str) -> str:
    lowered = parent_name.lower()
    if "recent" in lowered:
        return "recent"
    if "sentry" in lowered:
        return "sentry"
    return "saved"


def resolve_cam_name(file_name: str) -> CamName | None:
    rest_name = file_name[20:]
    if rest_name.startswith("front"):
        return "front"
    if rest_name.startswith("back"):
        return "back"
    if rest_name.startswith("left_repeater"):
        return "left"
    if rest_name.startswith("right_repeater"):
        return "right"
    if rest_name.startswith("left_pillar"):
        return "left_pillar"
    if rest_name.startswith("right_pillar"):
        return "right_pillar"
    return None


def camera_labels() -> dict[CamName, str]:
    return {
        "front": "Front",
        "back": "Rear",
        "left": "Left",
        "right": "Right",
        "left_pillar": "L-Pillar",
        "right_pillar": "R-Pillar",
    }


def read_event(path: Path) -> CamClipEvent | None:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return CamClipEvent(
        timestamp=str(raw.get("timestamp", "")),
        city=str(raw.get("city", "")),
        street=str(raw.get("street", "")),
        est_lat=str(raw.get("est_lat", "")),
        est_lon=str(raw.get("est_lon", "")),
        reason=str(raw.get("reason", "")),
        camera=str(raw.get("camera", "")),
    )


def scan_teslacam_folder(folder: Path) -> list[CamClip]:
    clip_map: dict[str, CamClip] = {}
    for path in folder.rglob("*"):
        if not path.is_file():
            continue
        parent_name = path.parent.name
        if not parent_name:
            continue
        clip_key = RECENT_DIR_NAME if parent_name == RECENT_DIR_NAME else parent_name
        clip = clip_map.setdefault(
            clip_key,
            CamClip(name=clip_key, type=resolve_clip_type(path.parent.parent.name if parent_name != RECENT_DIR_NAME else RECENT_DIR_NAME)),
        )
        clip.source_paths.append(path)
        if path.name == "thumb.png":
            clip.thumb = path
        elif path.suffix.lower() == ".mp4":
            clip.videos.append(path)
        elif path.name == "event.json":
            clip.event = read_event(path)
    clips = [clip for clip in clip_map.values() if clip.videos]
    for clip in clips:
        clip.source_paths = sorted(set(clip.source_paths))
        if clip.name == RECENT_DIR_NAME and clip.videos:
            clip.name = clip.videos[0].name[:19]
    clips.sort(key=lambda item: item.name, reverse=True)
    return clips


def build_footage(clip: CamClip) -> CamFootage:
    segment_map: dict[str, CamSegment] = {}
    for video in clip.videos:
        seg_name = video.name[:19]
        segment = segment_map.setdefault(seg_name, CamSegment(name=seg_name))
        cam_name = resolve_cam_name(video.name)
        if cam_name:
            segment.cameras[cam_name] = video

    segments = sorted(segment_map.values(), key=lambda item: item.name)
    total_duration = 0.0
    for segment in segments:
        segment.duration = 60.0 if segment.cameras else 0.0
        segment.start_seconds = total_duration
        total_duration += segment.duration

    sei_data = extract_clip_sei(clip, segments)
    return CamFootage(segments=segments, duration=total_duration, sei_data=sei_data)


def extract_clip_sei(clip: CamClip, segments: list[CamSegment]):
    front_files = {
        video.name[:19]: video
        for video in clip.videos
        if resolve_cam_name(video.name) == "front"
    }
    all_points = []
    for segment in segments:
        front_file = front_files.get(segment.name)
        if not front_file:
            continue
        try:
            raw_messages = extract_sei_from_file(front_file)
        except Exception:
            raw_messages = []
        if raw_messages:
            frame_duration_ms = (segment.duration * 1000.0) / max(len(raw_messages), 1)
            all_points.extend(convert_to_data_points(raw_messages, segment.start_seconds, frame_duration_ms))
    return all_points
