"""Extracción de información, descarga, conversión a MP3 y etiquetado (yt-dlp como librería)."""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadCancelled, DownloadError

from history import History
from tagging import write_tags
from utils import classify_url, clean_error, normalize_url, parse_artist_title, sanitize_filename

log = logging.getLogger("soundbox")

# YouTube requiere un runtime de JavaScript para descifrar formatos; se usa el que esté instalado.
_JS_RUNTIMES = {name: {} for name in ("deno", "node", "bun") if shutil.which(name)}

_UNAVAILABLE_TITLES = {"[private video]", "[deleted video]", "[unavailable video]"}


@dataclass
class Track:
    id: str
    title: str
    url: str
    uploader: str = ""
    duration: float | None = None
    index: int = 1
    available: bool = True


@dataclass
class MediaInfo:
    kind: str  # "video" | "playlist"
    title: str
    tracks: list[Track] = field(default_factory=list)
    uploader: str = ""


@dataclass
class DownloadJob:
    tracks: list[Track]
    dest_dir: Path
    bitrate: int = 192
    album: str | None = None  # nombre de la playlist, si aplica
    skip_downloaded: bool = True


class _YdlLogger:
    """Redirige los mensajes de yt-dlp al log de Soundbox en lugar de la consola."""

    def debug(self, msg: str) -> None:
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        log.warning(clean_error(msg))

    def error(self, msg: str) -> None:
        log.error(clean_error(msg))


def fetch_info(url: str) -> MediaInfo:
    """Detecta si el enlace es canción o playlist y devuelve su lista de pistas."""
    kind = classify_url(url)
    if kind is None:
        raise ValueError("El enlace no parece ser un video o una playlist de YouTube.")
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "noplaylist": kind == "video",
        "format": "bestaudio/best",
        "logger": _YdlLogger(),
        "js_runtimes": _JS_RUNTIMES,
    }
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(normalize_url(url), download=False)

    if info.get("_type") == "playlist" or "entries" in info:
        tracks = []
        for i, entry in enumerate(info.get("entries") or [], 1):
            if not entry or not entry.get("id"):
                continue
            title = entry.get("title") or entry["id"]
            available = (
                title.lower() not in _UNAVAILABLE_TITLES
                and entry.get("availability") not in ("private", "premium_only", "subscriber_only")
            )
            tracks.append(Track(
                id=entry["id"],
                title=title,
                url=f"https://www.youtube.com/watch?v={entry['id']}",
                uploader=entry.get("channel") or entry.get("uploader") or "",
                duration=entry.get("duration"),
                index=i,
                available=available,
            ))
        uploader = info.get("channel") or info.get("uploader") or ""
        return MediaInfo("playlist", info.get("title") or "Playlist", tracks, uploader)

    track = Track(
        id=info["id"],
        title=info.get("title") or info["id"],
        url=f"https://www.youtube.com/watch?v={info['id']}",
        uploader=info.get("channel") or info.get("uploader") or "",
        duration=info.get("duration"),
    )
    return MediaInfo("video", track.title, [track], track.uploader)


class Downloader:
    """Descarga una lista de pistas de forma secuencial. Pensado para correr en un hilo aparte.

    Comunica el avance mediante `emit(evento, *args)`:
      ("track_start", pos, total, título)
      ("progress", fracción_pista, fracción_total)
      ("status", texto)
      ("track_done", pos, estado, detalle)   estado: ok | skipped | failed | cancelled
      ("finished", estadísticas, cancelado)
    """

    def __init__(self, history: History, emit: Callable[..., None], cancel_event: threading.Event,
                 ffmpeg: str | None = None):
        self.history = history
        self.emit = emit
        self.cancel = cancel_event
        self.ffmpeg = ffmpeg or "ffmpeg"
        self._pos = 0
        self._total = 1
        self._last_frac = -1.0

    def run(self, job: DownloadJob) -> None:
        stats = {"ok": 0, "skipped": 0, "failed": 0, "failures": []}
        cancelled = False
        self._total = len(job.tracks) or 1
        try:
            job.dest_dir.mkdir(parents=True, exist_ok=True)
            for pos, track in enumerate(job.tracks):
                if self.cancel.is_set():
                    cancelled = True
                    break
                self._pos = pos
                self._last_frac = -1.0
                self.emit("track_start", pos, len(job.tracks), track.title)
                self._set_progress(0.0)
                try:
                    status, detail = self._process(track, job)
                except DownloadCancelled:
                    self.emit("track_done", pos, "cancelled", "Cancelada")
                    cancelled = True
                    break
                except Exception as exc:  # error inesperado: se registra y se sigue
                    log.exception("Error inesperado con %s", track.url)
                    status, detail = "failed", clean_error(exc)

                stats[status] += 1
                if status == "failed":
                    stats["failures"].append((track.title, detail))
                    log.error("Omitida '%s' (%s): %s", track.title, track.url, detail)
                self.emit("track_done", pos, status, detail)
                self._set_progress(1.0)
        except Exception as exc:
            log.exception("Fallo general de la descarga")
            stats["failures"].append(("General", clean_error(exc)))
        self.emit("finished", stats, cancelled)

    # --- Descarga de una pista -------------------------------------------------

    def _process(self, track: Track, job: DownloadJob) -> tuple[str, str]:
        if job.skip_downloaded and self.history.has(track.id):
            return "skipped", "Ya descargada anteriormente"

        tmp = Path(tempfile.mkdtemp(prefix="soundbox-"))
        try:
            try:
                with YoutubeDL(self._ydl_opts(tmp, job.bitrate)) as ydl:
                    info = ydl.extract_info(track.url, download=True)
            except DownloadError as exc:
                return "failed", clean_error(exc)
            if not info:
                return "failed", "No se obtuvo información del video"

            mp3 = tmp / f"{info['id']}.mp3"
            if not mp3.exists():
                found = list(tmp.glob("*.mp3"))
                if not found:
                    return "failed", "La conversión a MP3 no generó ningún archivo"
                mp3 = found[0]

            self.emit("status", "Escribiendo metadatos…")
            artist, title = parse_artist_title(info)
            year = info.get("release_year") or (info.get("upload_date") or "")[:4] or None
            write_tags(
                mp3,
                title=title,
                artist=artist,
                album=job.album or info.get("album"),
                track_number=track.index if job.album else None,
                year=str(year) if year else None,
                cover=self._make_cover(tmp, info["id"]),
                compilation=bool(job.album),
            )

            target = job.dest_dir / f"{sanitize_filename(f'{artist} - {title}')}.mp3"
            if target.exists():
                self.history.add(track.id, title=title, artist=artist, path=str(target))
                return "skipped", f"El archivo ya existía: {target.name}"
            shutil.move(str(mp3), target)
            self.history.add(track.id, title=title, artist=artist, path=str(target), bitrate=job.bitrate)
            return "ok", target.name
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def _ydl_opts(self, tmp: Path, bitrate: int) -> dict:
        opts = {
            "format": "bestaudio/best",
            "outtmpl": str(tmp / "%(id)s.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "noprogress": True,
            "logger": _YdlLogger(),
            "js_runtimes": _JS_RUNTIMES,
            "writethumbnail": True,
            "retries": 5,
            "fragment_retries": 5,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": str(bitrate),
            }],
            "progress_hooks": [self._on_progress],
            "postprocessor_hooks": [self._on_postprocess],
        }
        if self.ffmpeg != "ffmpeg":
            opts["ffmpeg_location"] = self.ffmpeg
        return opts

    def _make_cover(self, tmp: Path, video_id: str) -> bytes | None:
        """Convierte la miniatura a JPEG cuadrado (recorte central) para usarla como carátula."""
        thumb = next((p for p in tmp.glob(f"{video_id}.*")
                      if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")), None)
        if thumb is None:
            return None
        cover = tmp / "cover.jpg"
        try:
            subprocess.run(
                [self.ffmpeg, "-y", "-loglevel", "error", "-i", str(thumb),
                 "-vf", "crop='min(iw,ih)':'min(iw,ih)'", "-q:v", "2", str(cover)],
                check=True, capture_output=True, timeout=30,
            )
            return cover.read_bytes()
        except (OSError, subprocess.SubprocessError):
            log.warning("No se pudo procesar la carátula de %s", video_id)
            return thumb.read_bytes() if thumb.suffix.lower() in (".jpg", ".jpeg") else None

    # --- Hooks de progreso -----------------------------------------------------

    def _set_progress(self, frac: float) -> None:
        # Se limita la frecuencia de eventos para no saturar la interfaz.
        if frac < 1.0 and abs(frac - self._last_frac) < 0.005:
            return
        self._last_frac = frac
        self.emit("progress", frac, (self._pos + frac) / self._total)

    def _on_progress(self, d: dict) -> None:
        if self.cancel.is_set():
            raise DownloadCancelled()
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                self._set_progress(min(d.get("downloaded_bytes", 0) / total, 1.0) * 0.9)
        elif d["status"] == "finished":
            self._set_progress(0.9)

    def _on_postprocess(self, d: dict) -> None:
        if self.cancel.is_set():
            raise DownloadCancelled()
        if d["status"] == "started" and d.get("postprocessor") == "ExtractAudio" and self._last_frac < 0.95:
            self._set_progress(0.95)
            self.emit("status", "Convirtiendo a MP3…")
