"""Estimate visible road silhouettes in TeslaCam frames with Cityscapes SegFormer.

The exported coordinates are image observations, not calibrated map coordinates.
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort


ROWS = (0.52, 0.58, 0.64, 0.70, 0.76, 0.82, 0.88, 0.94)


def estimate_boundaries(mask: np.ndarray) -> list[dict]:
    height, width = mask.shape
    result = []
    for fraction in ROWS:
        y = min(height - 1, round(fraction * height))
        band = mask[max(0, y - 3):min(height, y + 4)]
        road = np.count_nonzero(band, axis=0) >= max(2, band.shape[0] // 2)
        # Rows hidden by traffic have no observed road boundary.
        if not np.any(road):
            result.append({"y": fraction, "left": None, "right": None})
            continue
        indices = np.flatnonzero(road)
        groups = np.split(indices, np.where(np.diff(indices) > 1)[0] + 1)
        center = width // 2
        group = max(groups, key=lambda g: len(g) - 0.3 * abs((g[0] + g[-1]) / 2 - center))
        if len(group) < width * 0.06:
            result.append({"y": fraction, "left": None, "right": None})
            continue
        result.append({"y": fraction, "left": round(float(group[0] / width), 4),
                       "right": round(float(group[-1] / width), 4)})
    return result


def run(images: Path, model: Path, output: Path, preview: Path | None) -> None:
    session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    mean = np.array([.485, .456, .406], dtype=np.float32)
    std = np.array([.229, .224, .225], dtype=np.float32)
    timeline = []
    textures = []
    for index, path in enumerate(sorted(images.glob("frame_*.jpg"))):
        image = cv2.imread(str(path))
        rgb = cv2.cvtColor(cv2.resize(image, (512, 512)), cv2.COLOR_BGR2RGB)
        tensor = (((rgb.astype(np.float32) / 255 - mean) / std)
                  .transpose(2, 0, 1)[None].copy())
        logits = session.run(None, {"pixel_values": tensor})[0][0]
        labels = cv2.resize(logits.argmax(axis=0).astype(np.uint8),
                            (512, 512), interpolation=cv2.INTER_NEAREST)
        mask = labels == 0
        boundaries = estimate_boundaries(mask)
        timeline.append(boundaries)
        road_rgb = cv2.resize(image, (512, 332), interpolation=cv2.INTER_AREA)
        road_mask = cv2.resize(mask.astype(np.uint8), (512, 332),
                               interpolation=cv2.INTER_NEAREST)
        alpha = cv2.GaussianBlur(road_mask * 220, (5, 5), 0)
        bgra = np.dstack((road_rgb, alpha))
        ok, encoded = cv2.imencode('.webp', bgra, [cv2.IMWRITE_WEBP_QUALITY, 72])
        if not ok:
            raise RuntimeError(f'Could not encode road texture for {path}')
        textures.append('data:image/webp;base64,' + base64.b64encode(encoded).decode('ascii'))
        if preview is not None and index == 20:
            display = cv2.resize(image, (1024, 664))
            scaled = cv2.resize(mask.astype(np.uint8), (1024, 664),
                                interpolation=cv2.INTER_NEAREST)
            tint = display.copy()
            tint[scaled > 0] = (70, 180, 70)
            display = cv2.addWeighted(display, .67, tint, .33, 0)
            for row in boundaries:
                if row["left"] is None:
                    continue
                y = round(row["y"] * 664)
                for x in (row["left"], row["right"]):
                    cv2.circle(display, (round(x * 1024), y), 5, (0, 100, 255), -1)
            preview.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(preview), display)
        print(f"\rRoad masks {index + 1}", end="", flush=True)
    print()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"model": "SegFormer-B0 Cityscapes, road class 0",
                                  "note": "Image-space road mask; boundaries may be hidden or clipped",
                                  "moments": timeline, "textures": textures},
                                 separators=(',', ':')) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preview", type=Path)
    parser.add_argument("--six-view", action="store_true")
    args = parser.parse_args()
    if args.six_view:
        cameras = ("front", "back", "left", "right", "left_pillar", "right_pillar")
        expected = {p.name for p in (args.images / "front").glob("frame_*.jpg")}
        if not expected:
            parser.error("No front frames found")
        for camera in cameras:
            if {p.name for p in (args.images / camera).glob("frame_*.jpg")} != expected:
                parser.error(f"Frame timestamps differ for {camera}")
        reports = {}
        for camera in cameras:
            destination = args.output.parent / (args.output.stem + '_' + camera + '.json')
            preview = args.preview.with_name(args.preview.stem + '_' + camera + args.preview.suffix) if args.preview else None
            print(camera, flush=True)
            run(args.images / camera, args.model, destination, preview)
            reports[camera] = json.loads(destination.read_text(encoding='utf-8'))
        args.output.write_text(json.dumps({
            'model': 'SegFormer-B0 Cityscapes, six independent camera masks',
            'note': 'Synchronized image observations; not calibrated 3D fusion or temporal tracking',
            'textures': {camera: report['textures'] for camera, report in reports.items()},
            'moments': {camera: report['moments'] for camera, report in reports.items()},
        }, separators=(',', ':')), encoding='utf-8')
    else:
        run(args.images, args.model, args.output, args.preview)


if __name__ == "__main__":
    main()
