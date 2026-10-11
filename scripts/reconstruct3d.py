"""Prepare synchronized TeslaCam frames and optionally reconstruct a 3D point cloud.

Run ``python scripts/reconstruct3d.py --help`` for usage. Source videos are read
only; all generated data goes into a new output directory.
"""

from __future__ import annotations

import argparse
import bisect
import json
import math
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tesla_cinema.services.sei import convert_to_data_points, extract_sei_from_file

CAMERAS = (
    "front", "back", "left", "right", "left_pillar", "right_pillar"
)
SUFFIXES = {
    "front": "front", "back": "back", "left": "left_repeater",
    "right": "right_repeater", "left_pillar": "left_pillar",
    "right_pillar": "right_pillar",
}
APPROX_RIG = {
    "front": (0, (0.0, 0.0, 0.0)),
    "back": (180, (0.0, 0.0, -3.0)),
    "left": (-120, (-0.9, 0.0, -0.5)),
    "right": (120, (0.9, 0.0, -0.5)),
    "left_pillar": (-65, (-0.8, 0.0, -1.3)),
    "right_pillar": (65, (0.8, 0.0, -1.3)),
}
VIDEO_NAME = re.compile(r"^(\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d)-(.+)\.mp4$", re.I)


@dataclass
class Segment:
    name: str
    start: float
    duration: float
    cameras: dict[str, Path]


def executable(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    if name == "ffmpeg":
        bundled = ROOT / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"
        if bundled.is_file():
            return str(bundled)
    raise RuntimeError(f"{name} is required but was not found on PATH")


def probe_duration(ffprobe: str, path: Path) -> float:
    result = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    duration = float(result.stdout.strip())
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError(f"Invalid duration: {path}")
    return duration


def find_segments(source: Path, ffprobe: str) -> list[Segment]:
    grouped: dict[str, dict[str, Path]] = {}
    for path in source.glob("*.mp4"):
        match = VIDEO_NAME.fullmatch(path.name)
        if not match:
            continue
        for camera, suffix in SUFFIXES.items():
            if match.group(2).lower() == suffix:
                grouped.setdefault(match.group(1), {})[camera] = path
                break
    if not grouped:
        raise ValueError(f"No TeslaCam camera videos found in {source}")
    segments = []
    start = 0.0
    for name, cameras in sorted(grouped.items()):
        reference = cameras.get("front", next(iter(cameras.values())))
        duration = probe_duration(ffprobe, reference)
        segments.append(Segment(name, start, duration, cameras))
        start += duration
    return segments


def gps_samples(segments: list[Segment]) -> tuple[list[float], list[dict]]:
    samples = []
    for segment in segments:
        front = segment.cameras.get("front")
        if not front:
            continue
        try:
            points = convert_to_data_points(
                extract_sei_from_file(front), segment.start, segment.duration
            )
        except (OSError, ValueError):
            continue
        for point in points:
            if -90 <= point.latitude <= 90 and -180 <= point.longitude <= 180:
                if point.latitude != 0 or point.longitude != 0:
                    samples.append(asdict(point))
    samples.sort(key=lambda sample: sample["offset_seconds"])
    return [sample["offset_seconds"] for sample in samples], samples


def nearest_gps(times: list[float], samples: list[dict], second: float) -> dict | None:
    if not times:
        return None
    at = bisect.bisect_left(times, second)
    indexes = [index for index in (at - 1, at) if 0 <= index < len(times)]
    index = min(indexes, key=lambda candidate: abs(times[candidate] - second))
    if abs(times[index] - second) > 2.0:
        return None
    return {
        "latitude": samples[index]["latitude"],
        "longitude": samples[index]["longitude"],
        "speed_kph": samples[index]["speed_kph"],
        "sample_offset_seconds": times[index],
    }


def prepare(args: argparse.Namespace, ffmpeg: str, ffprobe: str) -> Path:
    segments = find_segments(args.input, ffprobe)
    total = segments[-1].start + segments[-1].duration
    if args.start >= total:
        raise ValueError(f"Start time {args.start}s exceeds clip duration {total:.1f}s")
    end = min(total, args.start + args.duration)
    frame_count = math.ceil((end - args.start) * args.fps)
    if frame_count > args.max_frames:
        raise ValueError(f"Would extract {frame_count} timestamps; raise --max-frames explicitly")
    if args.output.exists() and any(args.output.iterdir()):
        raise FileExistsError(f"Output is not empty: {args.output}")
    images = args.output / "images"
    images.mkdir(parents=True, exist_ok=True)
    gps_times, gps = gps_samples(segments)
    manifest = {"source": str(args.input), "fps": args.fps, "frames": [],
                "notes": "GPS is approximate and is not used as a calibrated camera pose."}
    missing = 0
    for index in range(frame_count):
        second = args.start + index / args.fps
        segment = next((item for item in segments
                        if item.start <= second < item.start + item.duration), None)
        if segment is None:
            continue
        local_second = second - segment.start
        image_name = f"frame_{index:06d}.jpg"
        exported = []
        for camera in args.cameras:
            video = segment.cameras.get(camera)
            if not video:
                missing += 1
                continue
            target_dir = images / camera
            target_dir.mkdir(exist_ok=True)
            target = target_dir / image_name
            command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
                       "-ss", f"{local_second:.6f}", "-i", str(video),
                       "-frames:v", "1", "-q:v", "2", "-y", str(target)]
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode == 0 and target.is_file() and target.stat().st_size > 0:
                exported.append(camera)
            else:
                missing += 1
                target.unlink(missing_ok=True)
        manifest["frames"].append({"offset_seconds": round(second, 6),
                                   "segment": segment.name, "image": image_name,
                                   "cameras": exported,
                                   "gps": nearest_gps(gps_times, gps, second)})
        print(f"\rExtracted {index + 1}/{frame_count} timestamps", end="", flush=True)
    print()
    manifest["missing_camera_frames"] = missing
    (args.output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Prepared {sum(len(frame['cameras']) for frame in manifest['frames'])} images in {images}")
    if not any(frame["cameras"] for frame in manifest["frames"]):
        raise RuntimeError("No frames could be extracted")
    return images


def write_gps_references(output: Path) -> Path | None:
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    references = []
    positions = set()
    for frame in manifest["frames"]:
        gps = frame.get("gps")
        if not gps or "front" not in frame["cameras"]:
            continue
        lat, lon = gps["latitude"], gps["longitude"]
        positions.add((round(lat, 6), round(lon, 6)))
        references.append(f"front/{frame['image']} {lat:.9f} {lon:.9f} 0")
    if len(references) < 3 or len(positions) < 3:
        return None
    target = output / "gps_references.txt"
    target.write_text("\n".join(references) + "\n", encoding="utf-8")
    return target


def best_sparse_model(colmap: str, sparse: Path) -> tuple[Path, int, int] | None:
    candidates = []
    for model in sparse.iterdir():
        if not model.is_dir():
            continue
        result = subprocess.run(
            [colmap, "model_analyzer", "--path", str(model)],
            capture_output=True, text=True,
        )
        if result.returncode:
            continue
        report = result.stdout + result.stderr
        registered = re.search(r"Registered images:\s*(\d+)", report)
        points = re.search(r"Points:\s*(\d+)", report)
        if registered and points:
            candidates.append((int(registered.group(1)), int(points.group(1)), model))
    if not candidates:
        return None
    registered, points, model = max(candidates)
    return model, registered, points


def write_approx_rig_config(images: Path, output: Path) -> Path:
    cameras = [name for name in CAMERAS if (images / name).is_dir()]
    if "front" not in cameras or len(cameras) < 2:
        raise ValueError("Approximate rig requires front and at least one other camera")
    config = []
    for name in cameras:
        angle, center = APPROX_RIG[name]
        if name == "front":
            config.append({"image_prefix": "front/", "ref_sensor": True})
            continue
        theta = math.radians(-angle)
        cosine, sine = math.cos(theta), math.sin(theta)
        x, y, z = center
        config.append({
            "image_prefix": f"{name}/",
            "cam_from_rig_rotation": [math.cos(theta / 2), 0, math.sin(theta / 2), 0],
            "cam_from_rig_translation": [-(cosine*x + sine*z), -y,
                                         -(-sine*x + cosine*z)],
        })
    target = output / "rig_config_approx.json"
    target.write_text(json.dumps([{"cameras": config}], indent=2), encoding="utf-8")
    return target


def run_colmap(args: argparse.Namespace, images: Path, colmap: str) -> None:
    database = args.output / ("database_approx_rig.db" if args.approx_rig else "database.db")
    sparse = args.output / ("sparse_approx_rig" if args.approx_rig else "sparse")
    sparse.mkdir(exist_ok=True)
    selected = best_sparse_model(colmap, sparse)
    if selected is None:
        steps = [[colmap, "feature_extractor", "--database_path", str(database),
                  "--image_path", str(images), "--ImageReader.single_camera_per_folder", "1",
                  "--ImageReader.camera_model", args.camera_model]]
        if args.approx_rig:
            config = write_approx_rig_config(images, args.output)
            steps.append([colmap, "rig_configurator", "--database_path", str(database),
                          "--rig_config_path", str(config)])
        steps.extend([
            [colmap, "exhaustive_matcher", "--database_path", str(database)],
            [colmap, "mapper", "--database_path", str(database),
             "--image_path", str(images), "--output_path", str(sparse),
             *(["--Mapper.ba_refine_sensor_from_rig", "0"] if args.approx_rig else [])],
        ])
        for step in steps:
            print("Running:", " ".join(step[:2]))
            subprocess.run(step, check=True)
    selected = best_sparse_model(colmap, sparse)
    if selected is None:
        raise RuntimeError("COLMAP registered no sparse model; try a longer moving clip")
    model, registered, points = selected
    print(f"Best sparse model: {model} ({registered} images, {points} points)")
    sparse_ply = args.output / ("sparse_approx_rig_best.ply" if args.approx_rig else "sparse_best.ply")
    subprocess.run(
        [colmap, "model_converter", "--input_path", str(model),
         "--output_path", str(sparse_ply), "--output_type", "PLY"],
        check=True,
    )
    print(f"Sparse point cloud: {sparse_ply}")
    if args.approx_rig:
        print("Rig poses are approximate; this model is for visual demonstration, not measurement")
    if args.geo_align:
        references = write_gps_references(args.output)
        if references:
            geo_model = args.output / "sparse_geo"
            geo_model.mkdir(exist_ok=True)
            command = [colmap, "model_aligner", "--input_path", str(model),
                       "--output_path", str(geo_model), "--ref_images_path", str(references),
                       "--ref_is_gps", "1", "--alignment_type", "enu",
                       "--alignment_max_error", "10.0"]
            print("Running: colmap model_aligner")
            subprocess.run(command, check=True)
            model = geo_model
            print(f"GPS-aligned sparse model: {model}")
        else:
            print("GPS alignment skipped: fewer than 3 distinct front-camera positions")
    if not args.dense:
        return
    version = subprocess.run([colmap, "help"], capture_output=True, text=True)
    if "without GPU support" in (version.stdout + version.stderr):
        raise RuntimeError("Dense stereo requires a CUDA-enabled COLMAP build; sparse_best.ply is available")
    dense = args.output / ("dense_approx_rig" if args.approx_rig else "dense")
    for step in (
        [colmap, "image_undistorter", "--image_path", str(images),
         "--input_path", str(model), "--output_path", str(dense),
         "--output_type", "COLMAP", "--max_image_size", "2000"],
        [colmap, "patch_match_stereo", "--workspace_path", str(dense),
         "--workspace_format", "COLMAP", "--PatchMatchStereo.geom_consistency", "true"],
        [colmap, "stereo_fusion", "--workspace_path", str(dense),
         "--workspace_format", "COLMAP", "--input_type", "geometric",
         "--output_path", str(dense / "fused.ply")],
    ):
        print("Running:", " ".join(step[:2]))
        subprocess.run(step, check=True)
    print(f"Dense point cloud: {dense / 'fused.ply'}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path,
                        help="Folder containing one clip's TeslaCam MP4 segments")
    parser.add_argument("--output", type=Path, required=True,
                        help="New empty directory for extracted images and COLMAP output")
    parser.add_argument("--start", type=float, default=0.0, help="Start offset in seconds")
    parser.add_argument("--duration", type=float, default=30.0, help="Seconds to process")
    parser.add_argument("--fps", type=float, default=1.0, help="Samples per second")
    parser.add_argument("--max-frames", type=int, default=300)
    parser.add_argument("--cameras", nargs="+", choices=CAMERAS, default=list(CAMERAS))
    parser.add_argument("--run-colmap", action="store_true", help="Build sparse 3D model")
    parser.add_argument("--reconstruct-only", action="store_true",
                        help="Run COLMAP on an existing prepared output directory")
    parser.add_argument("--dense", action="store_true", help="Also build dense PLY cloud")
    parser.add_argument("--geo-align", action="store_true",
                        help="Align a successful sparse model using moving GPS samples")
    parser.add_argument("--approx-rig", action="store_true",
                        help="Use approximate six-camera poses for a visual joint model")
    parser.add_argument("--camera-model", default="SIMPLE_RADIAL",
                        help="COLMAP camera model; use fisheye only with calibrated focal lengths")
    args = parser.parse_args()
    if args.start < 0 or args.duration <= 0 or args.fps <= 0 or args.max_frames < 1:
        parser.error("Start must be nonnegative; duration, fps, and max-frames must be positive")
    if args.dense and not args.run_colmap:
        parser.error("--dense requires --run-colmap")
    if args.geo_align and not args.run_colmap:
        parser.error("--geo-align requires --run-colmap")
    if args.reconstruct_only and not args.run_colmap:
        parser.error("--reconstruct-only requires --run-colmap")
    args.output = args.output.resolve()
    if not args.reconstruct_only:
        if args.input is None:
            parser.error("--input is required when extracting frames")
        args.input = args.input.resolve()
        if not args.input.is_dir():
            parser.error(f"Input folder not found: {args.input}")
        if args.output == args.input or args.input in args.output.parents:
            parser.error("Output directory must be outside the source video folder")
    colmap = executable("colmap") if args.run_colmap else ""
    if args.reconstruct_only:
        images = args.output / "images"
        if not images.is_dir() or not (args.output / "manifest.json").is_file():
            parser.error("Prepared images and manifest.json are required")
    else:
        ffmpeg, ffprobe = executable("ffmpeg"), executable("ffprobe")
        images = prepare(args, ffmpeg, ffprobe)
    if args.run_colmap:
        run_colmap(args, images, colmap)
    else:
        print("Install COLMAP and use --run-colmap --reconstruct-only for 3D.")


if __name__ == "__main__":
    main()
