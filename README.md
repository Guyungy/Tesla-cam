# Tesla Cinema — TeslaCam Viewer

**English** · [简体中文](./README.zh-CN.md)

A modern desktop app for browsing Tesla DashCam footage: synchronized multi-camera
playback, real-time driving telemetry decoded from SEI metadata, GPS tracks, and
H.264 video export.

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](#download)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.0-orange)](https://github.com/Guyungy/Tesla-cam/releases)
[![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron&logoColor=white)](#tech-stack)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](#tech-stack)

![preview](./public/preview.png)

---

## Table of Contents

- [Download](#download)
- [Features](#features)
- [Compatibility](#compatibility)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Development](#development)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Disclaimer](#disclaimer)
- [License](#license)

---

## Download

**No development environment needed.** Download the installer for your platform
from [GitHub Releases](https://github.com/Guyungy/Tesla-cam/releases):

- **Windows** — `.exe` installer (NSIS)
- **macOS** — `.dmg` (Intel & Apple Silicon)
- **Linux** — `.AppImage` _(builds from source today; see [Roadmap](#roadmap))_

---

## Features

### Multi-Camera Synchronized Playback

Perfect frame-level sync across all cameras with multiple viewing modes:

| Layout        | Description                                    |
| ------------- | ---------------------------------------------- |
| **6 Grid**    | All 6 cameras in 3×2 grid (including B-pillar) |
| **4 Grid**    | Front / Back / Left / Right in 2×2 grid        |
| **4 Classic** | Front camera top (60%), three cameras bottom   |
| **Single**    | Any camera fullscreen — double-click to toggle |

Each grid cell shows a camera label (Front / Back / Left / Right / L-Pillar / R-Pillar)
for quick identification.

### B-Pillar Camera Support

Full coverage including Tesla's interior B-pillar cameras (`left_pillar` / `right_pillar`).
Automatically detected — the 6-grid layout appears only when B-pillar files are present.

### Real-Time Driving Dashboard

Auto-parses SEI metadata embedded in Tesla dashcam H.264 streams and displays a live
telemetry overlay:

- **Speed** — large gauge with color coding (green / yellow / red)
- **Gear** — P / R / N / D highlight
- **Steering angle** — SVG arc indicator with degree readout
- **Pedals** — throttle (green bar) and brake (red bar)
- **Autopilot status** — OFF / AP / FSD / TACC badge
- **GPS coordinates** — latitude / longitude

> **Note:** Vehicle metadata is only available in videos recorded with Tesla firmware
> **2025.44.25** or later on HW3+. SEI data may not be present while parked.

### Speed Curve in Progress Bar

Hover over the timeline to see a speed-over-time sparkline rendered in the progress bar
background. Instantly spot hard acceleration, braking, and cruising segments.

### Smart Filtering & Date Grouping

- Filter by type: **All / Recent / Sentry / Saved** — with live clip-count badges
- Search by date, location, or event reason
- Clips grouped by date: **Today / Yesterday / 2025-04-03...**
- **Real video thumbnails** — poster frames lazily extracted from the front camera as you scroll
- Event reason displayed on clip cards (e.g., "object detected")
- Sidebar width is resizable and remembered across sessions

### GPS Track Panel

A compact live track panel overlays the video: the clip's full driving path with a
playhead marker that moves as you scrub. Pure SVG rendered from SEI GPS samples —
fully offline, no map tiles. Collapsible with one click.

### Incident Intelligence

- **Hard-braking marks** — sharp speed drops with brake input are detected from SEI
  telemetry and flagged on the timeline as amber markers, so collisions and near-misses
  are one glance away
- **Auto-jump to event** — event clips open just before the recorded moment
  (AEB −3s, Sentry/Saved −5s) instead of at the start
- **Sentry camera focus** — Sentry clips open on the camera that triggered the alert
  (from `event.json`), falling back to the grid when unknown
- All three are toggleable in Settings

### Playback & Navigation

- **Auto-play next clip** when the current one ends (toggle in Settings)
- **↑ / ↓** — jump to the previous / next clip without touching the mouse
- **Delete** — triage flow: confirm, trash the clip, auto-advance to the next
- **Space** play/pause · **← / →** ±5s · **Shift+← / →** ±1s
- **, / .** — frame-by-frame stepping (pauses playback for precise scrubbing)
- **M** mute · **F** fullscreen · **P** picture-in-picture · **I / O** export in/out points
- Your last-used layout is remembered and restored for new clips

### H.264 Video Export

Export the current view (any layout) as an H.264 MP4 video powered by FFmpeg:

- **Fast path**: source files → `filter_complex` compose (multi-cam grid + overlays) — no canvas frame pipe
- **Hardware encoding**: NVENC / QuickSync / AMF auto-detected (toggle in Settings), with automatic libx264 fallback if the GPU encode fails
- **Fallback**: canvas RGBA stream when disk paths are unavailable
- Set **IN / OUT** points for precise clip trimming (visible as blue range on timeline)
- Overlay: **live-updating timestamp clock**, location, and time-windowed drive data (speed / gear / AP) sampled from real SEI telemetry — localized camera labels
- Unicode-safe overlay text (CJK, apostrophes, `%`) via drawtext textfiles
- Compose export supports up to **10 minutes**; legacy canvas path capped at 60s
- Export modal shows progress and estimated remaining time
- One-click screenshot export (JPEG)

### Driving Data CSV Export

Export complete driving telemetry to CSV for further analysis:

```
offset_s, speed_kph, gear, steering_deg, brake_pct, throttle_pct, ap_status, latitude, longitude
```

### Map Integration

- **Auto-detect region**: China coordinates → Amap (高德地图), otherwise → Google Maps
- Both map links shown simultaneously in the header
- Click to open the exact event location

### Bilingual UI (中文 / English)

Full Chinese and English support. Language auto-detected from browser settings,
switchable via Settings (gear icon in title bar). Timestamps, labels, and all UI text
follow the selected language.

---

## Compatibility

| Item              | Requirement                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| OS                | Windows 10+ · macOS 11+ · Linux (x64)                                            |
| Tesla footage     | Standard `TeslaCam` folder layout (`RecentClips` / `SentryClips` / `SavedClips`) |
| Telemetry overlay | Tesla firmware **2025.44.25+** on **HW3 / HW4**                                  |
| Video codec       | H.264 (HEVC sources are not yet decoded — see [Roadmap](#roadmap))               |

Footage **without** SEI telemetry still plays normally; only the dashboard, GPS track,
and telemetry-based features stay empty.

---

## Keyboard Shortcuts

| Control      | Action                                         |
| ------------ | ---------------------------------------------- |
| `Space`      | Play / Pause                                   |
| `← →`        | Seek ±5 seconds                                |
| `Shift+← →`  | Fine seek ±1 second                            |
| `,` / `.`    | Frame step backward / forward                  |
| `↑ ↓`        | Previous / next clip                           |
| `F`          | Toggle fullscreen                              |
| `P`          | Picture-in-Picture                             |
| `M`          | Mute / Unmute                                  |
| `I` / `O`    | Set IN / OUT export points                     |
| Double-click | Toggle single / grid view                      |
| Drag & Drop  | Drop a TeslaCam folder onto the window to load |

Playback speed: **0.25x – 8x**

---

## Development

### Prerequisites

- Node.js >= 20.12
- npm

### Setup

```bash
npm install
```

### Dev Server

```bash
npm run dev
```

### Build

```bash
# Windows
npm run build:win

# macOS
npm run build:mac
```

Output goes to the `release/` directory.

### Tech Stack

- **Electron 40** — desktop shell (`contextIsolation`, no `nodeIntegration`)
- **React 19** + **TypeScript 5.8**
- **Tailwind CSS 4** — styling
- **Vite 5** — build tool
- **FFmpeg** (bundled via ffmpeg-static) — filter_complex compose + H.264 encode
- **Custom SEI parser** — streaming MP4 NAL scan + Tesla protobuf (zero dependencies)
- **MP4 duration probe** — moov/mvhd box parse (parallel clip load, no per-file `<video>`)

### Optional Python tools

The `tesla_cinema/` package and `sei_extractor.py` are **optional helpers**
(SEI experiments / an alternate PySide6 viewer). The product app is Electron:

```powershell
python -m pip install -e .
python -m tesla_cinema   # Qt viewer (experimental)
```

---

## Testing

CI runs lint, type checks, a production build, and the Playwright suite on every push
(see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)). To reproduce locally:

```bash
npm run lint                                  # eslint
npx tsc -b --noEmit                           # renderer types
npx tsc -p tsconfig.electron.json --noEmit    # main-process types
npx vite build                                # production build
npx playwright test                           # full suite
```

Most tests are unit-level and always run. The footage-dependent specs
(`realDrive.spec.ts`, `composeExport.spec.ts`) need an actual TeslaCam drive and
**skip automatically** when none is mounted, which keeps CI green:

```bash
# Windows
TESLACAM_DIR='G:\TeslaCam' npx playwright test

# macOS / Linux
TESLACAM_DIR=/Volumes/TeslaCam npx playwright test
```

> The `_sample_TeslaCam/` folder in this repo is a tiny **re-encoded** fixture used for
> UI tests only — its SEI stream carries the x264 encoder string, not Tesla telemetry,
> so telemetry extraction specs stay skipped against it.

---

## Project Structure

```
electron/          Electron main process (window, IPC, export, trash)
src/
  app/             App shell, routing, home & start screens
  components/      UI components
    viewer/        Player, layouts, dashboard, timeline, GPS track
  i18n/            Localization (en, zh-CN) + language context
  plugins/         Playback extensions
  utils/           SEI parser, clip generation, export, MP4 probing
scripts/           Dev/QA helper scripts (SEI coverage, sync verify, export probe)
tests/             Playwright specs — unit + real-drive (auto-skipping)
tesla_cinema/      Optional Python/PySide6 experiments
sei_explorer.html  Standalone SEI inspection page
```

---

## Roadmap

Tracks are in rough priority order. Nothing here is a release commitment — it is a
living list, and [issues / PRs](#contributing) that move any item forward are welcome.

### 🔜 Next up

- [ ] **Ship the Linux build** — `electron-builder` already targets AppImage; add it to
      the release pipeline and document it as a supported download
- [ ] **Real-footage end-to-end coverage** — the SEI telemetry and multi-segment event
      specs are written but skip without a real drive; add a recorded, redistributable
      fixture so they run in CI
- [ ] **Publish a proper changelog** — keep `CHANGELOG.md` in step with tagged releases

### 🗺️ Planned

- [ ] **More UI languages** — the `src/i18n/locales.ts` structure already supports
      additional locales; add Japanese, Korean, German and French
- [ ] **HEVC / H.265 source support** — newer Tesla footage is H.265; decode and export
      it alongside the current H.264 path
- [ ] **Embedded map view** — today the header links out to Amap / Google Maps; render
      the GPS track over real map tiles in-app
- [ ] **Trip & mileage summary** — aggregate SEI speed/GPS samples per clip or per day
      into distance, duration, and driving-style stats
- [ ] **Batch export** — queue multiple clips and export them unattended

### 💡 Exploring

- [ ] **Keep up with new firmware** — track SEI schema changes on newer Tesla firmware
      and HW4 so telemetry never silently stops decoding
- [ ] **Customizable shortcuts & command palette** — let users rebind keys and jump to
      actions by name
- [ ] **Virtualized clip list** — keep the sidebar smooth with tens of thousands of files
- [ ] **Overlay presets** — save and reuse export overlay styles (clock position, data
      fields, branding)

Have an idea that is not listed? Open an issue — the wishlist is community-driven.

---

## Contributing

Contributions of all sizes are welcome — bug reports, footage samples, translations,
and pull requests alike.

1. **Open an issue first** for anything larger than a small fix, so we can agree on the
   approach before you invest time.
2. **Fork, branch, and keep changes focused** — one concern per PR.
3. **Match the existing style.** The repo is formatted with Prettier and linted with
   ESLint; run these before pushing:

   ```bash
   npm run format
   npm run lint
   npx tsc -b --noEmit && npx tsc -p tsconfig.electron.json --noEmit
   npx vite build
   npx playwright test
   ```

4. **Describe your testing.** Say what you ran and, for telemetry work, which firmware
   version and hardware your footage came from.
5. **Never commit personal footage or locations.** Blur or trim GPS-bearing clips before
   attaching them to an issue.

CI must be green for a PR to be merged.

---

## Disclaimer

This is an **unofficial, community-built** project. It is not affiliated with,
endorsed by, or sponsored by Tesla, Inc. "Tesla" and "TeslaCam" are trademarks of
Tesla, Inc., used here only to describe what the app reads.

The app works entirely **offline and locally** — footage is never uploaded, and no
account is required. It only reads files from the drive you point it at; the delete
action moves clips to the OS trash, not permanent deletion.

---

## License

[GPL-3.0](./LICENSE) © the Tesla Cinema contributors.

This program is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License, version 3, as published by the Free Software
Foundation.

It is distributed in the hope that it will be useful, but **without any warranty**;
without even the implied warranty of merchantability or fitness for a particular
purpose. See the [LICENSE](./LICENSE) file for the full text.
