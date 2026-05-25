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


def probe_duration(path: Path) -> float:
    """Read video duration by parsing the MP4 mvhd atom directly — no subprocess needed."""
    try:
        file_size = path.stat().st_size
        with path.open("rb") as f:
            pos = 0
            while pos + 8 <= file_size:
                f.seek(pos)
                raw = f.read(16)
                if len(raw) < 8:
                    break
                size = int.from_bytes(raw[0:4], "big")
                box_type = raw[4:8]
                h = 8
                if size == 1:
                    if len(raw) < 16:
                        break
                    size = int.from_bytes(raw[8:16], "big")
                    h = 16
                elif size == 0:
                    size = file_size - pos
                if box_type == b"moov":
                    moov_data = f.read(min(size - h, 131072))
                    dur = _mvhd_duration(moov_data)
                    if dur is not None:
                        return dur
                    break
                if size <= 0:
                    break
                pos += size
    except Exception:
        pass
    return 60.0


def _mvhd_duration(moov: bytes) -> float | None:
    pos, total = 0, len(moov)
    while pos + 8 <= total:
        size = int.from_bytes(moov[pos : pos + 4], "big")
        box_type = moov[pos + 4 : pos + 8]
        h = 8
        if size == 1 and pos + 16 <= total:
            size = int.from_bytes(moov[pos + 8 : pos + 16], "big")
            h = 16
        elif size == 0:
            size = total - pos
        if box_type == b"mvhd":
            body = moov[pos + h :]
            version = body[0] if body else 0
            if version == 1:
                ts = int.from_bytes(body[20:24], "big")
                dur = int.from_bytes(body[24:32], "big")
            else:
                ts = int.from_bytes(body[12:16], "big")
                dur = int.from_bytes(body[16:20], "big")
            return float(dur) / ts if ts else None
        if size <= 8:
            break
        pos += size
    return None


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
        if segment.cameras:
            representative = next(iter(segment.cameras.values()))
            segment.duration = probe_duration(representative)
        else:
            segment.duration = 0.0
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
