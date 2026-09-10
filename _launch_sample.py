"""Launch Tesla Cinema GUI and auto-load the local sample TeslaCam folder."""
from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication

from tesla_cinema.application.scan_folder import scan_folder
from tesla_cinema.ui.main_window import MainWindow

SAMPLE = Path(r"E:\Github\Tesla-cam\_sample_TeslaCam")


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("Tesla Cinema")
    window = MainWindow()
    window.show()

    def load_sample() -> None:
        if not SAMPLE.exists():
            window._set_sidebar_status(f"样例目录不存在：{SAMPLE}")
            return
        window.current_folder = SAMPLE
        window._set_scan_busy(True)
        window._set_sidebar_status("正在扫描样例 TeslaCam 目录...")
        window.clip_list.clear()
        window._clear_playback()
        try:
            window.clips = scan_folder(SAMPLE)
        except Exception as exc:  # noqa: BLE001
            window.clips = []
            window._set_sidebar_status(f"扫描失败：{exc}")
            return
        finally:
            window._set_scan_busy(False)
        window._refresh_clip_list()
        window._set_sidebar_status(
            f"已加载样例目录，共 {len(window.clips)} 个片段：{SAMPLE}"
        )

    QTimer.singleShot(200, load_sample)
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
