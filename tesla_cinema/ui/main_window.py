from __future__ import annotations

import bisect
import math
from pathlib import Path

from PySide6.QtCore import QObject, QThread, QTimer, Qt, QUrl, Signal
from PySide6.QtGui import QColor, QPainter, QPainterPath, QPen
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget
from PySide6.QtWidgets import (
    QComboBox,
    QDockWidget,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSlider,
    QVBoxLayout,
    QWidget,
)

from tesla_cinema.domain.models import ALL_CAMS, CamClip, CamName, ViewType
from tesla_cinema.services.exporter import build_export_request, run_strict_export
from tesla_cinema.services.scan import build_footage, camera_labels, scan_teslacam_folder
from tesla_cinema.services.settings import SettingsStore
from tesla_cinema.services.trash import trash_paths


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


# ---------------------------------------------------------------------------
# Background export worker
# ---------------------------------------------------------------------------

class _ExportWorker(QObject):
    finished = Signal()
    error = Signal(str)

    def __init__(self, request, output_path: Path) -> None:
        super().__init__()
        self._request = request
        self._output_path = output_path

    def run(self) -> None:
        try:
            run_strict_export(self._request, self._output_path)
            self.finished.emit()
        except Exception as exc:
            self.error.emit(str(exc))


# ---------------------------------------------------------------------------
# GPS map widget  (feature #9)
# ---------------------------------------------------------------------------

class GPSMapWidget(QWidget):
    """Renders the GPS route from SEI telemetry using QPainter — no internet or tile library needed."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setMinimumSize(150, 120)
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
            # Scale longitude by cos(lat) so 1° lon ≈ 1° lat visually
            self._cos_lat = math.cos(math.radians((self._lat_min + self._lat_max) / 2))
        self.update()

    def set_position(self, lat: float, lon: float) -> None:
        if lat != 0.0 or lon != 0.0:
            self._current_pos = (lat, lon)
            self.update()

    def _to_canvas(self, lat: float, lon: float) -> tuple[int, int]:
        margin = 16
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
        p.fillRect(self.rect(), QColor(15, 15, 25))

        if not self._route:
            p.setPen(QColor(80, 80, 100))
            p.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "无 GPS 数据")
            return

        # Route polyline
        path = QPainterPath()
        for i, (lat, lon) in enumerate(self._route):
            x, y = self._to_canvas(lat, lon)
            if i == 0:
                path.moveTo(x, y)
            else:
                path.lineTo(x, y)
        p.setPen(QPen(QColor(34, 197, 94), 2))
        p.drawPath(path)

        # Start dot (blue)
        sx, sy = self._to_canvas(*self._route[0])
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(100, 149, 237))
        p.drawEllipse(sx - 5, sy - 5, 10, 10)

        # End dot (orange)
        if len(self._route) > 1:
            ex, ey = self._to_canvas(*self._route[-1])
            p.setBrush(QColor(255, 165, 0))
            p.drawEllipse(ex - 5, ey - 5, 10, 10)

        # Current position (pink with white border)
        if self._current_pos:
            cx, cy = self._to_canvas(*self._current_pos)
            p.setPen(QPen(QColor(255, 255, 255), 2))
            p.setBrush(QColor(251, 113, 133))
            p.drawEllipse(cx - 7, cy - 7, 14, 14)


# ---------------------------------------------------------------------------
# Trim slider  (feature #10)
# ---------------------------------------------------------------------------

class TrimSlider(QWidget):
    """Timeline bar with draggable in/out trim handles and a playhead indicator."""

    trim_changed = Signal(float, float)  # in_sec, out_sec

    _HW = 5  # handle half-width in pixels

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(28)
        self.setCursor(Qt.CursorShape.SizeHorCursor)
        self._duration = 0.0
        self._in_sec = 0.0
        self._out_sec = 0.0
        self._playhead = 0.0
        self._drag: str | None = None  # 'in' | 'out'

    # -- public API ----------------------------------------------------------

    def set_duration(self, duration: float) -> None:
        self._duration = max(0.0, duration)
        self._in_sec = 0.0
        self._out_sec = self._duration
        self._playhead = 0.0
        self.update()

    def set_playhead(self, seconds: float) -> None:
        self._playhead = max(0.0, min(seconds, self._duration))
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

    # -- helpers -------------------------------------------------------------

    def _x(self, sec: float) -> int:
        return int(sec / self._duration * self.width()) if self._duration > 0 else 0

    def _sec(self, x: float) -> float:
        if self.width() <= 0 or self._duration <= 0:
            return 0.0
        return max(0.0, min(self._duration, x / self.width() * self._duration))

    # -- Qt overrides --------------------------------------------------------

    def paintEvent(self, event) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        w, h, hw = self.width(), self.height(), self._HW
        cy = h // 2

        # Track background
        p.fillRect(0, cy - 3, w, 6, QColor(45, 45, 55))

        # Selected (green) range
        in_x, out_x = self._x(self._in_sec), self._x(self._out_sec)
        p.fillRect(in_x, cy - 3, max(0, out_x - in_x), 6, QColor(34, 197, 94, 160))

        # Playhead (white vertical line)
        ph_x = self._x(self._playhead)
        p.setPen(QPen(QColor(255, 255, 255, 200), 1))
        p.drawLine(ph_x, 2, ph_x, h - 2)

        # In / out handles (pink rounded rects)
        p.setPen(Qt.PenStyle.NoPen)
        p.setBrush(QColor(251, 113, 133))
        p.drawRoundedRect(in_x - hw, 2, hw * 2, h - 4, 2.0, 2.0)
        p.drawRoundedRect(out_x - hw, 2, hw * 2, h - 4, 2.0, 2.0)

    def mousePressEvent(self, event) -> None:  # noqa: N802
        if self._duration <= 0:
            return
        x = event.position().x()
        self._drag = "in" if abs(x - self._x(self._in_sec)) <= abs(x - self._x(self._out_sec)) else "out"

    def mouseMoveEvent(self, event) -> None:  # noqa: N802
        if not self._drag or self._duration <= 0:
            return
        sec = self._sec(event.position().x())
        if self._drag == "in":
            self._in_sec = min(sec, self._out_sec - 1.0)
        else:
            self._out_sec = max(sec, self._in_sec + 1.0)
        self.update()
        self.trim_changed.emit(self._in_sec, self._out_sec)

    def mouseReleaseEvent(self, event) -> None:  # noqa: N802
        self._drag = None


# ---------------------------------------------------------------------------
# Video pane
# ---------------------------------------------------------------------------

class VideoPane(QWidget):
    def __init__(self, label: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.video = QVideoWidget(self)
        self.caption = QLabel(label, self)
        self.caption.setStyleSheet(
            "background: rgba(0, 0, 0, 0.55); color: white; padding: 4px 8px; border-radius: 4px;"
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


# ---------------------------------------------------------------------------
# Main window
# ---------------------------------------------------------------------------

class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Tesla Cinema")
        self.resize(1600, 960)

        self.settings = SettingsStore().load()
        self.current_view: ViewType = self.settings.default_view
        self.clips: list[CamClip] = []
        self.current_clip: CamClip | None = None
        self.current_footage = None
        self.current_segment_index = 0
        self._grid_built_for_view: ViewType | None = None
        self._sei_offsets: list[float] = []   # precomputed for O(log n) GPS lookup
        self._trim_in: float = 0.0
        self._trim_out: float = 0.0

        self.players: dict[CamName, QMediaPlayer] = {}
        self.audio_outputs: dict[CamName, QAudioOutput] = {}
        self.panes: dict[CamName, VideoPane] = {}

        self._export_thread: QThread | None = None
        self._export_worker: _ExportWorker | None = None

        self._build_ui()
        self._build_players()
        self._build_map_dock()

        self.sync_timer = QTimer(self)
        self.sync_timer.setInterval(250)
        self.sync_timer.timeout.connect(self._sync_timeline)
        self.sync_timer.start()

    # -- UI construction -----------------------------------------------------

    def _build_ui(self) -> None:
        root = QWidget(self)
        self.setCentralWidget(root)
        root_layout = QHBoxLayout(root)
        root_layout.setContentsMargins(12, 12, 12, 12)
        root_layout.setSpacing(12)

        # Left: folder button + clip list
        left = QVBoxLayout()
        self.folder_btn = QPushButton("选择 TeslaCam 目录")
        self.folder_btn.clicked.connect(self._select_folder)
        self.clip_list = QListWidget()
        self.clip_list.currentRowChanged.connect(self._clip_changed)
        left.addWidget(self.folder_btn)
        left.addWidget(self.clip_list, 1)
        left_wrap = QWidget()
        left_wrap.setLayout(left)
        left_wrap.setMaximumWidth(360)
        root_layout.addWidget(left_wrap)

        # Right: everything else
        right = QVBoxLayout()

        # Header row
        header = QHBoxLayout()
        self.export_btn = QPushButton("严格导出")
        self.export_btn.clicked.connect(self._export_clip)
        self.delete_btn = QPushButton("删除片段")
        self.delete_btn.clicked.connect(self._delete_clip)
        self.view_combo = QComboBox()
        for view_id, view_label in _VIEW_LABELS:
            self.view_combo.addItem(view_label, view_id)
        self.view_combo.setCurrentIndex(
            next((i for i, (v, _) in enumerate(_VIEW_LABELS) if v == self.current_view), 0)
        )
        self.view_combo.currentIndexChanged.connect(self._view_changed)
        self.info_label = QLabel("未加载素材")
        header.addWidget(self.export_btn)
        header.addWidget(self.delete_btn)
        header.addWidget(self.view_combo)
        header.addWidget(self.info_label, 1)
        right.addLayout(header)

        self.time_label = QLabel("时间: -")
        self.location_label = QLabel("位置: -")
        right.addWidget(self.time_label)
        right.addWidget(self.location_label)

        # Video grid
        self.grid_host = QWidget()
        self.grid_layout = QVBoxLayout(self.grid_host)
        self.grid_layout.setContentsMargins(0, 0, 0, 0)
        self.grid_layout.setSpacing(8)
        right.addWidget(self.grid_host, 1)

        # Playback controls
        controls = QHBoxLayout()
        self.back_btn = QPushButton("-5s")
        self.back_btn.clicked.connect(lambda: self._jump(-5000))
        self.play_btn = QPushButton("播放 / 暂停")
        self.play_btn.clicked.connect(self._toggle_play)
        self.forward_btn = QPushButton("+5s")
        self.forward_btn.clicked.connect(lambda: self._jump(5000))
        self.timeline = QSlider(Qt.Orientation.Horizontal)
        self.timeline.sliderReleased.connect(self._seek_slider)
        controls.addWidget(self.back_btn)
        controls.addWidget(self.play_btn)
        controls.addWidget(self.forward_btn)
        controls.addWidget(self.timeline, 1)
        right.addLayout(controls)

        # Trim row
        trim_row = QHBoxLayout()
        self.trim_in_label = QLabel("从 00:00")
        self.trim_in_label.setMinimumWidth(72)
        self.trim_slider = TrimSlider()
        self.trim_slider.trim_changed.connect(self._on_trim_changed)
        self.trim_out_label = QLabel("至 00:00")
        self.trim_out_label.setMinimumWidth(72)
        self.trim_out_label.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        reset_trim_btn = QPushButton("重置")
        reset_trim_btn.setMaximumWidth(48)
        reset_trim_btn.clicked.connect(self.trim_slider.reset)
        trim_row.addWidget(self.trim_in_label)
        trim_row.addWidget(self.trim_slider, 1)
        trim_row.addWidget(self.trim_out_label)
        trim_row.addWidget(reset_trim_btn)
        right.addLayout(trim_row)

        right_wrap = QWidget()
        right_wrap.setLayout(right)
        root_layout.addWidget(right_wrap, 1)

    def _build_map_dock(self) -> None:
        self.gps_map = GPSMapWidget()
        self.gps_map.setMinimumHeight(180)
        dock = QDockWidget("GPS 轨迹", self)
        dock.setObjectName("gps_dock")
        dock.setAllowedAreas(
            Qt.DockWidgetArea.LeftDockWidgetArea
            | Qt.DockWidgetArea.RightDockWidgetArea
            | Qt.DockWidgetArea.BottomDockWidgetArea
        )
        dock.setWidget(self.gps_map)
        self.addDockWidget(Qt.DockWidgetArea.BottomDockWidgetArea, dock)

    def _build_players(self) -> None:
        labels = camera_labels()
        for cam in ALL_CAMS:
            pane = VideoPane(labels[cam], self.grid_host)
            player = QMediaPlayer(self)
            audio = QAudioOutput(self)
            audio.setVolume(0)
            player.setAudioOutput(audio)
            player.setVideoOutput(pane.video)
            player.mediaStatusChanged.connect(
                lambda status, cam_name=cam: self._handle_media_status(cam_name, status)
            )
            self.players[cam] = player
            self.audio_outputs[cam] = audio
            self.panes[cam] = pane

    # -- folder / clip -------------------------------------------------------

    def _select_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "选择 TeslaCam 目录")
        if not folder:
            return
        self.clips = scan_teslacam_folder(Path(folder))
        self.clip_list.clear()
        for clip in self.clips:
            self.clip_list.addItem(QListWidgetItem(f"{clip.name} | {clip.location_text}"))
        if self.clips:
            self.clip_list.setCurrentRow(0)

    def _clip_changed(self, row: int) -> None:
        if row < 0 or row >= len(self.clips):
            return
        self.current_clip = self.clips[row]
        self.current_footage = build_footage(self.current_clip)
        self.current_segment_index = 0
        self._grid_built_for_view = None
        self._sei_offsets = [p.offset_seconds for p in self.current_footage.sei_data]

        self._load_segment()

        dur = self.current_footage.duration
        self.timeline.setMaximum(int(dur * 1000))
        self.timeline.setValue(0)
        self.trim_slider.set_duration(dur)
        self._trim_in = 0.0
        self._trim_out = dur
        self.trim_in_label.setText(f"从 {_fmt_sec(0)}")
        self.trim_out_label.setText(f"至 {_fmt_sec(dur)}")

        self.info_label.setText(f"{self.current_clip.name} | {self.current_view}")
        self.location_label.setText(f"位置: {self.current_clip.location_text}")

        route = [
            (p.latitude, p.longitude)
            for p in self.current_footage.sei_data
            if p.latitude != 0.0 or p.longitude != 0.0
        ]
        self.gps_map.set_route(route)

    # -- view change ---------------------------------------------------------

    def _view_changed(self, index: int) -> None:
        view: ViewType = self.view_combo.itemData(index)
        if view == self.current_view:
            return
        self.current_view = view
        self._grid_built_for_view = None
        if self.current_footage:
            self._load_segment()
            self.info_label.setText(f"{self.current_clip.name} | {self.current_view}")  # type: ignore[union-attr]

    # -- trim ----------------------------------------------------------------

    def _on_trim_changed(self, in_sec: float, out_sec: float) -> None:
        self._trim_in = in_sec
        self._trim_out = out_sec
        self.trim_in_label.setText(f"从 {_fmt_sec(in_sec)}")
        self.trim_out_label.setText(f"至 {_fmt_sec(out_sec)}")

    # -- segment / grid ------------------------------------------------------

    def _visible_cams(self) -> list[CamName]:
        if self.current_view == "grid6":
            return list(ALL_CAMS)
        if self.current_view in {"grid4", "grid4old"}:
            return ["front", "back", "left", "right"]
        return [self.current_view]  # type: ignore[list-item]

    def _rebuild_grid(self) -> None:
        while self.grid_layout.count():
            item = self.grid_layout.takeAt(0)
            widget = item.widget()
            if widget:
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

    def _load_segment(self) -> None:
        if not self.current_footage or not self.current_footage.segments:
            return
        segment = self.current_footage.segments[self.current_segment_index]
        self.time_label.setText(f"时间: {segment.name}")
        if self._grid_built_for_view != self.current_view:
            self._rebuild_grid()
        for cam, player in self.players.items():
            source = segment.cameras.get(cam)
            player.setSource(QUrl.fromLocalFile(str(source)) if source else QUrl())

    def _add_row(self, cams: list[CamName]) -> None:
        row = QWidget()
        layout = QHBoxLayout(row)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)
        for cam in cams:
            layout.addWidget(self.panes[cam], 1)
        self.grid_layout.addWidget(row, 1)

    # -- playback ------------------------------------------------------------

    def _master_player(self) -> QMediaPlayer:
        return self.players[self._visible_cams()[0]]

    def _toggle_play(self) -> None:
        if not self.current_footage:
            return
        master = self._master_player()
        if master.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
            for cam in self._visible_cams():
                self.players[cam].pause()
        else:
            for cam in self._visible_cams():
                self.players[cam].play()

    def _jump(self, delta_ms: int) -> None:
        if not self.current_footage:
            return
        segment = self.current_footage.segments[self.current_segment_index]
        global_ms = int(segment.start_seconds * 1000) + self._master_player().position() + delta_ms
        global_ms = max(0, min(global_ms, int(self.current_footage.duration * 1000)))
        next_index = len(self.current_footage.segments) - 1
        for index, seg in enumerate(self.current_footage.segments):
            if global_ms < int((seg.start_seconds + seg.duration) * 1000):
                next_index = index
                break
        if next_index != self.current_segment_index:
            self.current_segment_index = next_index
            self._load_segment()
        seg = self.current_footage.segments[self.current_segment_index]
        local_ms = max(0, global_ms - int(seg.start_seconds * 1000))
        for cam in self._visible_cams():
            self.players[cam].setPosition(local_ms)

    def _seek_slider(self) -> None:
        if not self.current_footage:
            return
        global_ms = self.timeline.value()
        next_index = len(self.current_footage.segments) - 1
        for index, segment in enumerate(self.current_footage.segments):
            if global_ms < int((segment.start_seconds + segment.duration) * 1000):
                next_index = index
                break
        if next_index != self.current_segment_index:
            self.current_segment_index = next_index
            self._load_segment()
        segment = self.current_footage.segments[self.current_segment_index]
        local_ms = max(0, global_ms - int(segment.start_seconds * 1000))
        for cam in self._visible_cams():
            self.players[cam].setPosition(local_ms)

    def _sync_timeline(self) -> None:
        if not self.current_footage or not self.current_footage.segments:
            return
        segment = self.current_footage.segments[self.current_segment_index]
        global_ms = int(segment.start_seconds * 1000) + self._master_player().position()
        clamped = min(self.timeline.maximum(), global_ms)

        self.timeline.blockSignals(True)
        self.timeline.setValue(clamped)
        self.timeline.blockSignals(False)

        current_sec = global_ms / 1000.0
        self.trim_slider.set_playhead(current_sec)

        # Update GPS marker via binary search — O(log n)
        if self._sei_offsets:
            idx = bisect.bisect_left(self._sei_offsets, current_sec)
            idx = min(idx, len(self.current_footage.sei_data) - 1)
            sp = self.current_footage.sei_data[idx]
            self.gps_map.set_position(sp.latitude, sp.longitude)

    def _handle_media_status(self, cam: CamName, status) -> None:
        if not self.current_footage or cam != self._visible_cams()[0]:
            return
        if (
            status == QMediaPlayer.MediaStatus.EndOfMedia
            and self.current_segment_index < len(self.current_footage.segments) - 1
        ):
            self.current_segment_index += 1
            self._load_segment()
            for visible in self._visible_cams():
                self.players[visible].play()

    # -- delete / clear ------------------------------------------------------

    def _delete_clip(self) -> None:
        if not self.current_clip:
            return
        if (
            QMessageBox.question(self, "删除片段", f"删除 {self.current_clip.name} 到回收站？")
            != QMessageBox.StandardButton.Yes
        ):
            return
        try:
            trash_paths(self.current_clip.source_paths)
        except Exception as exc:
            QMessageBox.critical(self, "删除失败", str(exc))
            return
        row = self.clip_list.currentRow()
        if 0 <= row < len(self.clips):
            del self.clips[row]
            self.clip_list.takeItem(row)
            if self.clips:
                self.clip_list.setCurrentRow(max(0, row - 1))
            else:
                self._clear_playback()

    def _clear_playback(self) -> None:
        self.current_clip = None
        self.current_footage = None
        self.current_segment_index = 0
        self._grid_built_for_view = None
        self._sei_offsets = []
        for player in self.players.values():
            player.stop()
            player.setSource(QUrl())
        self.timeline.setValue(0)
        self.timeline.setMaximum(0)
        self.trim_slider.set_duration(0.0)
        self.trim_in_label.setText("从 00:00")
        self.trim_out_label.setText("至 00:00")
        self.gps_map.set_route([])
        self.info_label.setText("未加载素材")
        self.time_label.setText("时间: -")
        self.location_label.setText("位置: -")

    # -- export --------------------------------------------------------------

    def _set_export_busy(self, busy: bool) -> None:
        self.export_btn.setEnabled(not busy)
        self.export_btn.setText("导出中..." if busy else "严格导出")
        self.delete_btn.setEnabled(not busy)
        self.folder_btn.setEnabled(not busy)

    def _export_clip(self) -> None:
        if not self.current_clip or not self.current_footage:
            return
        if self._export_thread and self._export_thread.isRunning():
            return
        output, _ = QFileDialog.getSaveFileName(
            self,
            "导出 MP4",
            f"{self.current_clip.name}-{self.current_view}.mp4",
            "MP4 Video (*.mp4)",
        )
        if not output:
            return
        try:
            request = build_export_request(
                self.current_clip,
                self.current_footage,
                self.current_view,
                export_start_seconds=self._trim_in,
                export_duration_seconds=self._trim_out - self._trim_in,
                location_text=self.current_clip.location_text,
                show_location=self.settings.show_location,
                show_drive_data=self.settings.show_drive_data,
            )
        except Exception as exc:
            QMessageBox.critical(self, "导出失败", str(exc))
            return

        self._export_worker = _ExportWorker(request, Path(output))
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
