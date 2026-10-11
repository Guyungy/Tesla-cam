"""Summarize geometrically verified COLMAP matches by TeslaCam camera pair."""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

MAX_IMAGE_ID = 2147483647


def analyze(database: Path) -> dict:
    with sqlite3.connect(database) as connection:
        images = {image_id: name for image_id, name in connection.execute(
            "SELECT image_id, name FROM images"
        )}
        stats = defaultdict(lambda: {"pairs": 0, "verified_points": 0,
                                     "same_time_pairs": 0, "same_time_points": 0})
        for pair_id, rows in connection.execute(
            "SELECT pair_id, rows FROM two_view_geometries WHERE rows > 0"
        ):
            first_id, second_id = divmod(pair_id, MAX_IMAGE_ID)
            first, second = images[first_id], images[second_id]
            first_camera, second_camera = first.split("/", 1)[0], second.split("/", 1)[0]
            key = "+".join(sorted((first_camera, second_camera)))
            item = stats[key]
            item["pairs"] += 1
            item["verified_points"] += rows
            if first.split("/", 1)[1] == second.split("/", 1)[1]:
                item["same_time_pairs"] += 1
                item["same_time_points"] += rows
    cameras = sorted({name.split("/", 1)[0] for name in images.values()})
    edges = []
    for key, item in stats.items():
        left, right = key.split("+")
        if left != right and item["same_time_pairs"] >= 3 and item["same_time_points"] >= 100:
            edges.append((left, right))
    remaining = set(cameras)
    components = []
    while remaining:
        component = {min(remaining)}
        while True:
            extended = component | {
                other for left, right in edges for node, other in ((left, right), (right, left))
                if node in component
            }
            if extended == component:
                break
            component = extended
        components.append(sorted(component))
        remaining -= component
    return {"images": len(images), "camera_pairs": dict(sorted(stats.items())),
            "strong_same_time_edges": sorted(["+".join(pair) for pair in edges]),
            "camera_components": components}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = analyze(args.database)
    serialized = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized + "\n", encoding="utf-8")
    print(serialized)


if __name__ == "__main__":
    main()
