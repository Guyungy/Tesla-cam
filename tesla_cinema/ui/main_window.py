from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QTimer, Qt, QUrl
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget
from PySide6.QtWidgets import QFileDialog, QHBoxLayout, QLabel, QListWidget, QListWidgetItem, QMainWindow, QMessageBox, QPushButton, QSlider, QVBoxLayout, QWidget

from tesla_cinema.domain.models import ALL_CAMS, CamClip, CamName, ViewType
from tesla_cinema.services.exporter import build_export_request, run_strict_export
from tesla_cinema.services.scan import build_footage, camera_labels, scan_teslacam_folder
from tesla_cinema.services.settings import SettingsStore
from tesla_cinema.services.trash import trash_paths


class VideoPane(QWidget):
    def __init__(self, label: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.video = QVideoWidget(self)
        self.caption = QLabel(label, self)
        self.caption.setStyleSheet("background: rgba(0, 0, 0, 0.55); color: white; padding: 4px 8px; border-radius: 4px;")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.video)

    def resizeEvent(self, event) -> None:  # noqa: N802
        super().resizeEvent(event)
        self.caption.move(max(8, self.width() - self.caption.sizeHint().width() - 8), max(8, self.height() - self.caption.sizeHint().height() - 8))


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

        self.players: dict[CamName, QMediaPlayer] = {}
        self.audio_outputs: dict[CamName, QAudioOutput] = {}
        self.panes: dict[CamName, VideoPane] = {}

        self._build_ui()
        self._build_players()

        self.sync_timer = QTimer(self)
        self.sync_timer.setInterval(250)
        self.sync_timer.timeout.connect(self._sync_timeline)
        self.sync_timer.start()

    def _build_ui(self) -> None:
        root = QWidget(self)
        self.setCentralWidget(root)
        root_layout = QHBoxLayout(root)
        root_layout.setContentsMargins(12, 12, 12, 12)
        root_layout.setSpacing(12)

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

        right = QVBoxLayout()
        header = QHBoxLayout()
        self.export_btn = QPushButton("严格导出")
        self.export_btn.clicked.connect(self._export_clip)
        self.delete_btn = QPushButton("删除片段")
        self.delete_btn.clicked.connect(self._delete_clip)
        self.info_label = QLabel("未加载素材")
        header.addWidget(self.export_btn)
        header.addWidget(self.delete_btn)
        header.addWidget(self.info_label, 1)
        right.addLayout(header)

        self.time_label = QLabel("时间: -")
        self.location_label = QLabel("位置: -")
        right.addWidget(self.time_label)
        right.addWidget(self.location_label)

        self.grid_host = QWidget()
        self.grid_layout = QVBoxLayout(self.grid_host)
        self.grid_layout.setContentsMargins(0, 0, 0, 0)
        self.grid_layout.setSpacing(8)
        right.addWidget(self.grid_host, 1)

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

        right_wrap = QWidget()
        right_wrap.setLayout(right)
        root_layout.addWidget(right_wrap, 1)

    def _build_players(self) -> None:
        labels = camera_labels()
        for cam in ALL_CAMS:
            pane = VideoPane(labels[cam], self.grid_host)
            player = QMediaPlayer(self)
            audio = QAudioOutput(self)
            audio.setVolume(0)
            player.setAudioOutput(audio)
            player.setVideoOutput(pane.video)
            player.mediaStatusChanged.connect(lambda status, cam_name=cam: self._handle_media_status(cam_name, status))
            self.players[cam] = player
            self.audio_outputs[cam] = audio
            self.panes[cam] = pane

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
        self._load_segment()
        self.timeline.setMaximum(int(self.current_footage.duration * 1000))
        self.timeline.setValue(0)
        self.info_label.setText(f"{self.current_clip.name} | {self.current_view}")
        self.location_label.setText(f"位置: {self.current_clip.location_text}")

    def _visible_cams(self) -> list[CamName]:
        if self.current_view == "grid6":
            return list(ALL_CAMS)
        if self.current_view in {"grid4", "grid4old"}:
            return ["front", "back", "left", "right"]
        return [self.current_view]

    def _load_segment(self) -> None:
        if not self.current_footage or not self.current_footage.segments:
            return
        segment = self.current_footage.segments[self.current_segment_index]
        self.time_label.setText(f"时间: {segment.name}")

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
            self._add_row([self.current_view])

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

    def _master_player(self) -> QMediaPlayer:
        visible = self._visible_cams()
        return self.players[visible[0]]

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
        master = self._master_player()
        master.setPosition(max(0, master.position() + delta_ms))
        self._apply_master_position()

    def _seek_slider(self) -> None:
        if not self.current_footage:
            return
        global_ms = self.timeline.value()
        next_index = 0
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
        self.timeline.blockSignals(True)
        self.timeline.setValue(min(self.timeline.maximum(), global_ms))
        self.timeline.blockSignals(False)

    def _apply_master_position(self) -> None:
        target = self._master_player().position()
        for cam in self._visible_cams()[1:]:
            self.players[cam].setPosition(target)

    def _handle_media_status(self, cam: CamName, status) -> None:
        if not self.current_footage or cam != self._visible_cams()[0]:
            return
        if status == QMediaPlayer.MediaStatus.EndOfMedia and self.current_segment_index < len(self.current_footage.segments) - 1:
            self.current_segment_index += 1
            self._load_segment()
            for visible in self._visible_cams():
                self.players[visible].play()

    def _delete_clip(self) -> None:
        if not self.current_clip:
            return
        if QMessageBox.question(self, "删除片段", f"删除 {self.current_clip.name} 到回收站？") != QMessageBox.StandardButton.Yes:
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

    def _export_clip(self) -> None:
        if not self.current_clip or not self.current_footage:
            return
        output, _ = QFileDialog.getSaveFileName(self, "导出 MP4", f"{self.current_clip.name}-{self.current_view}.mp4", "MP4 Video (*.mp4)")
        if not output:
            return
        try:
            request = build_export_request(
                self.current_clip,
                self.current_footage,
                self.current_view,
                export_start_seconds=0.0,
                export_duration_seconds=min(self.current_footage.duration, 60.0),
                location_text=self.current_clip.location_text,
                show_location=self.settings.show_location,
                show_drive_data=self.settings.show_drive_data,
            )
            run_strict_export(request, Path(output))
        except Exception as exc:
            QMessageBox.critical(self, "导出失败", str(exc))
            return
        QMessageBox.information(self, "导出完成", output)
