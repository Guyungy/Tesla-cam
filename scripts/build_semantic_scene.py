"""Build an offline TeslaCam object detection and illustrative 3D scene page."""

from __future__ import annotations

import argparse
import base64
import io
import json
from pathlib import Path

from PIL import Image

CAMERAS = ("front", "back", "left", "right", "left_pillar", "right_pillar")


def build(images: Path, detections: Path, bundle: Path, output: Path,
          road: Path | None = None, lanes: Path | None = None) -> None:
    report = json.loads(detections.read_text(encoding="utf-8"))
    moments = report["moments"]
    road_report = json.loads(road.read_text(encoding="utf-8")) if road else {"textures": {}}
    if isinstance(road_report["textures"], list):
        road_report["textures"] = {"front": road_report["textures"]}
    if any(len(items) != len(moments) for items in road_report["textures"].values()):
        raise ValueError("Road frames and detections have different lengths")
    lane_report = json.loads(lanes.read_text(encoding="utf-8"))["moments"] if lanes else {}
    if any(len(items) != len(moments) for items in lane_report.values()):
        raise ValueError("Lane frames and detections have different lengths")
    frames: dict[str, list[str]] = {}
    camera_info = {}
    for camera in CAMERAS:
        frames[camera] = []
        for index in range(len(moments)):
            source = images / camera / f"frame_{index:06d}.jpg"
            with Image.open(source) as original:
                camera_info[camera] = {"width": original.width, "height": original.height}
                frame = original.convert("RGB")
                frame.thumbnail((960, 650), Image.Resampling.LANCZOS)
                stream = io.BytesIO()
                frame.save(stream, "JPEG", quality=75, optimize=True)
                frames[camera].append("data:image/jpeg;base64," + base64.b64encode(stream.getvalue()).decode())
    script = bundle.read_text(encoding="utf-8")
    if "</script" in script.lower():
        raise ValueError("JavaScript bundle cannot be safely embedded in HTML")
    page = (TEMPLATE.replace("__FRAMES__", json.dumps(frames, ensure_ascii=False))
            .replace("__DETECTIONS__", json.dumps(report, ensure_ascii=False))
            .replace("__ROAD__", json.dumps(road_report["textures"]))
            .replace("__LANES__", json.dumps(lane_report))
            .replace("__CAMERA_INFO__", json.dumps(camera_info))
            .replace("__BUNDLE__", script)
            .replace("__LAST__", str(len(moments) - 1)))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(page, encoding="utf-8")
    print(f"Wrote {len(moments)} six-camera moments to {output}")


TEMPLATE = Path(__file__).with_name("semantic_scene_template.html").read_text(encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--detections", type=Path, required=True)
    parser.add_argument("--road", type=Path)
    parser.add_argument("--lanes", type=Path)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(args.images, args.detections, args.bundle, args.output, args.road, args.lanes)


if __name__ == "__main__":
    main()
