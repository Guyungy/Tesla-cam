"""Use case: move a clip's source paths to the OS trash."""

from __future__ import annotations

from tesla_cinema.application.ports import TrashService
from tesla_cinema.domain.models import CamClip


def delete_clip(clip: CamClip, *, trash: TrashService | None = None) -> None:
    if trash is None:
        from tesla_cinema.services.trash import trash_paths as trash
    trash(list(clip.source_paths))
