"""Historial de descargas persistente (JSON) para no repetir canciones."""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from pathlib import Path


class History:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._items: dict[str, dict] = {}
        try:
            self._items = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self._items = {}

    def has(self, video_id: str) -> bool:
        with self._lock:
            return video_id in self._items

    def add(self, video_id: str, **data) -> None:
        with self._lock:
            self._items[video_id] = {**data, "date": datetime.now().isoformat(timespec="seconds")}
            self._save()

    def remove(self, video_id: str) -> bool:
        with self._lock:
            if self._items.pop(video_id, None) is None:
                return False
            self._save()
            return True

    def items(self) -> list[dict]:
        """Entradas del historial, de la más reciente a la más antigua."""
        with self._lock:
            entries = [{"id": vid, **data} for vid, data in self._items.items()]
        return sorted(entries, key=lambda e: e.get("date", ""), reverse=True)

    def __len__(self) -> int:
        return len(self._items)

    def _save(self) -> None:
        # Escritura atómica: archivo temporal + reemplazo.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._items, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.path)
