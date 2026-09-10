# Tesla Cinema

Tesla dashcam desktop app: multi-camera viewer, SEI telemetry, and strict FFmpeg export.

## Run

```powershell
python -m pip install -e .
python -m tesla_cinema
```

Optional local web shell (same application layer):

```powershell
python -c "from tesla_cinema.server import start_server; start_server()"
```

## Stack

- Python 3.11+
- PySide6 / Qt (primary UI)
- FFmpeg via `imageio-ffmpeg`
- `send2trash` for Recycle Bin support

## Architecture

Layered hex-style layout. Dependencies point **inward** only.

```
presentation (ui / server)
        │
        ▼
application  — use cases: scan_folder, open_clip, export_clip, delete_clip
        │                   + ports (Protocols)
        ▼
domain       — models, layout rules, timeline lookup (no I/O, no Qt)
        ▲
infrastructure (services) — TeslaCam FS scan, SEI parse, FFmpeg export, trash, settings
```

| Layer | Package | Responsibility |
|-------|---------|----------------|
| Domain | `tesla_cinema.domain` | `CamClip` / `CamFootage` / SEI types; `cameras_for_view`; `segment_at` / `telemetry_at` |
| Application | `tesla_cinema.application` | Orchestration; injectable ports for tests |
| Infrastructure | `tesla_cinema.services` | Disk, SEI binary, FFmpeg, QSettings, trash |
| Presentation | `tesla_cinema.ui`, `server.py` | Qt main window or thin HTTP API |

Use cases default to real services; pass fakes via `scanner=` / `builder=` / `exporter=` / `trash=` for unit tests.
