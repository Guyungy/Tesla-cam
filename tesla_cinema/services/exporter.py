from __future__ import annotations

import bisect
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path

import imageio_ffmpeg

from tesla_cinema.domain.models import ALL_CAMS, CamClip, CamFootage, CamName, SEIDataPoint, StrictExportRequest, StrictExportSegment, StrictTelemetryFrame, ViewType
from tesla_cinema.services.scan import camera_labels, parse_time, resolve_cam_name


_cached_encoder: str | None = None


def _detect_h264_encoder(ffmpeg: str) -> str:
    """Return the fastest available H.264 encoder on this machine, cached after first call."""
    global _cached_encoder
    if _cached_encoder is not None:
        return _cached_encoder

    system = platform.system()
    if system == "Windows":
        candidates = ["h264_nvenc", "h264_amf", "h264_qsv"]
    elif system == "Darwin":
        candidates = ["h264_videotoolbox"]
    else:
        candidates = ["h264_nvenc", "h264_qsv"]

    probe = [
        ffmpeg, "-hide_banner",
        "-f", "lavfi", "-i", "color=black:s=64x64:d=0.04:r=5",
        "-frames:v", "1",
    ]
    for enc in candidates:
        try:
            result = subprocess.run(
                [*probe, "-c:v", enc, "-f", "null", "-"],
                capture_output=True,
                timeout=8,
            )
            if result.returncode == 0:
                _cached_encoder = enc
                return enc
        except Exception:
            pass

    _cached_encoder = "libx264"
    return "libx264"


def _encoder_params(encoder: str) -> list[str]:
    if encoder == "libx264":
        return ["-preset", "veryfast", "-crf", "18"]
    if encoder == "h264_nvenc":
        return ["-preset", "p4", "-cq", "18"]
    if encoder == "h264_amf":
        return ["-quality", "speed", "-qp_i", "16", "-qp_p", "18"]
    if encoder == "h264_videotoolbox":
        return ["-q:v", "65"]
    if encoder == "h264_qsv":
        return ["-preset", "medium", "-global_quality", "18"]
    return ["-crf", "18"]


TESLA_ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><path d="M40 2L10 2C9.445 2 9 2.449 9 3L9 47C9 47.551 9.445 48 10 48L40 48C40.555 48 41 47.551 41 47L41 3C41 2.449 40.555 2 40 2ZM23.137 10.094C24.375 10.063 25.625 10.063 26.867 10.094C30.074 10.176 33.285 10.515 36.309 11.539L35.633 12.531C33.074 11.633 30.035 11.199 26.828 11.105C25.617 11.066 24.383 11.066 23.172 11.105C19.965 11.199 16.93 11.633 14.367 12.531L13.695 11.539C16.719 10.515 19.926 10.176 23.137 10.094ZM17.086 37.078C17.02 37.359 16.793 37.594 16.484 37.715L15.547 37.715L15.492 37.738L15.492 40.27L14.906 40.27L14.906 37.738L14.859 37.715L13.922 37.715C13.613 37.594 13.387 37.359 13.32 37.078L13.32 37.074L17.086 37.074ZM21.34 40.266L19.113 40.266C18.801 40.141 18.57 39.906 18.508 39.625L21.941 39.625C21.879 39.906 21.652 40.141 21.34 40.266ZM21.34 38.965L19.113 38.965C18.801 38.844 18.57 38.605 18.508 38.328L21.941 38.328C21.879 38.605 21.652 38.844 21.34 38.965ZM21.34 37.727L19.113 37.727C18.801 37.602 18.57 37.367 18.508 37.086L21.941 37.086C21.879 37.367 21.652 37.602 21.34 37.727ZM26.867 40.27L23.617 40.27L23.629 40.246C23.691 39.965 23.918 39.75 24.223 39.625L26.289 39.625L26.289 38.965L23.617 38.965L23.617 37.078L26.852 37.078C26.785 37.359 26.559 37.609 26.25 37.703L24.191 37.703L24.191 38.336L26.867 38.336ZM31.16 40.246L28.523 40.238L28.523 37.078L29.102 37.074L29.098 39.617L31.668 39.617C31.605 39.883 31.449 40.113 31.16 40.246ZM28.453 13.633L25 32.164L21.547 13.633C19.699 13.633 17.781 13.918 17.73 15.277C16.863 15.059 15.281 14.074 14.918 13.383C17.555 12.316 21.902 12.176 23.789 12.246L25 13.8L26.211 12.246C28.098 12.176 32.449 12.316 35.086 13.383C34.719 14.074 33.137 15.059 32.266 15.277C32.219 13.918 30.297 13.633 28.453 13.633ZM36.602 40.258L36.027 40.258L36.027 38.969L33.934 38.969L33.934 40.258L33.355 40.258L33.355 38.32L36.602 38.324ZM36.086 37.711L33.859 37.711C33.547 37.586 33.305 37.363 33.246 37.082L36.68 37.082C36.617 37.363 36.398 37.586 36.086 37.711Z" fill="white"/></svg>"""


def strict_export_cams(view_type: ViewType) -> list[CamName]:
    if view_type == "grid6":
        return list(ALL_CAMS)
    if view_type in {"grid4", "grid4old"}:
        return ["front", "back", "left", "right"]
    return [view_type]


def resolve_canvas_size(view_type: ViewType) -> tuple[int, int, int]:
    base_width = 1280
    base_height = 720
    bottom_bar = 60
    if view_type == "grid6":
        return base_width * 3, base_height * 2 + bottom_bar, base_height * 2
    if view_type == "grid4":
        return base_width * 2, base_height * 2 + bottom_bar, base_height * 2
    if view_type == "grid4old":
        return base_width * 3, base_height * 2 + bottom_bar, base_height * 2
    return base_width, base_height + bottom_bar, base_height


def build_export_request(
    clip: CamClip,
    footage: CamFootage,
    view_type: ViewType,
    export_start_seconds: float,
    export_duration_seconds: float,
    location_text: str,
    show_location: bool,
    show_drive_data: bool,
) -> StrictExportRequest:
    width, height, video_height = resolve_canvas_size(view_type)
    required_cams = strict_export_cams(view_type)
    source_path_map: dict[str, dict[CamName, Path]] = {}
    for video in clip.videos:
        cam = resolve_cam_name(video.name)
        if cam:
            source_path_map.setdefault(video.name[:19], {})[cam] = video

    segments: list[StrictExportSegment] = []
    remaining = export_duration_seconds
    cursor = export_start_seconds
    while remaining > 0.0001:
        segment = resolve_segment(footage, cursor)
        if segment is None:
            break
        trim_start = max(0.0, cursor - segment.start_seconds)
        duration = min(remaining, max(0.0, segment.duration - trim_start))
        cameras: dict[CamName, Path] = {}
        for cam in required_cams:
            source = source_path_map.get(segment.name, {}).get(cam)
            if not source:
                raise RuntimeError(f"Missing source video for {cam} in segment {segment.name}")
            cameras[cam] = source
        segments.append(
            StrictExportSegment(
                name=segment.name,
                duration_seconds=duration,
                trim_start_seconds=trim_start,
                cameras=cameras,
            )
        )
        remaining -= duration
        cursor += duration

    return StrictExportRequest(
        file_name=f"{clip.name}-{view_type}.mp4",
        clip_name=clip.name,
        view_type=view_type,
        width=width,
        height=height,
        video_height=video_height,
        fps=30,
        export_start_seconds=export_start_seconds,
        export_duration_seconds=export_duration_seconds,
        segments=segments,
        telemetry_frames=build_telemetry_frames(footage, export_start_seconds, export_duration_seconds) if show_drive_data else [],
        location_text=location_text,
        show_location=show_location,
        show_drive_data=show_drive_data,
        camera_labels=camera_labels(),
    )


def resolve_segment(footage: CamFootage, clip_seconds: float):
    for segment in footage.segments:
        if segment.start_seconds <= clip_seconds < segment.start_seconds + segment.duration:
            return segment
    return footage.segments[-1] if footage.segments else None


def build_telemetry_frames(footage: CamFootage, export_start_seconds: float, export_duration_seconds: float) -> list[StrictTelemetryFrame]:
    if not footage.sei_data:
        return []
    frame_count = max(1, int(export_duration_seconds * 30))
    offsets = [p.offset_seconds for p in footage.sei_data]
    frames: list[StrictTelemetryFrame] = []
    for frame_index in range(frame_count):
        target = export_start_seconds + frame_index / 30.0
        point = find_closest_sei(footage.sei_data, offsets, target)
        segment = resolve_segment(footage, target)
        if point is None or segment is None:
            return []
        frames.append(
            StrictTelemetryFrame(
                timestamp_text=parse_time(segment.name),
                speed_kph=point.speed_kph,
                gear=point.gear,
                ap_status=point.ap_status,
            )
        )
    return frames


def find_closest_sei(sei_data: list[SEIDataPoint], offsets: list[float], target: float) -> SEIDataPoint | None:
    if not sei_data:
        return None
    pos = bisect.bisect_left(offsets, target)
    if pos == 0:
        return sei_data[0]
    if pos >= len(sei_data):
        return sei_data[-1]
    before, after = sei_data[pos - 1], sei_data[pos]
    return before if (target - before.offset_seconds) <= (after.offset_seconds - target) else after


def _build_telemetry_drawtext(frames: list[StrictTelemetryFrame], video_height: int, fps: int) -> list[str]:
    """Build per-frame animated drawtext filters using FFmpeg enable expressions.

    Consecutive frames with identical display values are collapsed into one filter
    to keep the filter graph small.
    """
    filters: list[str] = []
    if not frames:
        return filters

    def _key(f: StrictTelemetryFrame) -> tuple:
        return (round(f.speed_kph), f.gear, f.timestamp_text, f.ap_status)

    def _emit(start_i: int, end_i: int, frame: StrictTelemetryFrame) -> None:
        start_t = start_i / fps
        end_t = (end_i + 1) / fps
        enable = f"between(t,{start_t:.3f},{end_t:.3f})"
        speed_text = f"{round(frame.speed_kph)} km/h"
        filters.append(
            f"drawtext=text='{escape_text(speed_text)}':enable='{enable}':font='Segoe UI':fontsize=24:fontcolor=0x22c55e:x=(w-tw)/2:y=10"
        )
        filters.append(
            f"drawtext=text='{escape_text(frame.gear)}':enable='{enable}':font='Segoe UI':fontsize=20:fontcolor=white:x=24:y=12"
        )
        filters.append(
            f"drawtext=text='{escape_text(frame.timestamp_text)}':enable='{enable}':font='Segoe UI':fontsize=26:fontcolor=white:x=70:y={video_height + 24}"
        )
        if frame.ap_status and frame.ap_status != "UNKNOWN":
            filters.append(
                f"drawtext=text='{escape_text(frame.ap_status)}':enable='{enable}':font='Segoe UI':fontsize=12:fontcolor=white:x=w-tw-24:y=18"
            )

    group_start = 0
    for i in range(1, len(frames)):
        if _key(frames[i]) != _key(frames[i - 1]):
            _emit(group_start, i - 1, frames[i - 1])
            group_start = i
    _emit(group_start, len(frames) - 1, frames[-1])
    return filters


def run_strict_export(request: StrictExportRequest, output_path: Path) -> None:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    encoder = _detect_h264_encoder(ffmpeg)
    temp_dir = Path(tempfile.mkdtemp(prefix="tesla-cinema-export-"))
    try:
        icon_path = temp_dir / "tesla-icon.svg"
        icon_path.write_text(TESLA_ICON_SVG, encoding="utf-8")
        filter_complex, input_args = build_filter_graph(request, icon_path)
        command = [
            ffmpeg,
            "-y",
            *input_args,
            "-filter_complex",
            filter_complex,
            "-map",
            "[outv]",
            "-an",
            "-c:v",
            encoder,
            *_encoder_params(encoder),
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
        completed = subprocess.run(command, capture_output=True, text=True)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr.strip() or "FFmpeg export failed")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def build_filter_graph(request: StrictExportRequest, icon_path: Path) -> tuple[str, list[str]]:
    input_args: list[str] = []
    filter_parts: list[str] = []
    final_labels: dict[CamName, str] = {}
    input_index = 0
    for cam in strict_export_cams(request.view_type):
        segment_labels: list[str] = []
        for segment_index, segment in enumerate(request.segments):
            source = segment.cameras[cam]
            input_args.extend(["-i", str(source)])
            trim_label = f"[{cam}_{segment_index}_trim]"
            output_label = f"[{cam}_{segment_index}]"
            filter_parts.append(
                f"[{input_index}:v]trim=start={segment.trim_start_seconds:.3f}:end={(segment.trim_start_seconds + segment.duration_seconds):.3f},setpts=PTS-STARTPTS{trim_label}"
            )
            width, height = camera_size(request.view_type, cam, request.width, request.video_height)
            filter_parts.append(
                f"{trim_label}scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1{output_label}"
            )
            segment_labels.append(output_label)
            input_index += 1
        final_label = f"[{cam}_final]"
        filter_parts.append(f"{''.join(segment_labels)}concat=n={len(segment_labels)}:v=1:a=0{final_label}" if len(segment_labels) > 1 else f"{segment_labels[0]}null{final_label}")
        final_labels[cam] = final_label

    input_args.extend(["-i", str(icon_path)])
    icon_input = input_index
    filter_parts.extend(layout_filters(request.view_type, final_labels))
    overlays = [
        f"[stacked]drawbox=x=0:y={request.video_height}:w={request.width}:h={request.height - request.video_height}:color=black@0.85:t=fill",
        f"drawtext=text='{escape_text(request.brand_text)}':font='Segoe UI':fontsize=18:fontcolor=0xfb7185:x=70:y={request.video_height + 12}",
    ]
    if request.show_location and request.location_text:
        overlays.append(
            f"drawtext=text='{escape_text(request.location_text)}':font='Segoe UI':fontsize=14:fontcolor=white:x=w-tw-22:y={request.video_height + 20}"
        )
    if request.telemetry_frames:
        overlays.append("drawbox=x=0:y=0:w=iw:h=50:color=black@0.6:t=fill")
        overlays.extend(_build_telemetry_drawtext(request.telemetry_frames, request.video_height, request.fps))

    # Bug fix: icon scale and final overlay must be separate filter chains (`;`-separated),
    # not comma-chained with the overlay filters.
    filter_parts.append(",".join(overlays) + "[base]")
    filter_parts.append(f"[{icon_input}:v]scale=30:30[icon]")
    filter_parts.append(f"[base][icon]overlay=22:{request.video_height + 14}[outv]")
    return ";".join(filter_parts), input_args


def layout_filters(view_type: ViewType, labels: dict[CamName, str]) -> list[str]:
    if view_type == "grid6":
        return [
            f"{labels['left']}{labels['front']}{labels['right']}hstack=inputs=3[row0]",
            f"{labels['left_pillar']}{labels['back']}{labels['right_pillar']}hstack=inputs=3[row1]",
            "[row0][row1]vstack=inputs=2[stacked]",
        ]
    if view_type == "grid4":
        return [
            f"{labels['front']}{labels['back']}hstack=inputs=2[row0]",
            f"{labels['left']}{labels['right']}hstack=inputs=2[row1]",
            "[row0][row1]vstack=inputs=2[stacked]",
        ]
    if view_type == "grid4old":
        return [
            f"{labels['left']}{labels['back']}{labels['right']}hstack=inputs=3[row1]",
            f"{labels['front']}[row1]vstack=inputs=2[stacked]",
        ]
    return [f"{labels[view_type]}null[stacked]"]


def camera_size(view_type: ViewType, cam: CamName, width: int, video_height: int) -> tuple[int, int]:
    if view_type == "grid6":
        col = width // 3
        row = video_height // 2
        if cam in {"right", "right_pillar"}:
            return width - col * 2, row if cam == "right" else video_height - row
        if cam in {"left_pillar", "back"}:
            return col, video_height - row
        return col, row
    if view_type == "grid4":
        half_w = width // 2
        half_h = video_height // 2
        if cam in {"back", "right"}:
            return width - half_w, half_h if cam == "back" else video_height - half_h
        return half_w, half_h if cam == "front" else video_height - half_h
    if view_type == "grid4old":
        if cam == "front":
            return width, round(video_height * 0.6)
        third_w = width // 3
        top_h = round(video_height * 0.6)
        return (width - third_w * 2, video_height - top_h) if cam == "right" else (third_w, video_height - top_h)
    return width, video_height


def escape_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace("%", "%%")
