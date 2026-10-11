"""Detect vehicles and pedestrians in prepared six-camera TeslaCam frames.

Uses the MIT-licensed MobileNet-SSD VOC model from chuanqi305/MobileNet-SSD.
OpenCV 4.x is required because OpenCV 5 removed the Caffe importer.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

CAMERAS = ("front", "back", "left", "right", "left_pillar", "right_pillar")
CLASSES = {2: "bicycle", 6: "bus", 7: "car", 14: "motorbike", 15: "person"}


def detect(images: Path, config: Path, model: Path, output: Path,
           frames: int, threshold: float, opencv_dir: Path | None) -> None:
    if opencv_dir:
        sys.path.insert(0, str(opencv_dir.resolve()))
    import cv2

    if not hasattr(cv2.dnn, "readNetFromCaffe"):
        raise RuntimeError("OpenCV 4.x with Caffe importer is required")
    network = cv2.dnn.readNetFromCaffe(str(config), str(model))
    network.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
    network.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
    timeline = []
    totals: Counter[str] = Counter()
    for index in range(frames):
        moment = {}
        for camera in CAMERAS:
            source = images / camera / f"frame_{index:06d}.jpg"
            frame = cv2.imread(str(source))
            if frame is None:
                moment[camera] = []
                continue
            network.setInput(cv2.dnn.blobFromImage(frame, 0.007843,
                                                    (300, 300), 127.5))
            raw = network.forward().reshape(-1, 7)
            found = []
            for row in raw:
                category = CLASSES.get(int(row[1]))
                confidence = float(row[2])
                if category is None or confidence < threshold:
                    continue
                box = np.clip(row[3:7], 0, 1).astype(float).tolist()
                if box[2] - box[0] < 0.025 or box[3] - box[1] < 0.025:
                    continue
                found.append({"kind": category, "score": round(confidence, 3),
                              "box": [round(value, 4) for value in box]})
                totals[category] += 1
            moment[camera] = found
        timeline.append(moment)
        print(f"\rDetected {index + 1}/{frames} moments", end="", flush=True)
    print()
    report = {
        "model": "chuanqi305/MobileNet-SSD VOC0712",
        "threshold": threshold,
        "notes": "2D detections only; depth and cross-camera identity are not measured",
        "totals_by_camera_observation": dict(totals),
        "moments": timeline,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}: {dict(totals)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=20)
    parser.add_argument("--threshold", type=float, default=0.45)
    parser.add_argument("--opencv-dir", type=Path)
    args = parser.parse_args()
    if args.frames < 1 or not 0 < args.threshold < 1:
        parser.error("--frames must be positive and --threshold must be between 0 and 1")
    detect(args.images, args.config, args.model, args.output,
           args.frames, args.threshold, args.opencv_dir)


if __name__ == "__main__":
    main()
