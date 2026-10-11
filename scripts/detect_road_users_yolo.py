"""Run an ONNX YOLO object detector over prepared six-camera TeslaCam frames."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

CAMERAS = ("front", "back", "left", "right", "left_pillar", "right_pillar")
CLASSES = {0: "person", 1: "bicycle", 2: "car", 3: "motorbike", 5: "bus", 7: "truck"}


def prepare(image: np.ndarray) -> tuple[np.ndarray, float, int, int]:
    height, width = image.shape[:2]
    scale = min(640 / width, 640 / height)
    new_width, new_height = round(width * scale), round(height * scale)
    left, top = (640 - new_width) // 2, (640 - new_height) // 2
    canvas = np.full((640, 640, 3), 114, dtype=np.uint8)
    canvas[top:top + new_height, left:left + new_width] = cv2.resize(
        image, (new_width, new_height), interpolation=cv2.INTER_LINEAR
    )
    blob = cv2.dnn.blobFromImage(canvas, 1 / 255, (640, 640), swapRB=True)
    return blob, scale, left, top


def detect(images: Path, model: Path, output: Path, frames: int,
           threshold: float, detail_crop: bool = False) -> None:
    session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    timeline = []
    totals: Counter[str] = Counter()
    for index in range(frames):
        moment = {}
        for camera in CAMERAS:
            image = cv2.imread(str(images / camera / f"frame_{index:06d}.jpg"))
            if image is None:
                moment[camera] = []
                continue
            height, width = image.shape[:2]
            found = []
            regions = [(0, 0, width, height)]
            if detail_crop:
                regions.append((int(.15*width), int(.2*height), int(.85*width), int(.85*height)))
            for rx1, ry1, rx2, ry2 in regions:
                blob, scale, left, top = prepare(image[ry1:ry2, rx1:rx2])
                predictions = session.run(None, {input_name: blob})[0].reshape(-1, 6)
                for x1, y1, x2, y2, score, category in predictions:
                    kind = CLASSES.get(int(category))
                    if kind is None or score < threshold:
                        continue
                    local = np.array([(x1-left)/scale, (y1-top)/scale,
                                      (x2-left)/scale, (y2-top)/scale])
                    if rx1 and (local[0] < 4 or local[1] < 4 or
                                local[2] > rx2-rx1-4 or local[3] > ry2-ry1-4):
                        continue  # Ignore objects truncated by the additional crop.
                    box = np.clip((local + [rx1, ry1, rx1, ry1]) / [width, height, width, height], 0, 1)
                    if (box[2]-box[0])*width < 12 or (box[3]-box[1])*height < 12:
                        continue
                    found.append({"kind": kind, "score": round(float(score), 3),
                                  "box": [round(float(value), 4) for value in box]})
            retained = []
            for item in sorted(found, key=lambda x: -x['score']):
                if any(overlap(item['box'], other['box']) > .5 and
                       (item['kind'] == other['kind'] or {item['kind'], other['kind']} <= {'car','bus','truck'})
                       for other in retained):
                    continue
                retained.append(item)
                totals[item['kind']] += 1
            found = retained
            moment[camera] = found
        timeline.append(moment)
        print(f"\rDetected {index + 1}/{frames} moments", end="", flush=True)
    print()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({
        "model": f"Ultralytics {model.stem} ONNX COCO",
        "detail_crop": detail_crop,
        "threshold": threshold,
        "notes": "2D boxes only; no measured depth, lanes, or cross-camera identity",
        "totals_by_camera_observation": dict(totals),
        "moments": timeline,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}: {dict(totals)}")


def overlap(a, b) -> float:
    intersection = max(0, min(a[2], b[2])-max(a[0], b[0])) * max(0, min(a[3], b[3])-max(a[1], b[1]))
    union = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - intersection
    return intersection / union if union > 0 else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=30)
    parser.add_argument("--threshold", type=float, default=.4)
    parser.add_argument("--detail-crop", action="store_true")
    args = parser.parse_args()
    if args.frames < 1 or not 0 < args.threshold < 1:
        parser.error("--frames must be positive and --threshold must be between 0 and 1")
    detect(args.images, args.model, args.output, args.frames, args.threshold, args.detail_crop)


if __name__ == "__main__":
    main()
