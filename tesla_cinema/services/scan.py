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


def wall_clock_text(segment_name: str, offset_in_segment: float = 0.0) -> str:
    """Absolute wall-clock time for a point inside a TeslaCam segment.

    Segment names are ``YYYY-MM-DD_HH-MM-SS``; *offset_in_segment* advances that
    base time so mid-segment timestamps stay honest in HUD and exports.
    """
    base = (segment_name or "")[:19]
    if len(base) < 19:
        return parse_time(segment_name)
    try:
        from datetime import datetime, timedelta

        dt = datetime.strptime(base, "%Y-%m-%d_%H-%M-%S")
        if offset_in_segment > 0:
            dt = dt + timedelta(seconds=float(offset_in_segment))
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return parse_time(segment_name)


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
    """Backward-compatible re-export of domain layout labels."""
    from tesla_cinema.domain.layout import camera_labels as _labels

    return _labels()


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


# RecentClips is a flat dump of ~1‑minute multi-cam slices. Group consecutive
# stamps into sessions when the gap between stamps stays under this threshold.
RECENT_SESSION_GAP_SECONDS = 180.0


def _stamp_to_epoch(stamp: str) -> float | None:
    """Parse ``YYYY-MM-DD_HH-MM-SS`` (19 chars) to epoch seconds."""
    if len(stamp) < 19:
        return None
    try:
        from datetime import datetime

        return datetime.strptime(stamp[:19], "%Y-%m-%d_%H-%M-%S").timestamp()
    except Exception:
        return None


def _split_recent_videos(videos: list[Path]) -> list[list[Path]]:
    """Split a flat RecentClips video list into contiguous drive sessions."""
    if not videos:
        return []
    # Bucket by segment stamp (first 19 chars of filename).
    by_stamp: dict[str, list[Path]] = {}
    for path in videos:
        stamp = path.name[:19]
        by_stamp.setdefault(stamp, []).append(path)

    stamps = sorted(by_stamp.keys())
    sessions: list[list[Path]] = []
    current: list[Path] = []
    prev_epoch: float | None = None

    for stamp in stamps:
        epoch = _stamp_to_epoch(stamp)
        if (
            current
            and prev_epoch is not None
            and epoch is not None
            and (epoch - prev_epoch) > RECENT_SESSION_GAP_SECONDS
        ):
            sessions.append(current)
            current = []
        current.extend(by_stamp[stamp])
        if epoch is not None:
            prev_epoch = epoch

    if current:
        sessions.append(current)
    return sessions


def scan_teslacam_folder(
    folder: Path,
    *,
    include_recent: bool = False,
) -> list[CamClip]:
    """Index Saved / Sentry event folders.

    RecentClips is a flat rolling buffer (often 1000+ files). Loading it freezes
    the UI and confuses the sidebar, so it is **skipped by default**. Pass
    ``include_recent=True`` to also split it into contiguous sessions.
    """
    clip_map: dict[str, CamClip] = {}
    recent_videos: list[Path] = []
    recent_misc: list[Path] = []

    for path in folder.rglob("*"):
        if not path.is_file():
            continue
        parent_name = path.parent.name
        if not parent_name:
            continue

        # ---- RecentClips: optional ----
        if parent_name == RECENT_DIR_NAME or (
            path.parent.parent and path.parent.parent.name == RECENT_DIR_NAME
        ):
            if not include_recent:
                continue
            if path.parent.name == RECENT_DIR_NAME:
                if path.suffix.lower() == ".mp4":
                    recent_videos.append(path)
                else:
                    recent_misc.append(path)
                continue

        # ---- Saved / Sentry (and any other event subfolder) ----
        clip_key = parent_name
        parent_of_parent = path.parent.parent.name if path.parent.parent else ""
        clip = clip_map.setdefault(
            clip_key,
            CamClip(
                name=clip_key,
                type=resolve_clip_type(parent_of_parent),  # type: ignore[arg-type]
            ),
        )
        clip.source_paths.append(path)
        if path.name == "thumb.png":
            clip.thumb = path
        elif path.suffix.lower() == ".mp4":
            clip.videos.append(path)
        elif path.name == "event.json":
            clip.event = read_event(path)

    clips: list[CamClip] = [c for c in clip_map.values() if c.videos]

    if include_recent:
        for session_videos in _split_recent_videos(recent_videos):
            session_videos = sorted(session_videos, key=lambda p: p.name)
            if not session_videos:
                continue
            name = session_videos[0].name[:19]
            clip_name = name
            suffix = 1
            existing_names = {c.name for c in clips}
            while clip_name in existing_names:
                suffix += 1
                clip_name = f"{name}-recent{suffix}"
            clips.append(
                CamClip(
                    name=clip_name,
                    type="recent",
                    videos=session_videos,
                    source_paths=list(session_videos),
                )
            )
        if recent_misc:
            recent_clips = [c for c in clips if c.type == "recent"]
            if recent_clips:
                newest = max(recent_clips, key=lambda c: c.name)
                newest.source_paths.extend(recent_misc)

    for clip in clips:
        clip.source_paths = sorted(set(clip.source_paths))
        clip.videos = sorted(set(clip.videos), key=lambda p: p.name)

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
                header = f.read(8)
                if len(header) < 8:
                    break
                size = int.from_bytes(header[0:4], "big")
                box_type = header[4:8]
                h = 8
                if size == 1:
                    # 64-bit largesize follows the 8-byte header.
                    largesize = f.read(8)
                    if len(largesize) < 8:
                        break
                    size = int.from_bytes(largesize, "big")
                    h = 16
                elif size == 0:
                    size = file_size - pos
                if box_type == b"moov":
                    # File pointer is exactly at the start of the moov payload.
                    moov_data = f.read(min(max(size - h, 0), 131072))
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


def build_footage(clip: CamClip, *, include_sei: bool = True) -> CamFootage:
    """Build segment timeline. SEI can be deferred for snappy UI open."""
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

    sei_data = extract_clip_sei(clip, segments) if include_sei else []
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
