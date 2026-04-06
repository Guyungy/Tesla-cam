from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtCore import QSettings

from tesla_cinema.domain.models import ViewType


@dataclass(slots=True)
class AppSettings:
    show_time: bool = True
    show_location: bool = True
    show_drive_data: bool = True
    language: str = "zh-CN"
    default_view: ViewType = "grid4"


class SettingsStore:
    def __init__(self) -> None:
        self._settings = QSettings("TeslaCinema", "TeslaCinema")

    def load(self) -> AppSettings:
        return AppSettings(
            show_time=self._settings.value("show_time", True, bool),
            show_location=self._settings.value("show_location", True, bool),
            show_drive_data=self._settings.value("show_drive_data", True, bool),
            language=self._settings.value("language", "zh-CN", str),
            default_view=self._settings.value("default_view", "grid4", str),
        )

    def save(self, value: AppSettings) -> None:
        self._settings.setValue("show_time", value.show_time)
        self._settings.setValue("show_location", value.show_location)
        self._settings.setValue("show_drive_data", value.show_drive_data)
        self._settings.setValue("language", value.language)
        self._settings.setValue("default_view", value.default_view)
