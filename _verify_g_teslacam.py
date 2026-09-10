"""Verify G:\\TeslaCam can be scanned and SEI interpreted correctly."""
from __future__ import annotations

from collections import Counter
from pathlib import Path

from tesla_cinema.application.open_clip import open_clip
from tesla_cinema.application.scan_folder import scan_folder
from tesla_cinema.domain.timeline import segment_at, telemetry_at
from tesla_cinema.services.scan import resolve_cam_name
from tesla_cinema.services.sei import convert_to_data_points, extract_sei_from_file

folder = Path(r"G:\TeslaCam")
clips = scan_folder(folder)
print(f"SCAN OK: {len(clips)} clips  types={dict(Counter(c.type for c in clips))}")

clip = next(c for c in clips if c.name == "2026-07-20_19-24-51")
footage = open_clip(clip)
print(
    f"\nOPEN saved {clip.name}: dur={footage.duration:.1f}s "
    f"segs={len(footage.segments)} sei={len(footage.sei_data)}"
)
assert clip.event is not None
print(
    f"  event: {clip.event.city}/{clip.event.street} "
    f"reason={clip.event.reason} lat={clip.event.est_lat},{clip.event.est_lon}"
)
assert len(footage.sei_data) > 1000, "expected rich SEI"

speeds = [p.speed_kph for p in footage.sei_data]
throttles = [p.throttle_pct for p in footage.sei_data]
steers = [p.steering_angle_deg for p in footage.sei_data]
print(
    f"  speed km/h min/max/avg = {min(speeds):.1f}/{max(speeds):.1f}/{sum(speeds)/len(speeds):.1f}"
)
print(
    f"  throttle% min/max/avg = {min(throttles):.1f}/{max(throttles):.1f}/{sum(throttles)/len(throttles):.1f}"
)
print(
    f"  steer deg min/max/avg = {min(steers):.1f}/{max(steers):.1f}/{sum(steers)/len(steers):.1f}"
)
assert max(throttles) <= 100.0 + 1e-6
# Steering wheel can multi-turn; real dump sees roughly ±360°.
assert max(abs(s) for s in steers) < 720
assert max(speeds) < 200 and max(speeds) > 10
assert min(speeds) >= -1.0  # allow tiny float noise around 0

for frac in (0.0, 0.3, 0.6, 0.9):
    t = footage.duration * frac
    pt = telemetry_at(footage.sei_data, t)
    seg = segment_at(footage, t)
    assert pt is not None and seg is not None
    print(
        f"  t={t:6.1f}s seg={seg.name} speed={pt.speed_kph:5.1f} "
        f"gear={pt.gear} steer={pt.steering_angle_deg:6.1f} thr={pt.throttle_pct:5.1f}%"
    )

front = next(v for v in clip.videos if resolve_cam_name(v.name) == "front")
raw = extract_sei_from_file(front)
pts = convert_to_data_points(raw, 0.0)
print(f"\nRAW front file: {len(raw)} msgs -> {len(pts)} points")
print(
    f"  raw speed m/s first={raw[0]['vehicleSpeedMps']:.3f} "
    f"-> {pts[0].speed_kph:.2f} km/h"
)
print(
    f"  raw pedal first={raw[0]['acceleratorPedalPosition']:.2f} "
    f"-> thr={pts[0].throttle_pct:.2f}%"
)
print(
    f"  raw steer first={raw[0]['steeringWheelAngle']:.2f} "
    f"-> {pts[0].steering_angle_deg:.2f} deg"
)
assert abs(pts[0].speed_kph - raw[0]["vehicleSpeedMps"] * 3.6) < 1e-3
assert abs(pts[0].steering_angle_deg - raw[0]["steeringWheelAngle"]) < 1e-3
assert abs(pts[0].throttle_pct - float(raw[0]["acceleratorPedalPosition"])) < 1e-3

sentry = next(c for c in clips if c.type == "sentry" and c.event)
sf = open_clip(sentry)
print(
    f"\nOPEN sentry {sentry.name}: dur={sf.duration:.1f}s "
    f"segs={len(sf.segments)} sei={len(sf.sei_data)} "
    f"cams={sorted(sf.segments[0].cameras)}"
)
assert sentry.event is not None
print(f"  event: {sentry.event.city}/{sentry.event.street} reason={sentry.event.reason}")
assert set(sf.segments[0].cameras) >= {"front", "back", "left", "right"}
assert len(sf.segments[0].cameras) == 6
print("  6-cam layout OK")

print("\nALL G:\\TeslaCam INTERPRET CHECKS PASSED")
