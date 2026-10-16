"""Rutas de configuración, ajustes persistentes y logging."""
from __future__ import annotations

import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

__version__ = "1.0.0"

CONFIG_DIR = Path.home() / ".soundbox"
HISTORY_FILE = CONFIG_DIR / "history.json"
SETTINGS_FILE = CONFIG_DIR / "settings.json"
LOG_FILE = CONFIG_DIR / "soundbox.log"

DEFAULT_SETTINGS = {
    "dest_dir": str(Path.home() / "Music"),
    "bitrate": 192,
    "skip_downloaded": True,
}


def load_settings() -> dict:
    settings = dict(DEFAULT_SETTINGS)
    try:
        settings.update(json.loads(SETTINGS_FILE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    return settings


def save_settings(settings: dict) -> None:
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError:
        logging.getLogger("soundbox").exception("No se pudieron guardar los ajustes")


def setup_logging() -> None:
    logger = logging.getLogger("soundbox")
    if logger.handlers:
        return
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(LOG_FILE, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
