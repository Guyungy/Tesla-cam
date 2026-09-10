from __future__ import annotations

import math
from pathlib import Path

from PySide6.QtCore import QEvent, QObject, QSize, QThread, QTimer, Qt, QUrl, Signal
from PySide6.QtGui import QColor, QPainter, QPainterPath, QPen
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget
from PySide6.QtWidgets import (
    QComboBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from tesla_cinema.application.delete_clip import delete_clip
from tesla_cinema.application.export_clip import build_export_job
from tesla_cinema.application.open_clip import load_clip_sei, open_clip
from tesla_cinema.application.scan_folder import scan_folder
from tesla_cinema.domain.layout import camera_labels, cameras_for_view
from tesla_cinema.domain.models import ALL_CAMS, CamClip, CamFootage, CamName, ClipType, ViewType
from tesla_cinema.domain.timeline import segment_at, telemetry_at
from tesla_cinema.services.exporter import run_strict_export
from tesla_cinema.services.scan import wall_clock_text
from tesla_cinema.services.settings import SettingsStore


def _fmt_sec(sec: float) -> str:
    s = int(sec)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


_VIEW_LABELS: list[tuple[ViewType, str]] = [
    ("grid4", "四镜 2×2"),
    ("grid6", "六镜 3×2"),
    ("grid4old", "老款四镜"),
    ("front", "前摄"),
    ("back", "后摄"),
    ("left", "左摄"),
    ("right", "右摄"),
    ("left_pillar", "左柱"),
    ("right_pillar", "右柱"),
]

_TYPE_BADGE: dict[ClipType, tuple[str, str]] = {
    "sentry": ("哨兵", "#f59e0b"),
    "saved": ("保存", "#71717a"),
    "recent": ("最近", "#e82127"),
}

GLOBAL_STYLE = """
QMainWindow, QWidget#central_root {
    background-color: #09090b;
}

QWidget {
    font-family: "Segoe UI Variable", "Segoe UI", "Inter", sans-serif;
    color: #e4e4e7;
    font-size: 12px;
}

/* ---- Sidebar ---- */
QWidget#left_wrap {
    background-color: #0c0c0f;
    border-right: 1px solid #3f3f46;
    min-width: 280px;
}

QLabel#sidebar_title {
    font-size: 11px;
    font-weight: 700;
    color: #a1a1aa;
    letter-spacing: 3px;
    padding: 2px 0 8px 0;
}

QLabel#section_label {
    color: #52525b;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 8px 2px 2px 2px;
}

QPushButton {
    background-color: transparent;
    color: #d4d4d8;
    border: 1px solid #27272a;
    border-radius: 5px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 500;
}

QPushButton:hover {
    background-color: #18181b;
    color: #fafafa;
    border-color: #3f3f46;
}

QPushButton:pressed {
    background-color: #09090b;
}

QPushButton:disabled {
    color: #3f3f46;
    border-color: #1c1c1f;
    background: transparent;
}

QPushButton#folder_btn {
    background: #e82127;
    color: #ffffff;
    border: none;
    padding: 8px 10px;
    font-weight: 600;
}

QPushButton#folder_btn:hover { background: #f43f46; }
QPushButton#folder_btn:pressed { background: #b91c1c; }

QPushButton#export_btn {
    background: #e82127;
    color: #ffffff;
    border: none;
    padding: 6px 14px;
    font-weight: 600;
    min-width: 88px;
}
QPushButton#export_btn:hover { background: #f43f46; }

QPushButton#delete_btn {
    color: #a1a1aa;
    border: none;
    background: transparent;
    padding: 6px 10px;
}
QPushButton#delete_btn:hover {
    color: #f87171;
    background: #1c1012;
}

QPushButton#play_btn {
    min-width: 40px;
    max-width: 40px;
    min-height: 40px;
    max-height: 40px;
    border-radius: 20px;
    background: #e82127;
    color: #fff;
    border: none;
    font-size: 14px;
    padding: 0;
}
QPushButton#play_btn:hover { background: #f43f46; }
QPushButton#play_btn:disabled { background: #27272a; color: #52525b; }

QPushButton#transport_btn {
    min-width: 36px;
    max-width: 48px;
    min-height: 32px;
    border: none;
    background: transparent;
    color: #a1a1aa;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 6px;
}
QPushButton#transport_btn:hover {
    color: #fafafa;
    background: #18181b;
    border-radius: 6px;
}

QPushButton#ghost_btn {
    border: none;
    background: transparent;
    color: #71717a;
    font-size: 11px;
    padding: 4px 8px;
}
QPushButton#ghost_btn:hover {
    color: #e4e4e7;
    background: #18181b;
    border-radius: 4px;
}

QComboBox {
    background-color: #111114;
    color: #d4d4d8;
    border: 1px solid #27272a;
    border-radius: 5px;
    padding: 5px 8px;
    font-size: 12px;
    min-width: 88px;
}
QComboBox:hover { border-color: #3f3f46; }
QComboBox::drop-down { border: none; width: 18px; }
QComboBox::down-arrow {
    image: none;
    border-left: 3px solid transparent;
    border-right: 3px solid transparent;
    border-top: 4px solid #71717a;
}
QComboBox QAbstractItemView {
    background-color: #111114;
    color: #e4e4e7;
    border: 1px solid #27272a;
    selection-background-color: #27272a;
    selection-color: #fafafa;
    outline: 0;
}

QLineEdit {
    background-color: #111114;
    color: #e4e4e7;
    border: 1px solid #27272a;
    border-radius: 5px;
    padding: 6px 8px;
    font-size: 12px;
    selection-background-color: #e82127;
}
QLineEdit:focus { border-color: #52525b; }

QListWidget#clip_list {
    background-color: #0a0a0d;
    border: 1px solid #27272a;
    border-radius: 6px;
    outline: 0;
    padding: 4px;
}
QListWidget#clip_list::item {
    background: transparent;
    border: none;
    padding: 2px 0;
    margin: 1px 0;
    min-height: 52px;
}
QListWidget#clip_list::item:selected {
    background: transparent;
}

QScrollBar:vertical {
    background: transparent;
    width: 8px;
    margin: 0;
}
QScrollBar::handle:vertical {
    background: #27272a;
    border-radius: 4px;
    min-height: 24px;
}
QScrollBar::handle:vertical:hover { background: #3f3f46; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical,
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {
    height: 0; background: none;
}

QLabel#sidebar_status {
    color: #52525b;
    font-size: 11px;
    padding: 4px 2px;
}

QWidget#player_bar {
    background-color: #0c0c0f;
    border-top: 1px solid #18181b;
}

QWidget#top_bar_wrap {
    background-color: #09090b;
    border-bottom: 1px solid #18181b;
}

QWidget#hud_overlay {
    background-color: qlineargradient(x1:0, y1:0, x2:0, y2:1,
        stop:0 rgba(9,9,11,0.82), stop:1 rgba(9,9,11,0.0));
    border: none;
}

QLabel#hud_info {
    font-size: 12px;
    font-weight: 600;
    color: #fafafa;
}
QLabel#hud_meta {
    font-size: 11px;
    color: #a1a1aa;
}
QLabel#hud_event {
    font-size: 11px;
    font-weight: 600;
    color: #fca5a5;
}

QWidget#gps_wrap {
    background-color: transparent;
    border: none;
    border-top: 1px solid #18181b;
    border-radius: 0;
}
QLabel#gps_title {
    color: #52525b;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.2px;
}

QLabel#trim_label {
    color: #71717a;
    font-size: 11px;
    font-weight: 500;
}
QLabel#trim_dur {
    color: #e4e4e7;
    font-size: 11px;
    font-weight: 600;
}
QLabel#time_now {
    color: #a1a1aa;
    font-size: 11px;
    font-weight: 500;
    min-width: 88px;
}
"""


# ---------------------------------------------------------------------------
# Background workers (never block the UI thread on disk / FFmpeg)
# ---------------------------------------------------------------------------


class _ExportWorker(QObject):
    finished = Signal()
    error = Signal(str)

    def __init__(
        self,
        clip: CamClip,
        footage: CamFootage,
        view_type: ViewType,
        output_path: Path,
        *,
        export_start_seconds: float,
        export_duration_seconds: float,
        show_location: bool,
        show_drive_data: bool,
    ) -> None:
        super().__init__()
        self._clip = clip
        self._footage = footage
        self._view_type = view_type
        self._output_path = output_path
        self._export_start_seconds = export_start_seconds
        self._export_duration_seconds = export_duration_seconds
        self._show_location = show_location
        self._show_drive_data = show_drive_data

    def run(self) -> None:
        try:
            # Pull SEI here (background) only if export needs drive gauges.
            if self._show_drive_data and not self._footage.sei_data:
                points = load_clip_sei(self._clip, self._footage.segments)
                self._footage.sei_data = list(points)
            request = build_export_job(
                self._clip,
                self._footage,
                self._view_type,
                export_start_seconds=self._export_start_seconds,
                export_duration_seconds=self._export_duration_seconds,
                location_text=self._clip.location_text,
                show_location=self._show_location,
                show_drive_data=self._show_drive_data,
            )
            run_strict_export(request, self._output_path)
            self.finished.emit()
        except Exception as exc:
            self.error.emit(str(exc))


class _ScanWorker(QObject):
    finished = Signal(object)  # list[CamClip]
    error = Signal(str)

    def __init__(self, folder: Path) -> None:
        super().__init__()
        self._folder = folder

    def run(self) -> None:
        try:
            clips = scan_folder(self._folder, include_recent=False)
            self.finished.emit(clips)
        except Exception as exc:
            self.error.emit(str(exc))


class _OpenClipWorker(QObject):
    """Timeline-only open (no SEI, no media) — stays off the UI thread."""

    finished = Signal(object, object)  # clip, footage
    error = Signal(object, str)  # clip, message

    def __init__(self, clip: CamClip) -> None:
        super().__init__()
        self._clip = clip

    def run(self) -> None:
        try:
            footage = open_clip(self._clip, include_sei=False)
            self.finished.emit(self._clip, footage)
        except Exception as exc:
            self.error.emit(self._clip, str(exc))


class _SeiWorker(QObject):
    """Heavy SEI parse — applied after video is already playing."""

    finished = Signal(object, object)  # clip, sei_data list
    error = Signal(object, str)

    def __init__(self, clip: CamClip, footage: CamFootage) -> None:
        super().__init__()
        self._clip = clip
        self._footage = footage

    def run(self) -> None:
        try:
            points = load_clip_sei(self._clip, self._footage.segments)
            self.finished.emit(self._clip, points)
        except Exception as exc:
            self.error.emit(self._clip, str(exc))


# ---------------------------------------------------------------------------
# GPS map widget
# ---------------------------------------------------------------------------


class GPSMapWidget(QWidget):
    """Renders the GPS route from SEI telemetry using QPainter."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setMinimumSize(120, 100)
        self._route: list[tuple[float, float]] = []
        self._current_pos: tuple[float, float] | None = None
        self._lat_min = self._lat_max = self._lon_min = self._lon_max = 0.0
        self._cos_lat = 1.0

    def set_route(self, coords: list[tuple[float, float]]) -> None:
        self._route = [(lat, lon) for lat, lon in coords if lat != 0.0 or lon != 0.0]
        self._current_pos = None
        if self._route:
            lats = [c[0] for c in self._route]
            lons = [c[1] for c in self._route]
            self._lat_min, self._lat_max = min(lats), max(lats)
            self._lon_min, self._lon_max = min(lons), max(lons)
            self._cos_lat = math.cos(math.radians((self._lat_min + self._lat_max) / 2))
        self.update()

    def set_position(self, lat: float, lon: float) -> None:
        if lat != 0.0 or lon != 0.0:
            self._current_pos = (lat, lon)
            self.update()

    def _to_canvas(self, lat: float, lon: float) -> tuple[int, int]:
        margin = 12
        w = self.width() - 2 * margin
        h = self.height() - 2 * margin
        lat_range = (self._lat_max - self._lat_min) or 1e-6
        lon_range = (self._lon_max - self._lon_min) * self._cos_lat or 1e-6
        scale = min(w / lon_range, h / lat_range)
        x = int(margin + (lon - self._lon_min) * self._cos_lat * scale)
        y = int(margin + (self._lat_max - lat) * scale)
        return x, y

    def paintEvent(self, event) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)

        p.fillRect(self.rect(), QColor(12, 13, 18))
        p.setPen(QPen(QColor(28, 29, 36), 1, Qt.PenStyle.DashLine))
        grid_size = 28
        for x in range(0, self.width(), grid_size):
            p.drawLine(x, 0, x, self.height())
        for y in range(0, self.height(), grid_size):
            p.drawLine(0, y, self.width(), y)

        if not self._route:
            p.setPen(QColor(70, 70, 85))
            p.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "无 GPS 轨迹")
            return

        path = QPainterPath()
        for i, (lat, lon) in enumerate(self._route):
            x, y = self._to_canvas(lat, lon)
            if i == 0:
                path.moveTo(x, y)
            else:
                path.lineTo(x, y)
        p.setPen(QPen(QColor(232, 33, 39, 180), 2.5))
        p.drawPath(path)

        sx, sy = self._to_canvas(*self._route[0])
        p.setPen(QPen(QColor(255, 255, 255, 180), 1))
        p.setBrush(QColor(6, 182, 212))
        p.drawEllipse(sx - 4, sy - 4, 8, 8)

        if len(self._route) > 1:
            ex, ey = self._to_canvas(*self._route[-1])
            p.setBrush(QColor(249, 115, 22))
            p.drawEllipse(ex - 4, ey - 4, 8, 8)

        if self._current_pos:
            cx, cy = self._to_canvas(*self._current_pos)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QColor(232, 33, 39, 55))
            p.drawEllipse(cx - 9, cy - 9, 18, 18)
            p.setPen(QPen(QColor(255, 255, 255), 1.5))
            p.setBrush(QColor(232, 33, 39))
            p.drawEllipse(cx - 5, cy - 5, 10, 10)


# ---------------------------------------------------------------------------
# Trim slider
# ---------------------------------------------------------------------------


class TrimSlider(QWidget):
    """Timeline with in/out handles, playhead, and seek."""

    trim_changed = Signal(float, float)
    seek_requested = Signal(float)

    _HW = 5

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(28)
        self.setCursor(Qt.CursorShape.SizeHorCursor)
        self._duration = 0.0
        self._in_sec = 0.0
        self._out_sec = 0.0
        self._playhead = 0.0
        self._event_sec = None
        self._drag = None

    def set_duration(self, duration: float) -> None:
        self._duration = max(0.0, duration)
        self._in_sec = 0.0
        self._out_sec = self._duration
        self._playhead = 0.0
        self._event_sec = None
        self.update()

    def set_playhead(self, seconds: float) -> None:
        self._playhead = max(0.0, min(seconds, self._duration))
        self.update()

    def set_event_offset(self, seconds: float | None) -> None:
        self._event_sec = seconds
        self.update()

    def reset(self) -> None:
        self._in_sec = 0.0
        self._out_sec = self._duration
        self.update()
        if self._duration > 0:
            self.trim_changed.emit(self._in_sec, self._out_sec)

    @property
    def in_seconds(self) -> float:
        return self._in_sec

    @property
    def out_seconds(self) -> float:
        return self._out_sec

    def _x(self, sec: float) -> int:
        return int(sec / self._duration * self.width()) if self._duration > 0 else 0

    def _sec(self, x: float) -> float:
        if self.width() <= 0 or self._duration <= 0:
            return 0.0
        return max(0.0, min(self._duration, x / self.width() * self._duration))

    def paintEvent(self, event) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        w, h, hw = self.width(), self.height(), self._HW
        cy = h // 2

        # Full track
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(39, 39, 42))
        p.drawRoundedRect(0, cy - 2, w, 4, 2, 2)

        # Selected range
        in_x, out_x = self._x(self._in_sec), self._x(self._out_sec)
        span = max(0, out_x - in_x)
        if span > 0:
            p.setBrush(QColor(232, 33, 39, 200))
            p.drawRoundedRect(in_x, cy - 2, span, 4, 2, 2)
            p.setBrush(QColor(232, 33, 39, 24))
            p.drawRect(in_x, 4, span, h - 8)

        # Dim unselected regions
        p.setBrush(QColor(9, 9, 11, 120))
        if in_x > 0:
            p.drawRect(0, 4, in_x, h - 8)
        if out_x < w:
            p.drawRect(out_x, 4, w - out_x, h - 8)

        # Event marker
        if self._event_sec is not None and self._event_sec > 0:
            evt_x = self._x(self._event_sec)
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QColor(234, 179, 8))
            path = QPainterPath()
            path.moveTo(evt_x, cy - 6)
            path.lineTo(evt_x + 5, cy)
            path.lineTo(evt_x, cy + 6)
            path.lineTo(evt_x - 5, cy)
            p.drawPath(path)

        # Playhead
        ph_x = self._x(self._playhead)
        p.setPen(QPen(QColor(250, 250, 250, 230), 1.5))
        p.drawLine(ph_x, 2, ph_x, h - 2)

        # In / out handles
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(250, 250, 250))
        p.drawRoundedRect(in_x - hw, 3, hw * 2, h - 6, 2.0, 2.0)
        p.drawRoundedRect(out_x - hw, 3, hw * 2, h - 6, 2.0, 2.0)
        p.setPen(QPen(QColor(24, 24, 27), 1))
        p.drawLine(in_x, 7, in_x, h - 7)
        p.drawLine(out_x, 7, out_x, h - 7)

    def mousePressEvent(self, event) -> None:  # noqa: N802
        if self._duration <= 0:
            return
        x = event.position().x()
        in_x = self._x(self._in_sec)
        out_x = self._x(self._out_sec)
        if abs(x - in_x) <= 10:
            self._drag = "in"
        elif abs(x - out_x) <= 10:
            self._drag = "out"
        else:
            self._drag = "playhead"
            self.seek_requested.emit(self._sec(x))

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        if not self._drag or self._duration <= 0:
            return
        sec = self._sec(event.position().x())
        if self._drag == "in":
            self._in_sec = min(sec, self._out_sec - 1.0)
            self.trim_changed.emit(self._in_sec, self._out_sec)
        elif self._drag == "out":
            self._out_sec = max(sec, self._in_sec + 1.0)
            self.trim_changed.emit(self._in_sec, self._out_sec)
        elif self._drag == "playhead":
            self.seek_requested.emit(sec)
        self.update()

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802
        self._drag = None


# ---------------------------------------------------------------------------
# Video pane
# ---------------------------------------------------------------------------


class VideoPane(QWidget):
    double_clicked = Signal()

    def __init__(self, label: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.video = QVideoWidget(self)
        self.caption = QLabel(label, self)
        self.caption.setStyleSheet(
            "background: rgba(10, 11, 15, 0.72); color: #ffffff; padding: 4px 8px; "
            "border-radius: 4px; font-weight: 700; font-size: 11px; border: 1px solid rgba(255,255,255,0.08);"
        )
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.video)

    def resizeEvent(self, event) -> None:  # noqa: N802
        super().resizeEvent(event)
        self.caption.move(
            max(8, self.width() - self.caption.sizeHint().width() - 8),
            max(8, self.height() - self.caption.sizeHint().height() - 8),
        )

    def mouseDoubleClickEvent(self, event) -> None:  # noqa: N802
        self.double_clicked.emit()


# ---------------------------------------------------------------------------
# Clip card (two-line list item)
# ---------------------------------------------------------------------------


class ClipCardWidget(QWidget):
    """Flat two-line clip row — no heavy card chrome."""

    def __init__(
        self,
        title: str,
        clip_type: ClipType,
        subtitle: str,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._selected = False
        self.setObjectName("clip_card")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setMinimumHeight(52)
        self.setMaximumHeight(64)

        badge_text, badge_color = _TYPE_BADGE.get(clip_type, ("片段", "#71717a"))

        root = QHBoxLayout(self)
        root.setContentsMargins(8, 6, 8, 6)
        root.setSpacing(8)

        accent = QFrame(self)
        accent.setObjectName("clip_accent")
        accent.setFixedWidth(2)
        accent.setStyleSheet("background: transparent; border: none;")
        self._accent = accent
        root.addWidget(accent)

        col = QVBoxLayout()
        col.setContentsMargins(0, 0, 0, 0)
        col.setSpacing(2)

        top = QHBoxLayout()
        top.setContentsMargins(0, 0, 0, 0)
        top.setSpacing(6)

        self._title = QLabel(title)
        self._title.setStyleSheet("color: #e4e4e7; font-size: 12px; font-weight: 600; background: transparent;")
        self._title.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Preferred)

        self._badge = QLabel(badge_text)
        self._badge.setStyleSheet(
            f"color: {badge_color}; background: transparent; border: none; "
            f"font-size: 10px; font-weight: 700; letter-spacing: 0.5px;"
        )

        top.addWidget(self._title, 1)
        top.addWidget(self._badge, 0)

        self._subtitle = QLabel(subtitle or "—")
        self._subtitle.setStyleSheet("color: #52525b; font-size: 11px; background: transparent;")
        self._subtitle.setWordWrap(False)

        col.addLayout(top)
        col.addWidget(self._subtitle)
        root.addLayout(col, 1)

        self.set_selected(False)

    def sizeHint(self) -> QSize:  # noqa: N802
        return QSize(260, 50)

    def set_selected(self, selected: bool) -> None:
        self._selected = selected
        if selected:
            self.setStyleSheet(
                "QWidget#clip_card { background-color: #18181b; border: none; border-radius: 6px; }"
            )
            self._accent.setStyleSheet("background: #e82127; border: none; border-radius: 1px;")
            self._title.setStyleSheet(
                "color: #fafafa; font-size: 12px; font-weight: 600; background: transparent;"
            )
            self._subtitle.setStyleSheet(
                "color: #a1a1aa; font-size: 11px; background: transparent;"
            )
        else:
            self.setStyleSheet(
                "QWidget#clip_card { background-color: #121216; border: 1px solid #27272a; border-radius: 6px; }"
            )
            self._accent.setStyleSheet("background: #3f3f46; border: none; border-radius: 1px;")
            self._title.setStyleSheet(
                "color: #f4f4f5; font-size: 12px; font-weight: 600; background: transparent;"
            )
            self._subtitle.setStyleSheet(
                "color: #a1a1aa; font-size: 11px; background: transparent;"
            )


# ---------------------------------------------------------------------------
# Main window
# ---------------------------------------------------------------------------


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Tesla Cinema")
        self.resize(1600, 960)
        self.setStyleSheet(GLOBAL_STYLE)

        self.settings = SettingsStore().load()
        # Multi-cam (4/6) opens 4–6 hardware decoders at once and freezes USB/HDD
        # playback. Always boot into single front; user can still pick a grid.
        saved_view = self.settings.default_view
        self.current_view: ViewType = (
            saved_view if saved_view not in {"grid4", "grid4old", "grid6"} else "front"
        )
        self.clips: list[CamClip] = []
        self.current_clip: CamClip | None = None
        self.current_footage = None
        self.current_segment_index = 0
        self.current_folder: Path | None = None
        self._visible_clip_indexes: list[int] = []
        self._grid_built_for_view: ViewType | None = None
        self._sei_offsets: list[float] = []
        self._trim_in: float = 0.0
        self._trim_out: float = 0.0
        self._clip_cards: dict[int, ClipCardWidget] = {}
        self._stagger_timers: list[QTimer] = []

        self.players: dict[CamName, QMediaPlayer] = {}
        self.audio_outputs: dict[CamName, QAudioOutput] = {}
        self.panes: dict[CamName, VideoPane] = {}
        # Per-cam last loaded path — avoid re-setSource on same file (main stutter cause).
        self._loaded_source: dict[CamName, str] = {}
        self._pending_seek_ms: int | None = None
        self._pending_play: bool = False
        self._segment_transitioning: bool = False
        self._open_generation: int = 0
        self._opening: bool = False
        self._sei_loading: bool = False

        self._export_thread: QThread | None = None
        self._export_worker: _ExportWorker | None = None
        self._open_thread: QThread | None = None
        self._open_worker: _OpenClipWorker | None = None
        self._sei_thread: QThread | None = None
        self._sei_worker: _SeiWorker | None = None
        self._scan_thread: QThread | None = None
        self._scan_worker: _ScanWorker | None = None
        # Media is NOT opened until the user hits play (setSource freezes on slow disks).
        self._media_armed: bool = False
        self._deferred_source_timer: QTimer | None = None

        self._build_ui()
        self._build_players()
        self._clear_playback()
        self._set_sidebar_status("选择 TeslaCam 目录开始浏览。")

        self.sync_timer = QTimer(self)
        self.sync_timer.setInterval(250)
        self.sync_timer.timeout.connect(self._sync_timeline)
        self.sync_timer.start()

    # -- UI construction -----------------------------------------------------

    def _build_ui(self) -> None:
        root = QWidget(self)
        root.setObjectName("central_root")
        self.setCentralWidget(root)
        root_layout = QHBoxLayout(root)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        # ---- Left sidebar ----
        left = QVBoxLayout()
        left.setContentsMargins(12, 12, 12, 0)
        left.setSpacing(6)

        left_title = QLabel("TESLA CINEMA")
        left_title.setObjectName("sidebar_title")
        left_title.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
        left.addWidget(left_title)

        self.folder_btn = QPushButton("打开 TeslaCam")
        self.folder_btn.setObjectName("folder_btn")
        self.folder_btn.clicked.connect(self._select_folder)
        left.addWidget(self.folder_btn)

        self.search_input = QLineEdit()
        self.search_input.setObjectName("clip_search")
        self.search_input.setPlaceholderText("搜索…")
        self.search_input.textChanged.connect(self._refresh_clip_list)
        left.addWidget(self.search_input)

        self.event_filter = QComboBox()
        self.event_filter.setObjectName("event_filter")
        self.event_filter.addItem("全部", "all")
        self.event_filter.addItem("有事件", "event")
        self.event_filter.addItem("哨兵", "sentry")
        self.event_filter.addItem("手动保存", "saved")
        self.event_filter.addItem("无事件", "none")
        self.event_filter.currentIndexChanged.connect(self._refresh_clip_list)
        left.addWidget(self.event_filter)

        clips_label = QLabel("CLIPS")
        clips_label.setObjectName("section_label")
        left.addWidget(clips_label)

        self.clip_list = QListWidget()
        self.clip_list.setObjectName("clip_list")
        self.clip_list.setSpacing(0)
        self.clip_list.setUniformItemSizes(False)
        self.clip_list.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.clip_list.setVerticalScrollMode(QListWidget.ScrollMode.ScrollPerPixel)
        self.clip_list.currentRowChanged.connect(self._clip_changed)
        self.clip_list.itemSelectionChanged.connect(self._sync_card_selection)
        left.addWidget(self.clip_list, 1)

        self.sidebar_status = QLabel("")
        self.sidebar_status.setObjectName("sidebar_status")
        self.sidebar_status.setWordWrap(True)
        left.addWidget(self.sidebar_status)

        # GPS embedded at sidebar bottom (flat, no chrome box)
        gps_wrap = QWidget()
        gps_wrap.setObjectName("gps_wrap")
        gps_layout = QVBoxLayout(gps_wrap)
        gps_layout.setContentsMargins(0, 8, 0, 10)
        gps_layout.setSpacing(4)
        gps_title = QLabel("GPS")
        gps_title.setObjectName("gps_title")
        gps_layout.addWidget(gps_title)
        self.gps_map = GPSMapWidget()
        self.gps_map.setFixedHeight(120)
        gps_layout.addWidget(self.gps_map)
        left.addWidget(gps_wrap, 0)

        left_wrap = QWidget()
        left_wrap.setObjectName("left_wrap")
        left_wrap.setLayout(left)
        left_wrap.setFixedWidth(300)
        left_wrap.setMinimumWidth(300)
        root_layout.addWidget(left_wrap, 0)

        # ---- Right main stage ----
        right = QVBoxLayout()
        right.setContentsMargins(0, 0, 0, 0)
        right.setSpacing(0)

        # Top bar — ultra thin
        top_bar_wrap = QWidget()
        top_bar_wrap.setObjectName("top_bar_wrap")
        top_bar = QHBoxLayout(top_bar_wrap)
        top_bar.setContentsMargins(12, 8, 12, 8)
        top_bar.setSpacing(8)

        self.view_combo = QComboBox()
        self.view_combo.setObjectName("view_combo")
        for view_id, view_label in _VIEW_LABELS:
            self.view_combo.addItem(view_label, view_id)
        self.view_combo.setCurrentIndex(
            next((i for i, (v, _) in enumerate(_VIEW_LABELS) if v == self.current_view), 0)
        )
        self.view_combo.currentIndexChanged.connect(self._view_changed)

        self.delete_btn = QPushButton("删除")
        self.delete_btn.setObjectName("delete_btn")
        self.delete_btn.clicked.connect(self._delete_clip)

        self.export_btn = QPushButton("导出选区")
        self.export_btn.setObjectName("export_btn")
        self.export_btn.setToolTip("按时间轴 In/Out 选区导出（FFmpeg 裁切）")
        self.export_btn.clicked.connect(self._export_clip)

        top_bar.addWidget(self.view_combo)
        top_bar.addStretch(1)
        top_bar.addWidget(self.delete_btn)
        top_bar.addWidget(self.export_btn)
        right.addWidget(top_bar_wrap)

        # Video stage with overlay HUD
        self.stage = QWidget()
        self.stage.setObjectName("stage")
        stage_layout = QVBoxLayout(self.stage)
        stage_layout.setContentsMargins(0, 0, 0, 0)
        stage_layout.setSpacing(0)

        self.grid_host = QWidget(self.stage)
        self.grid_host.setObjectName("grid_host")
        self.grid_layout = QVBoxLayout(self.grid_host)
        self.grid_layout.setContentsMargins(0, 0, 0, 0)
        self.grid_layout.setSpacing(2)
        stage_layout.addWidget(self.grid_host, 1)

        # HUD overlay on top of grid (gradient, not solid card)
        self.hud_overlay = QWidget(self.grid_host)
        self.hud_overlay.setObjectName("hud_overlay")
        hud_layout = QVBoxLayout(self.hud_overlay)
        hud_layout.setContentsMargins(14, 10, 14, 18)
        hud_layout.setSpacing(2)

        self.info_label = QLabel("未加载素材")
        self.info_label.setObjectName("hud_info")

        self.event_label = QLabel("")
        self.event_label.setObjectName("hud_event")
        self.event_label.hide()

        meta_row = QHBoxLayout()
        meta_row.setSpacing(14)
        self.time_label = QLabel("时间: -")
        self.time_label.setObjectName("hud_meta")
        self.location_label = QLabel("位置: -")
        self.location_label.setObjectName("hud_meta")
        meta_row.addWidget(self.time_label)
        meta_row.addWidget(self.location_label)
        meta_row.addStretch(1)

        hud_layout.addWidget(self.info_label)
        hud_layout.addWidget(self.event_label)
        hud_layout.addLayout(meta_row)
        self.hud_overlay.setFixedHeight(72)
        self.hud_overlay.raise_()

        right.addWidget(self.stage, 1)

        # Player bar: single row transport + timeline + trim meta
        player_bar = QWidget()
        player_bar.setObjectName("player_bar")
        player_layout = QVBoxLayout(player_bar)
        player_layout.setContentsMargins(16, 10, 16, 12)
        player_layout.setSpacing(6)

        # Timeline with In / Out labels
        trim_row = QHBoxLayout()
        trim_row.setSpacing(8)

        self.trim_in_label = QLabel("In 00:00")
        self.trim_in_label.setObjectName("trim_label")
        self.trim_in_label.setMinimumWidth(56)

        self.trim_slider = TrimSlider()
        self.trim_slider.setObjectName("trim_slider")
        self.trim_slider.setMinimumHeight(32)
        self.trim_slider.trim_changed.connect(self._on_trim_changed)
        self.trim_slider.seek_requested.connect(self._seek_to_seconds)

        self.trim_out_label = QLabel("Out 00:00")
        self.trim_out_label.setObjectName("trim_label")
        self.trim_out_label.setMinimumWidth(62)
        self.trim_out_label.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        )

        trim_row.addWidget(self.trim_in_label)
        trim_row.addWidget(self.trim_slider, 1)
        trim_row.addWidget(self.trim_out_label)
        player_layout.addLayout(trim_row)

        # Transport row: jump | play | jump · current · selection · reset
        controls = QHBoxLayout()
        controls.setSpacing(4)

        self.back_btn = QPushButton("−5")
        self.back_btn.setObjectName("transport_btn")
        self.back_btn.setToolTip("后退 5 秒")
        self.back_btn.clicked.connect(lambda: self._jump(-5000))

        self.play_btn = QPushButton("▶")
        self.play_btn.setObjectName("play_btn")
        self.play_btn.clicked.connect(self._toggle_play)

        self.forward_btn = QPushButton("+5")
        self.forward_btn.setObjectName("transport_btn")
        self.forward_btn.setToolTip("前进 5 秒")
        self.forward_btn.clicked.connect(lambda: self._jump(5000))

        self.time_now_label = QLabel("00:00 / 00:00")
        self.time_now_label.setObjectName("time_now")

        self.trim_dur_label = QLabel("选区 00:00")
        self.trim_dur_label.setObjectName("trim_dur")
        self.trim_dur_label.setToolTip("导出将只包含 In→Out 这一段")

        reset_trim_btn = QPushButton("重置选区")
        reset_trim_btn.setObjectName("ghost_btn")
        reset_trim_btn.setToolTip("In/Out 恢复为整段")
        reset_trim_btn.clicked.connect(self.trim_slider.reset)

        controls.addWidget(self.back_btn)
        controls.addWidget(self.play_btn)
        controls.addWidget(self.forward_btn)
        controls.addSpacing(12)
        controls.addWidget(self.time_now_label)
        controls.addStretch(1)
        controls.addWidget(self.trim_dur_label)
        controls.addWidget(reset_trim_btn)
        player_layout.addLayout(controls)

        right.addWidget(player_bar, 0)

        right_wrap = QWidget()
        right_wrap.setLayout(right)
        root_layout.addWidget(right_wrap, 1)

        # Keep overlay positioned on resize
        self.grid_host.installEventFilter(self)

    def eventFilter(self, watched, event):  # noqa: N802
        if watched is self.grid_host and event.type() == QEvent.Type.Resize:
            self._position_hud_overlay()
        return super().eventFilter(watched, event)

    def _position_hud_overlay(self) -> None:
        if not hasattr(self, "hud_overlay"):
            return
        self.hud_overlay.setGeometry(0, 0, self.grid_host.width(), self.hud_overlay.height())
        self.hud_overlay.raise_()

    def _build_players(self) -> None:
        labels = camera_labels()
        for cam in ALL_CAMS:
            pane = VideoPane(labels[cam], self.grid_host)
            pane.double_clicked.connect(lambda cam_name=cam: self._handle_pane_double_click(cam_name))
            player = QMediaPlayer(self)
            audio = QAudioOutput(self)
            audio.setVolume(0)
            player.setAudioOutput(audio)
            player.setVideoOutput(pane.video)
            player.mediaStatusChanged.connect(
                lambda status, cam_name=cam: self._handle_media_status(cam_name, status)
            )
            player.playbackStateChanged.connect(self._on_player_state_changed)
            self.players[cam] = player
            self.audio_outputs[cam] = audio
            self.panes[cam] = pane

    def _on_player_state_changed(self) -> None:
        try:
            if not self._media_armed or not self._loaded_source:
                self.play_btn.setText("▶")
                return
            cam = next(iter(self._loaded_source))
            if self.players[cam].playbackState() == QMediaPlayer.PlaybackState.PlayingState:
                self.play_btn.setText("⏸")
                return
        except Exception:
            pass
        self.play_btn.setText("▶")

    def _handle_pane_double_click(self, cam: CamName) -> None:
        if self.current_view == cam:
            prev = getattr(self, "_prev_grid_view", "front")
            self.current_view = prev
        else:
            if self.current_view in {"grid4", "grid4old", "grid6"}:
                self._prev_grid_view = self.current_view
            self.current_view = cam

        self.view_combo.blockSignals(True)
        idx = next((i for i, (v, _) in enumerate(_VIEW_LABELS) if v == self.current_view), 0)
        self.view_combo.setCurrentIndex(idx)
        self.view_combo.blockSignals(False)

        self._grid_built_for_view = None
        # Don't slam setSource — drop media and wait for ▶.
        self._stop_all_players(clear_source=True)
        self._media_armed = False
        if self.current_footage:
            self._rebuild_grid()
            for pane in self.panes.values():
                pane.hide()
            for c in self._visible_cams():
                self.panes[c].show()
        if self.current_clip and self.current_footage:
            event_sec = self._event_offset_seconds(
                self.current_clip, self.current_footage.duration
            )
            self._refresh_hud(event_sec)
        self._set_sidebar_status("视图已切换 · 按 ▶ 播放")
        self._update_action_state()

    def _select_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "选择 TeslaCam 目录")
        if not folder:
            return
        self.current_folder = Path(folder)
        self._set_scan_busy(True)
        self._set_sidebar_status("正在扫描 TeslaCam 目录…")
        self.clip_list.clear()
        self._clear_playback()
        self.clips = []
        self._visible_clip_indexes = []

        worker = _ScanWorker(self.current_folder)
        thread = QThread(self)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)

        def on_ok(clips: list) -> None:
            self.clips = list(clips)
            self._set_scan_busy(False)
            self._refresh_clip_list()
            self._set_sidebar_status(
                f"已加载 {len(self.clips)} 个片段（保存/哨兵）· 点选后按 ▶ 播放"
            )

        def on_err(message: str) -> None:
            self.clips = []
            self._set_scan_busy(False)
            self._set_sidebar_status(f"扫描失败：{message}")
            QMessageBox.critical(self, "扫描失败", message)

        worker.finished.connect(on_ok)
        worker.error.connect(on_err)
        worker.finished.connect(thread.quit)
        worker.error.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        self._scan_worker = worker
        self._scan_thread = thread
        thread.start()

    def _clip_changed(self, row: int) -> None:
        if row < 0:
            return
        item = self.clip_list.item(row)
        if item is None:
            return
        clip_index = item.data(Qt.ItemDataRole.UserRole)
        if not isinstance(clip_index, int) or clip_index < 0 or clip_index >= len(self.clips):
            return

        clip = self.clips[clip_index]
        # Already showing this clip and not mid-open — ignore re-select noise.
        if (
            self.current_clip is clip
            and self.current_footage is not None
            and not self._opening
        ):
            self._sync_card_selection()
            return

        self._open_clip_async(clip)

    def _stop_all_players(self, *, clear_source: bool = True) -> None:
        """Hard-stop only decoders that actually have media (avoid 6× empty setSource)."""
        for timer in getattr(self, "_stagger_timers", []):
            try:
                timer.stop()
            except Exception:
                pass
        self._stagger_timers = []
        if self._deferred_source_timer is not None:
            try:
                self._deferred_source_timer.stop()
            except Exception:
                pass
            self._deferred_source_timer = None

        # Only touch players that were armed — setSource(QUrl()) on empty players is costly.
        cams = list(self._loaded_source.keys()) if self._loaded_source else []
        for cam in cams:
            player = self.players.get(cam)
            if player is None:
                continue
            try:
                player.stop()
            except Exception:
                pass
            if clear_source:
                try:
                    player.setSource(QUrl())
                except Exception:
                    pass
                self._loaded_source.pop(cam, None)
        if clear_source:
            self._loaded_source.clear()
            self._media_armed = False

    def _cancel_background_jobs(self) -> None:
        """Detach workers so stale results are ignored (threads finish on their own)."""
        self._open_generation += 1
        self._opening = False
        self._sei_loading = False
        self._open_worker = None
        self._sei_worker = None

    def _open_clip_async(self, clip: CamClip) -> None:
        """Open timeline off UI thread. SEI is NOT loaded until export."""
        self._cancel_background_jobs()
        gen = self._open_generation
        self.current_clip = clip
        self.current_footage = None
        self.current_segment_index = 0
        self._grid_built_for_view = None
        self._pending_seek_ms = None
        self._pending_play = False
        self._sei_offsets = []
        self._opening = True

        # Kill previous decode immediately — this is what made "click does nothing".
        self._stop_all_players(clear_source=True)

        self.info_label.setText(f"加载中…  {clip.name}")
        loc = clip.location_text or "—"
        self.location_label.setText(f"位置: {loc}")
        self.time_label.setText("时间: …")
        self._set_sidebar_status(f"正在打开 {clip.name}…")
        self._sync_card_selection()
        self._update_action_state()

        worker = _OpenClipWorker(clip)
        thread = QThread(self)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)

        def on_ok(done_clip: CamClip, footage: CamFootage, g: int = gen) -> None:
            if g != self._open_generation or self.current_clip is not done_clip:
                return
            self._opening = False
            self._apply_opened_footage(done_clip, footage)
            # SEI stays deferred — only needed for live speed HUD / full export gauges.
            # Time + location already come from segment names / event.json.

        def on_err(done_clip: CamClip, message: str, g: int = gen) -> None:
            if g != self._open_generation:
                return
            self._opening = False
            self._set_sidebar_status(f"加载失败：{done_clip.name}")
            QMessageBox.critical(self, "加载失败", message)
            self._update_action_state()

        worker.finished.connect(on_ok)
        worker.error.connect(on_err)
        worker.finished.connect(thread.quit)
        worker.error.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        self._open_worker = worker
        self._open_thread = thread
        thread.start()

    def _apply_opened_footage(self, clip: CamClip, footage: CamFootage) -> None:
        """Apply timeline metadata only — do NOT open video files yet.

        Opening MP4 via QMediaPlayer.setSource on a USB TeslaCam freezes the UI
        thread for seconds. Media is armed lazily when the user hits ▶.
        """
        self.current_clip = clip
        self.current_footage = footage
        self.current_segment_index = 0
        self._grid_built_for_view = None
        self._pending_seek_ms = None
        self._pending_play = False
        self._media_armed = False
        self._sei_offsets = [p.offset_seconds for p in footage.sei_data]

        # Drop any previous decode immediately (only if something was loaded).
        self._stop_all_players(clear_source=True)

        dur = footage.duration
        self.trim_slider.set_duration(dur)
        self._trim_in = 0.0
        self._trim_out = dur
        self.trim_in_label.setText(f"In {_fmt_sec(0)}")
        self.trim_out_label.setText(f"Out {_fmt_sec(dur)}")
        self.trim_dur_label.setText(f"选区 {_fmt_sec(dur)}")
        self.time_now_label.setText(f"00:00 / {_fmt_sec(dur)}")

        event_sec = self._event_offset_seconds(clip, dur)
        self.trim_slider.set_event_offset(event_sec)

        # Layout shell only (no setSource).
        if self._grid_built_for_view != self.current_view:
            self._rebuild_grid()
        for pane in self.panes.values():
            pane.hide()
        for cam in self._visible_cams():
            self.panes[cam].show()

        self._refresh_hud(event_sec)
        self._refresh_map()
        self.info_label.setText(f"{clip.name}  ·  就绪")
        self._set_sidebar_status(
            f"{clip.name}  ·  {len(footage.segments)} 段 / {_fmt_sec(dur)}  ·  按 ▶ 播放"
        )
        self._update_action_state()
        self._sync_card_selection()
        self._position_hud_overlay()

    def _stagger_load_cams(
        self,
        cams: list[CamName],
        *,
        seek_ms: int,
        autoplay: bool,
        delay_ms: int = 120,
    ) -> None:
        """Open extra cameras one-by-one so the UI stays responsive."""
        for timer in self._stagger_timers:
            try:
                timer.stop()
            except Exception:
                pass
        self._stagger_timers = []
        gen = self._open_generation
        for i, cam in enumerate(cams):
            timer = QTimer(self)
            timer.setSingleShot(True)

            def _load(c: CamName = cam, g: int = gen) -> None:
                if g != self._open_generation or self.current_footage is None:
                    return
                self._load_segment(seek_ms=seek_ms, autoplay=autoplay, cams_override=[c])

            timer.timeout.connect(_load)
            timer.start(delay_ms * (i + 1))
            self._stagger_timers.append(timer)

    def _start_sei_job(self, clip: CamClip, footage: CamFootage, gen: int) -> None:
        self._sei_loading = True
        worker = _SeiWorker(clip, footage)
        thread = QThread(self)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)

        def on_ok(done_clip: CamClip, points, g: int = gen) -> None:
            if g != self._open_generation or self.current_clip is not done_clip:
                return
            if self.current_footage is None:
                return
            self._sei_loading = False
            # Mutate footage in place so playback session stays put.
            self.current_footage.sei_data = list(points)
            self._sei_offsets = [p.offset_seconds for p in self.current_footage.sei_data]
            self._refresh_map()
            n = len(points)
            self._set_sidebar_status(
                f"{done_clip.name}  ·  遥测 {n} 点" if n else f"{done_clip.name}  ·  无 SEI 遥测"
            )
            self._update_action_state()

        def on_err(done_clip: CamClip, message: str, g: int = gen) -> None:
            if g != self._open_generation:
                return
            self._sei_loading = False
            self._set_sidebar_status(f"{done_clip.name}  ·  遥测解析失败")

        worker.finished.connect(on_ok)
        worker.error.connect(on_err)
        worker.finished.connect(thread.quit)
        worker.error.connect(thread.quit)
        thread.finished.connect(worker.deleteLater)
        thread.finished.connect(thread.deleteLater)
        self._sei_worker = worker
        self._sei_thread = thread
        thread.start()

    def _sync_card_selection(self) -> None:
        selected_indexes: set[int] = set()
        for item in self.clip_list.selectedItems():
            idx = item.data(Qt.ItemDataRole.UserRole)
            if isinstance(idx, int):
                selected_indexes.add(idx)
        for clip_index, card in self._clip_cards.items():
            card.set_selected(clip_index in selected_indexes)

    def _refresh_clip_list(self, *args) -> None:
        if not hasattr(self, "clip_list"):
            return
        previous_clip = self.current_clip.name if self.current_clip else ""
        self.clip_list.blockSignals(True)
        self.clip_list.clear()
        self._visible_clip_indexes = []
        self._clip_cards = {}

        for index, clip in enumerate(self.clips):
            if not self._clip_matches_filters(clip):
                continue
            item = QListWidgetItem(clip.name)
            item.setData(Qt.ItemDataRole.UserRole, index)
            # Fallback text if custom widget fails to paint (still selectable/searchable).
            item.setToolTip(self._clip_subtitle(clip) or clip.name)
            card = ClipCardWidget(
                title=clip.name,
                clip_type=clip.type,
                subtitle=self._clip_subtitle(clip),
            )
            card.setMinimumWidth(240)
            item.setSizeHint(QSize(260, 56))
            self.clip_list.addItem(item)
            self.clip_list.setItemWidget(item, card)
            self._clip_cards[index] = card
            self._visible_clip_indexes.append(index)

        self.clip_list.blockSignals(False)

        if self._visible_clip_indexes:
            target_row = 0
            if previous_clip:
                for row, clip_index in enumerate(self._visible_clip_indexes):
                    if self.clips[clip_index].name == previous_clip:
                        target_row = row
                        break
            self.clip_list.setCurrentRow(target_row)
            self._set_sidebar_status(
                f"显示 {len(self._visible_clip_indexes)} / {len(self.clips)} 个片段"
            )
            self._sync_card_selection()
        else:
            self._clear_playback()
            if self.clips:
                self._set_sidebar_status("没有匹配的片段，试试清空搜索或切换筛选。")
            elif self.current_folder:
                self._set_sidebar_status("该目录下没有找到可播放片段。")
            else:
                self._set_sidebar_status("选择 TeslaCam 目录开始浏览。")
        self._update_action_state()

    def _clip_subtitle(self, clip: CamClip) -> str:
        parts: list[str] = []
        loc = clip.location_text
        if loc:
            parts.append(loc)
        event_text = self._event_label_text(clip)
        if event_text:
            parts.append(event_text)
        if not parts:
            parts.append(f"{len(clip.videos)} 个视频")
        return " · ".join(parts)

    def _clip_matches_filters(self, clip: CamClip) -> bool:
        query = self.search_input.text().strip().lower() if hasattr(self, "search_input") else ""
        event_text = self._event_label_text(clip)
        haystack = " ".join([clip.name, clip.location_text, event_text, clip.type]).lower()
        if query and query not in haystack:
            return False

        mode = self.event_filter.currentData() if hasattr(self, "event_filter") else "all"
        reason = clip.event.reason if clip.event else ""
        if mode == "event":
            return clip.event is not None
        if mode == "sentry":
            return reason.startswith("sentry")
        if mode == "saved":
            return reason.startswith("user_saved")
        if mode == "none":
            return clip.event is None
        return True

    def _event_label_text(self, clip: CamClip) -> str:
        if not clip.event or not clip.event.reason:
            return ""
        reason_map = {
            "sentry_away_event": "哨兵事件（人员接近）",
            "sentry_city_event": "哨兵事件（城市环境）",
            "sentry_sentry_sentry": "哨兵触发（警报）",
            "user_saved_event": "手动保存",
            "user_saved_dashcam": "行车记录仪保存",
            "user_saved_horn": "鸣笛保存",
        }
        return reason_map.get(clip.event.reason, f"事件：{clip.event.reason}")

    def _event_offset_seconds(self, clip: CamClip, duration: float) -> float | None:
        if not clip.event or not clip.event.timestamp:
            return None
        try:
            from datetime import datetime

            evt_str = clip.event.timestamp.replace("Z", "").replace("T", " ")
            if "." in evt_str:
                evt_str = evt_str.split(".")[0]
            evt_dt = datetime.strptime(evt_str, "%Y-%m-%d %H:%M:%S")

            earliest_dt = None
            for path in clip.videos:
                name = path.name[:19]
                try:
                    dt = datetime.strptime(name, "%Y-%m-%d_%H-%M-%S")
                except Exception:
                    continue
                if earliest_dt is None or dt < earliest_dt:
                    earliest_dt = dt

            if earliest_dt is None:
                return None
            diff = (evt_dt - earliest_dt).total_seconds()
            if diff < 0 or diff > duration:
                diff = diff % 3600
                if diff > duration:
                    diff = diff % 60
            return diff if 0 <= diff <= duration else None
        except Exception:
            return None

    def _refresh_hud(self, event_sec: float | None = None) -> None:
        if not self.current_clip:
            return
        view_label = next(
            (lbl for v, lbl in _VIEW_LABELS if v == self.current_view), str(self.current_view)
        )
        self.info_label.setText(f"{self.current_clip.name}  ·  {view_label}")
        loc = self.current_clip.location_text
        if not loc and self.current_clip.event:
            lat = self.current_clip.event.est_lat
            lon = self.current_clip.event.est_lon
            if lat and lon:
                loc = f"{lat}, {lon}"
        self.location_label.setText(f"位置: {loc or '—'}")
        # Seed absolute time from first segment until playback ticks update it.
        if self.current_footage and self.current_footage.segments:
            seg0 = self.current_footage.segments[0]
            self.time_label.setText(f"时间: {wall_clock_text(seg0.name, 0.0)}")
        else:
            self.time_label.setText("时间: —")

        event_text = self._event_label_text(self.current_clip)
        if event_text:
            cam_labels = camera_labels()
            cam_name = self.current_clip.event.camera if self.current_clip.event else ""
            cam_lbl = cam_labels.get(cam_name, cam_name) if cam_name else "未知"  # type: ignore[arg-type]
            evt_text = f"⚠ {event_text}  ·  触发相机 {cam_lbl}"
            if event_sec is not None:
                evt_text += f"  ·  {_fmt_sec(event_sec)}"
            self.event_label.setText(evt_text)
            self.event_label.show()
            self.hud_overlay.setFixedHeight(78)
        else:
            self.event_label.hide()
            self.hud_overlay.setFixedHeight(58)
        self._position_hud_overlay()

    def _update_hud_at(self, current_sec: float) -> None:
        """Live wall-clock + location + drive gauges for the playhead."""
        if not self.current_footage:
            return
        segment = segment_at(self.current_footage, current_sec)
        if segment is not None:
            local = max(0.0, current_sec - segment.start_seconds)
            self.time_label.setText(f"时间: {wall_clock_text(segment.name, local)}")
        if self.current_clip:
            loc = self.current_clip.location_text
            if not loc and self.current_clip.event:
                lat = self.current_clip.event.est_lat
                lon = self.current_clip.event.est_lon
                if lat and lon:
                    loc = f"{lat}, {lon}"
            if loc:
                self.location_label.setText(f"位置: {loc}")
        if self.current_footage.sei_data:
            sp = telemetry_at(
                self.current_footage.sei_data,
                current_sec,
                offsets=self._sei_offsets or None,
            )
            if sp is not None:
                self.gps_map.set_position(sp.latitude, sp.longitude)
                # Append live drive readouts into the info line when available.
                drive = f"{round(sp.speed_kph)} km/h"
                if sp.gear and sp.gear != "UNKNOWN":
                    drive = f"{sp.gear}  {drive}"
                if self.current_clip:
                    view_label = next(
                        (lbl for v, lbl in _VIEW_LABELS if v == self.current_view),
                        str(self.current_view),
                    )
                    self.info_label.setText(
                        f"{self.current_clip.name}  ·  {view_label}  ·  {drive}"
                    )

    def _refresh_map(self) -> None:
        if not self.current_footage:
            self.gps_map.set_route([])
            return
        route = [
            (p.latitude, p.longitude)
            for p in self.current_footage.sei_data
            if p.latitude != 0.0 or p.longitude != 0.0
        ]
        # Fallback: single point from event.json when SEI has no GPS.
        if not route and self.current_clip and self.current_clip.event:
            try:
                lat = float(self.current_clip.event.est_lat)
                lon = float(self.current_clip.event.est_lon)
                if lat != 0.0 or lon != 0.0:
                    route = [(lat, lon)]
            except (TypeError, ValueError):
                pass
        self.gps_map.set_route(route)
        if route:
            self.gps_map.set_position(route[0][0], route[0][1])

    def _set_sidebar_status(self, message: str) -> None:
        if hasattr(self, "sidebar_status"):
            self.sidebar_status.setText(message)

    def _set_scan_busy(self, busy: bool) -> None:
        self.folder_btn.setEnabled(not busy)
        self.search_input.setEnabled(not busy)
        self.event_filter.setEnabled(not busy)
        self._update_action_state()

    def _update_action_state(self) -> None:
        if not hasattr(self, "play_btn"):
            return
        has_footage = self.current_footage is not None and bool(self.current_footage.segments)
        exporting = bool(self._export_thread and self._export_thread.isRunning())
        busy = self._opening or exporting
        # Play is available as soon as timeline exists (lazy media arm).
        self.play_btn.setEnabled(has_footage and not busy)
        self.back_btn.setEnabled(has_footage and not busy)
        self.forward_btn.setEnabled(has_footage and not busy)
        self.export_btn.setEnabled(has_footage and not busy)
        self.delete_btn.setEnabled(self.current_clip is not None and not exporting)
        self.view_combo.setEnabled(not busy)
        self.trim_slider.setEnabled(has_footage and not busy)
        # Never freeze the list — scanning/opening must not disable clip switching.
        self.clip_list.setEnabled(not exporting)

    def _view_changed(self, index: int) -> None:
        view: ViewType = self.view_combo.itemData(index)
        if view == self.current_view:
            return
        self.current_view = view
        self._grid_built_for_view = None
        if not self.current_footage:
            return
        # Changing layout: drop multi-cam load; re-arm on next play.
        self._stop_all_players(clear_source=True)
        self._media_armed = False
        if self._grid_built_for_view != self.current_view:
            self._rebuild_grid()
        for pane in self.panes.values():
            pane.hide()
        for cam in self._visible_cams():
            self.panes[cam].show()
        self._set_sidebar_status("视图已切换 · 按 ▶ 重新加载画面")
        if self.current_clip:
            event_sec = self._event_offset_seconds(
                self.current_clip, self.current_footage.duration
            )
            self._refresh_hud(event_sec)
        self._update_action_state()

    def _on_trim_changed(self, in_sec: float, out_sec: float) -> None:
        self._trim_in = in_sec
        self._trim_out = out_sec
        self.trim_in_label.setText(f"In {_fmt_sec(in_sec)}")
        self.trim_out_label.setText(f"Out {_fmt_sec(out_sec)}")
        self.trim_dur_label.setText(f"选区 {_fmt_sec(max(0.0, out_sec - in_sec))}")
        # Keep export button label honest about range
        if hasattr(self, "export_btn") and not (
            self._export_thread and self._export_thread.isRunning()
        ):
            self.export_btn.setToolTip(
                f"导出 In→Out：{_fmt_sec(in_sec)} – {_fmt_sec(out_sec)}（{_fmt_sec(max(0.0, out_sec - in_sec))}）"
            )

    def _visible_cams(self) -> list[CamName]:
        return cameras_for_view(self.current_view)

    def _rebuild_grid(self) -> None:
        for pane in self.panes.values():
            pane.setParent(self.grid_host)
            pane.hide()

        while self.grid_layout.count():
            item = self.grid_layout.takeAt(0)
            widget = item.widget()
            if widget and widget is not self.hud_overlay:
                widget.setParent(None)

        if self.current_view == "grid6":
            self._add_row(["left", "front", "right"])
            self._add_row(["left_pillar", "back", "right_pillar"])
        elif self.current_view == "grid4":
            self._add_row(["front", "back"])
            self._add_row(["left", "right"])
        elif self.current_view == "grid4old":
            self._add_row(["front"])
            self._add_row(["left", "back", "right"])
        else:
            self._add_row([self.current_view])  # type: ignore[list-item]
        self._grid_built_for_view = self.current_view
        self._position_hud_overlay()

    def _load_segment(
        self,
        *,
        seek_ms: int = 0,
        autoplay: bool | None = None,
        cams_override: list[CamName] | None = None,
    ) -> None:
        """Load current segment into visible players.

        Skips setSource when the same file is already loaded (avoids multi-cam
        stutter on every seek that crosses a segment boundary).
        """
        if not self.current_footage or not self.current_footage.segments:
            return
        if self.current_segment_index >= len(self.current_footage.segments):
            self.current_segment_index = max(0, len(self.current_footage.segments) - 1)
        segment = self.current_footage.segments[self.current_segment_index]
        if self._grid_built_for_view != self.current_view:
            self._rebuild_grid()

        was_playing = False
        try:
            was_playing = (
                self._master_player().playbackState()
                == QMediaPlayer.PlaybackState.PlayingState
            )
        except Exception:
            pass
        if autoplay is None:
            autoplay = was_playing or self._pending_play

        visible_cams = list(cams_override) if cams_override is not None else self._visible_cams()
        any_reload = False
        for cam in visible_cams:
            player = self.players.get(cam)
            if player is None:
                continue
            source = segment.cameras.get(cam)
            path_str = str(source) if source else ""
            if path_str and self._loaded_source.get(cam) == path_str:
                player.setPosition(max(0, seek_ms))
                if autoplay:
                    player.play()
                continue
            any_reload = True
            if path_str:
                self._loaded_source[cam] = path_str
                player.setSource(QUrl.fromLocalFile(path_str))
            else:
                self._loaded_source.pop(cam, None)
                player.stop()
                player.setSource(QUrl())

        # Pause/unload cameras not needed for the current view.
        full_view = set(self._visible_cams())
        active = set(visible_cams)
        for cam, player in self.players.items():
            if cam in active:
                continue
            # Always free decoders outside the current view.
            if cam not in full_view and self._loaded_source.get(cam):
                player.stop()
                player.setSource(QUrl())
                self._loaded_source.pop(cam, None)
            elif cam not in active and player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
                player.pause()

        self._pending_seek_ms = seek_ms if any_reload else None
        self._pending_play = bool(autoplay)
        if not any_reload:
            self._pending_play = False
            self._pending_seek_ms = None
        self._update_hud_at(segment.start_seconds + seek_ms / 1000.0)
        self._position_hud_overlay()

    def _add_row(self, cams: list[CamName]) -> None:
        row = QWidget()
        layout = QHBoxLayout(row)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(2)
        for cam in cams:
            pane = self.panes[cam]
            layout.addWidget(pane, 1)
            pane.show()
        self.grid_layout.addWidget(row, 1)

    def _master_player(self) -> QMediaPlayer:
        return self.players[self._visible_cams()[0]]

    def _toggle_play(self) -> None:
        if not self.current_footage:
            return
        # Lazy-arm: first play opens only the primary camera file.
        if not self._media_armed:
            self._pending_play = True
            self._arm_primary_media()
            return
        master = self._master_player()
        if master.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
            self._pending_play = False
            for cam in self._visible_cams():
                if cam in self._loaded_source:
                    self.players[cam].pause()
            self.play_btn.setText("▶")
        else:
            self._pending_play = True
            for cam in self._visible_cams():
                if cam in self._loaded_source:
                    self.players[cam].play()
            # If grid and other cams not loaded yet, stagger them.
            missing = [c for c in self._visible_cams() if c not in self._loaded_source]
            if missing:
                self._stagger_load_cams(missing, seek_ms=master.position(), autoplay=True)

    def _arm_primary_media(self) -> None:
        """Open a single camera file on the next event-loop tick (keeps list responsive)."""
        if not self.current_footage or not self.current_footage.segments:
            return
        self._media_armed = True
        cam = self._visible_cams()[0]
        self._set_sidebar_status(f"正在打开画面… {cam}")
        gen = self._open_generation

        def _do(g: int = gen, c: CamName = cam) -> None:
            if g != self._open_generation or self.current_footage is None:
                return
            self._load_segment(seek_ms=0, autoplay=True, cams_override=[c])
            self._set_sidebar_status(
                f"{self.current_clip.name if self.current_clip else ''}  ·  播放中"
            )

        # Defer so the click handler returns and the UI can repaint first.
        if self._deferred_source_timer is not None:
            self._deferred_source_timer.stop()
        self._deferred_source_timer = QTimer(self)
        self._deferred_source_timer.setSingleShot(True)
        self._deferred_source_timer.timeout.connect(_do)
        self._deferred_source_timer.start(0)

    def _jump(self, delta_ms: int) -> None:
        if not self.current_footage:
            return
        if not self._media_armed:
            # Nudge virtual playhead without media.
            cur = self.trim_slider._playhead if hasattr(self.trim_slider, "_playhead") else 0.0
            self._seek_to_seconds(max(0.0, cur + delta_ms / 1000.0))
            return
        segment = self.current_footage.segments[self.current_segment_index]
        master_cam = next(iter(self._loaded_source), self._visible_cams()[0])
        global_ms = int(segment.start_seconds * 1000) + self.players[master_cam].position() + delta_ms
        global_ms = max(0, min(global_ms, int(self.current_footage.duration * 1000)))
        self._seek_to_seconds(global_ms / 1000.0)

    def _seek_to_seconds(self, sec: float) -> None:
        if not self.current_footage:
            return
        if not self._media_armed:
            # Just move the playhead UI; media opens on ▶.
            self.trim_slider.set_playhead(sec)
            self._update_hud_at(sec)
            if hasattr(self, "time_now_label"):
                self.time_now_label.setText(
                    f"{_fmt_sec(sec)} / {_fmt_sec(self.current_footage.duration)}"
                )
            return
        global_ms = int(max(0.0, min(sec, self.current_footage.duration)) * 1000)
        next_index = len(self.current_footage.segments) - 1
        for index, segment in enumerate(self.current_footage.segments):
            if global_ms < int((segment.start_seconds + segment.duration) * 1000):
                next_index = index
                break
        segment = self.current_footage.segments[next_index]
        local_ms = max(0, global_ms - int(segment.start_seconds * 1000))
        if next_index != self.current_segment_index:
            self.current_segment_index = next_index
            # Only reload cameras that are already armed (usually 1).
            cams = [c for c in self._visible_cams() if c in self._loaded_source] or self._visible_cams()[:1]
            self._load_segment(seek_ms=local_ms, cams_override=cams)
        else:
            for cam in list(self._loaded_source.keys()):
                self.players[cam].setPosition(local_ms)
            self._update_hud_at(global_ms / 1000.0)

    def _sync_timeline(self) -> None:
        if not self.current_footage or not self.current_footage.segments:
            return
        if self._segment_transitioning:
            return
        if not self._media_armed or not self._loaded_source:
            return
        segment = self.current_footage.segments[self.current_segment_index]
        master_cam = next(iter(self._loaded_source), self._visible_cams()[0])
        master = self.players[master_cam]
        # Auto-advance near end of segment (smoother than waiting for EndOfMedia alone).
        if (
            master.playbackState() == QMediaPlayer.PlaybackState.PlayingState
            and segment.duration > 0
            and master.position() >= max(0, int(segment.duration * 1000) - 80)
            and self.current_segment_index < len(self.current_footage.segments) - 1
        ):
            self._advance_segment(autoplay=True)
            return

        global_ms = int(segment.start_seconds * 1000) + master.position()
        current_sec = global_ms / 1000.0
        self.trim_slider.set_playhead(current_sec)
        if hasattr(self, "time_now_label"):
            self.time_now_label.setText(
                f"{_fmt_sec(current_sec)} / {_fmt_sec(self.current_footage.duration)}"
            )
        self._update_hud_at(current_sec)

    def _advance_segment(self, *, autoplay: bool = True) -> None:
        if not self.current_footage or not self._media_armed:
            return
        if self.current_segment_index >= len(self.current_footage.segments) - 1:
            return
        self._segment_transitioning = True
        try:
            self.current_segment_index += 1
            # Only swap files for cameras already open.
            cams = [c for c in self._visible_cams() if c in self._loaded_source] or self._visible_cams()[:1]
            self._load_segment(seek_ms=0, autoplay=autoplay, cams_override=cams)
        finally:
            self._segment_transitioning = False

    def _handle_media_status(self, cam: CamName, status) -> None:
        if not self.current_footage:
            return
        visible = self._visible_cams()
        if cam not in visible:
            return

        # After a fresh setSource, apply pending seek/play once media is buffered.
        if status in (
            QMediaPlayer.MediaStatus.LoadedMedia,
            QMediaPlayer.MediaStatus.BufferedMedia,
        ):
            if self._pending_seek_ms is not None:
                self.players[cam].setPosition(self._pending_seek_ms)
            if self._pending_play:
                self.players[cam].play()
            # Clear pending once master has applied it.
            if cam == visible[0]:
                self._pending_seek_ms = None
            return

        if cam != visible[0]:
            return
        if (
            status == QMediaPlayer.MediaStatus.EndOfMedia
            and self.current_segment_index < len(self.current_footage.segments) - 1
        ):
            self._advance_segment(autoplay=True)

    def _delete_clip(self) -> None:
        if not self.current_clip:
            return
        current_name = self.current_clip.name
        if (
            QMessageBox.question(self, "删除片段", f"删除 {current_name} 到回收站？")
            != QMessageBox.StandardButton.Yes
        ):
            return
        try:
            delete_clip(self.current_clip)
        except Exception as exc:
            QMessageBox.critical(self, "删除失败", str(exc))
            return
        clip_index = next((i for i, clip in enumerate(self.clips) if clip.name == current_name), -1)
        if 0 <= clip_index < len(self.clips):
            del self.clips[clip_index]
        self._clear_playback()
        self._refresh_clip_list()

    def _clear_playback(self) -> None:
        self._cancel_background_jobs()
        self.current_clip = None
        self.current_footage = None
        self.current_segment_index = 0
        self._grid_built_for_view = None
        self._sei_offsets = []
        self._pending_seek_ms = None
        self._pending_play = False
        self._segment_transitioning = False
        self._media_armed = False
        self._stop_all_players(clear_source=True)
        self.trim_slider.set_duration(0.0)
        self.trim_slider.set_event_offset(None)
        self.trim_in_label.setText("In 00:00")
        self.trim_out_label.setText("Out 00:00")
        if hasattr(self, "trim_dur_label"):
            self.trim_dur_label.setText("选区 00:00")
        if hasattr(self, "time_now_label"):
            self.time_now_label.setText("00:00 / 00:00")
        self.gps_map.set_route([])
        self.info_label.setText("未加载素材")
        self.time_label.setText("时间: —")
        self.location_label.setText("位置: —")
        self.event_label.hide()
        self.hud_overlay.setFixedHeight(58)
        self._position_hud_overlay()
        self._update_action_state()

    def _set_export_busy(self, busy: bool) -> None:
        self.export_btn.setText("导出中…" if busy else "导出选区")
        self.folder_btn.setEnabled(not busy)
        if hasattr(self, "search_input"):
            self.search_input.setEnabled(not busy)
            self.event_filter.setEnabled(not busy)
        self._update_action_state()

    def _export_clip(self) -> None:
        if not self.current_clip or not self.current_footage:
            return
        if self._export_thread and self._export_thread.isRunning():
            return
        if self._opening:
            QMessageBox.information(self, "请稍候", "片段还在打开中，打开完成后再导出。")
            return

        output, _ = QFileDialog.getSaveFileName(
            self,
            "导出 MP4",
            f"{self.current_clip.name}-{self.current_view}.mp4",
            "MP4 Video (*.mp4)",
        )
        if not output:
            return

        self._export_worker = _ExportWorker(
            self.current_clip,
            self.current_footage,
            self.current_view,
            Path(output),
            export_start_seconds=self._trim_in,
            export_duration_seconds=self._trim_out - self._trim_in,
            show_location=self.settings.show_location,
            show_drive_data=self.settings.show_drive_data,
        )
        self._export_thread = QThread(self)
        self._export_worker.moveToThread(self._export_thread)
        self._export_thread.started.connect(self._export_worker.run)
        self._export_worker.finished.connect(lambda: self._on_export_done(output))
        self._export_worker.error.connect(self._on_export_error)
        self._export_worker.finished.connect(self._export_thread.quit)
        self._export_worker.error.connect(self._export_thread.quit)
        self._export_thread.finished.connect(lambda: self._set_export_busy(False))
        self._set_export_busy(True)
        self._export_thread.start()

    def _on_export_done(self, output: str) -> None:
        QMessageBox.information(self, "导出完成", output)

    def _on_export_error(self, message: str) -> None:
        QMessageBox.critical(self, "导出失败", message)
