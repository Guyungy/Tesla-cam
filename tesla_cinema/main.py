from __future__ import annotations

import sys

from PySide6.QtWidgets import QApplication

from tesla_cinema.ui.main_window import MainWindow


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("Tesla Cinema")
    window = MainWindow()
    window.show()
    return app.exec()
