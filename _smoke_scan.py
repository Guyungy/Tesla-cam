from pathlib import Path

from tesla_cinema.application.open_clip import open_clip
from tesla_cinema.application.scan_folder import scan_folder
from tesla_cinema.domain.layout import camera_labels, cameras_for_view
from tesla_cinema.domain.timeline import segment_at, telemetry_at

folder = Path(r"E:\Github\Tesla-cam\_sample_TeslaCam")
clips = scan_folder(folder)
print(f"clips={len(clips)}")
for c in clips:
    event_reason = c.event.reason if c.event else None
    print(
        f"- name={c.name} type={c.type} videos={len(c.videos)} "
        f"location={c.location_text} event={event_reason}"
    )
    footage = open_clip(c)
    print(
        f"  duration={footage.duration:.2f}s segments={len(footage.segments)} "
        f"sei_points={len(footage.sei_data)}"
    )
    for s in footage.segments:
        print(
            f"  segment {s.name}: cams={list(s.cameras)} "
            f"dur={s.duration:.2f} start={s.start_seconds:.2f}"
        )
    mid = footage.duration / 2 if footage.duration else 0.0
    seg = segment_at(footage, mid)
    tel = telemetry_at(footage.sei_data, mid)
    print(f"  mid@{mid:.2f}s segment={seg.name if seg else None} "
          f"speed={tel.speed_kph if tel else None}")

print("scan/build OK")
print("labels", camera_labels())
print("grid4 cams", cameras_for_view("grid4"))
print("grid6 cams", cameras_for_view("grid6"))
