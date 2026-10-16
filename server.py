"""Servidor HTTP de Soundbox: API REST + eventos SSE + archivos estáticos del frontend."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import time
import threading
import webbrowser
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import __version__, HISTORY_FILE, LOG_FILE, load_settings, save_settings, setup_logging
from downloader import _JS_RUNTIMES, Downloader, DownloadJob, Track, fetch_info
from history import History
from utils import clean_error, explain_error, normalize_url, sanitize_filename

log = logging.getLogger("soundbox")

DIST_DIR = Path(__file__).resolve().parent / "dist"
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
QUALITIES = {128, 192, 320}
MAX_LOG = 300


class JobManager:
    """Una única descarga a la vez (uso personal). Mantiene un estado que el frontend recibe por SSE."""

    def __init__(self, history: History):
        self.history = history
        self.ffmpeg = shutil.which("ffmpeg")
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._version = 0
        self._state = {
            "job_id": 0, "running": False, "cancelling": False, "url": None, "title": None,
            "dest": None, "bitrate": None, "tracks": [], "current": None,
            "track_progress": 0.0, "overall": 0.0, "phase": "", "summary": None, "log": [],
            "started_at": None, "finished_at": None, "error": None,
        }

    @property
    def running(self) -> bool:
        return self._state["running"]

    def snapshot(self) -> tuple[int, str]:
        with self._lock:
            return self._version, json.dumps(self._state, ensure_ascii=False)

    def _touch(self) -> None:
        self._version += 1

    def _log(self, msg: str, level: str = "info") -> None:
        entries = self._state["log"]
        entries.append({"time": datetime.now().strftime("%H:%M:%S"), "level": level, "msg": msg})
        del entries[:-MAX_LOG]

    def start(self, job: DownloadJob, url: str, title: str, keys: list[int]) -> None:
        with self._lock:
            if self._state["running"]:
                raise RuntimeError("Ya hay una descarga en curso.")
            self._cancel.clear()
            s = self._state
            s.update(
                job_id=s["job_id"] + 1, running=True, cancelling=False, url=url, title=title,
                dest=str(job.dest_dir), bitrate=job.bitrate, current=None, track_progress=0.0,
                overall=0.0, phase="Preparando…", summary=None, error=None,
                started_at=time.time(), finished_at=None,
                tracks=[{"key": k, "title": t.title, "status": "pending", "detail": "", "error": "", "progress": 0.0}
                        for k, t in zip(keys, job.tracks)],
            )
            self._log(f"Descargando {len(job.tracks)} canción(es) a {job.bitrate} kbps en {job.dest_dir}")
            self._touch()
        downloader = Downloader(self.history, self._on_event, self._cancel, self.ffmpeg)
        threading.Thread(target=downloader.run, args=(job,), daemon=True).start()

    def cancel(self) -> None:
        with self._lock:
            if not self._state["running"] or self._state["cancelling"]:
                return
            self._cancel.set()
            self._state.update(cancelling=True, phase="Cancelando…")
            self._log("Cancelando la descarga…")
            self._touch()

    def _on_event(self, kind: str, *args) -> None:
        with self._lock:
            s = self._state
            if kind == "track_start":
                pos = args[0]
                s.update(current=pos, track_progress=0.0, phase="Descargando…")
                s["tracks"][pos]["status"] = "downloading"
            elif kind == "progress":
                s["track_progress"], s["overall"] = args
                if s["current"] is not None:
                    s["tracks"][s["current"]]["progress"] = args[0]
            elif kind == "status":
                if not s["cancelling"]:
                    s["phase"] = args[0]
            elif kind == "track_done":
                pos, status, detail = args
                track = s["tracks"][pos]
                if status == "failed":
                    # detail: explicación legible; error: mensaje técnico original.
                    track["error"] = detail
                    detail = explain_error(detail)
                track.update(status=status, detail=detail, progress=1.0 if status == "ok" else track["progress"])
                if status == "ok":
                    self._log(f"✓ {detail}", "ok")
                elif status == "failed":
                    self._log(f"✗ {track['title']}: {detail}", "error")
                else:
                    self._log(f"↷ {track['title']}: {detail}")
            elif kind == "finished":
                stats, cancelled = args
                if cancelled:
                    for track in s["tracks"]:
                        if track["status"] == "pending":
                            track["status"] = "cancelled"
                general = [d for t, d in stats["failures"] if t == "General"]
                s["error"] = explain_error(general[0]) if general else None
                s.update(running=False, cancelling=False, current=None, phase="", finished_at=time.time(),
                         summary={"ok": stats["ok"], "skipped": stats["skipped"],
                                  "failed": stats["failed"], "cancelled": cancelled})
                if not cancelled:
                    s["overall"] = 1.0
                summary = f"{stats['ok']} descargadas · {stats['skipped']} omitidas · {stats['failed']} con error"
                self._log(("Descarga cancelada. " if cancelled else "Listo. ") + summary,
                          "error" if stats["failed"] else "ok")
                if stats["failed"]:
                    self._log(f"Detalle de errores en {LOG_FILE}", "error")
            self._touch()


setup_logging()
history = History(HISTORY_FILE)
manager = JobManager(history)
app = FastAPI(title="Soundbox", version=__version__)


@app.middleware("http")
async def only_localhost(request: Request, call_next):
    # Protección frente a DNS rebinding: solo se aceptan peticiones dirigidas a localhost.
    host = (request.headers.get("host") or "").lower()
    hostname = host.rsplit(":", 1)[0] if not host.endswith("]") else host
    if hostname not in ALLOWED_HOSTS:
        return PlainTextResponse("Host no permitido", status_code=403)
    return await call_next(request)


# --- Modelos ----------------------------------------------------------------------

class TrackIn(BaseModel):
    key: int
    id: str
    title: str
    url: str
    uploader: str = ""
    duration: float | None = None
    index: int = 1
    available: bool = True


class DownloadIn(BaseModel):
    url: str
    kind: str
    title: str
    tracks: list[TrackIn]
    dest_dir: str
    bitrate: int = 192
    skip_downloaded: bool = True


class SettingsIn(BaseModel):
    dest_dir: str | None = None
    bitrate: int | None = None
    skip_downloaded: bool | None = None


class OpenIn(BaseModel):
    path: str


class MkdirIn(BaseModel):
    path: str
    name: str


# --- API --------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {
        "version": __version__,
        "ffmpeg": bool(manager.ffmpeg),
        "js_runtimes": list(_JS_RUNTIMES),
        "history": len(history),
    }


@app.get("/api/settings")
def get_settings():
    return load_settings()


@app.put("/api/settings")
def put_settings(body: SettingsIn):
    settings = load_settings()
    patch = body.model_dump(exclude_none=True)
    if "bitrate" in patch and patch["bitrate"] not in QUALITIES:
        raise HTTPException(400, "Calidad no válida.")
    settings.update(patch)
    save_settings(settings)
    return settings


@app.get("/api/info")
def info(url: str):
    try:
        media = fetch_info(url)
    except Exception as exc:
        log.warning("No se pudo analizar %s: %s", url, clean_error(exc))
        raise HTTPException(400, explain_error(clean_error(exc)))
    return {
        "url": normalize_url(url),
        "kind": media.kind,
        "title": media.title,
        "uploader": media.uploader,
        "tracks": [{**t.__dict__, "downloaded": history.has(t.id)} for t in media.tracks],
    }


@app.get("/api/history")
def get_history():
    return history.items()


@app.delete("/api/history/{video_id}")
def delete_history(video_id: str):
    if not history.remove(video_id):
        raise HTTPException(404, "No está en el historial.")
    return {"ok": True}


@app.post("/api/download")
def download(body: DownloadIn):
    if body.bitrate not in QUALITIES:
        raise HTTPException(400, "Calidad no válida.")
    if not body.tracks:
        raise HTTPException(400, "No hay canciones seleccionadas.")
    if not manager.ffmpeg:
        raise HTTPException(400, "FFmpeg no está instalado o no está en el PATH.")
    dest = Path(body.dest_dir).expanduser()
    if not dest.is_absolute():
        raise HTTPException(400, "La carpeta de destino debe ser una ruta absoluta.")
    playlist = body.kind == "playlist"
    if playlist:
        dest = dest / sanitize_filename(body.title)
    try:
        dest.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise HTTPException(400, f"No se pudo crear la carpeta: {exc}")

    job = DownloadJob(
        tracks=[Track(**t.model_dump(exclude={"key"})) for t in body.tracks],
        dest_dir=dest,
        bitrate=body.bitrate,
        album=body.title if playlist else None,
        skip_downloaded=body.skip_downloaded,
    )
    try:
        manager.start(job, body.url, body.title, [t.key for t in body.tracks])
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return {"ok": True, "dest": str(dest)}


@app.post("/api/cancel")
def cancel():
    manager.cancel()
    return {"ok": True}


@app.get("/api/events")
async def events(request: Request):
    async def stream():
        last = -1
        idle = 0.0
        while not await request.is_disconnected():
            version, data = manager.snapshot()
            if version != last:
                last, idle = version, 0.0
                yield f"data: {data}\n\n"
            elif idle >= 15:
                idle = 0.0
                yield ": ping\n\n"
            await asyncio.sleep(0.25)
            idle += 0.25

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/open")
def open_folder(body: OpenIn):
    """Abre una carpeta en el explorador de archivos del sistema."""
    target = Path(body.path).expanduser()
    if not target.is_dir():
        raise HTTPException(404, "La carpeta no existe.")
    command = {"darwin": ["open"], "win32": ["explorer"]}.get(sys.platform, ["xdg-open"])
    try:
        subprocess.Popen([*command, str(target)])
    except OSError as exc:
        raise HTTPException(500, f"No se pudo abrir la carpeta: {exc}")
    return {"ok": True}


@app.get("/api/fs")
def list_dirs(path: str | None = None):
    """Lista subcarpetas para el selector de carpeta de destino."""
    target = Path(path).expanduser() if path else Path.home()
    try:
        target = target.resolve()
        if not target.is_dir():
            raise HTTPException(404, "La carpeta no existe.")
        dirs = []
        for child in target.iterdir():
            try:
                if child.is_dir() and not child.name.startswith("."):
                    dirs.append(child.name)
            except OSError:
                continue
    except PermissionError:
        raise HTTPException(403, "Sin permiso para leer esta carpeta.")
    return {
        "path": str(target),
        "parent": str(target.parent) if target.parent != target else None,
        "home": str(Path.home()),
        "dirs": sorted(dirs, key=str.lower),
    }


@app.post("/api/fs/mkdir")
def make_dir(body: MkdirIn):
    name = sanitize_filename(body.name)
    target = Path(body.path).expanduser() / name
    try:
        target.mkdir(parents=False, exist_ok=False)
    except FileExistsError:
        raise HTTPException(409, "Ya existe una carpeta con ese nombre.")
    except OSError as exc:
        raise HTTPException(400, str(exc))
    return {"path": str(target)}


if DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="web")


def main() -> None:
    import uvicorn

    port = int(os.environ.get("SOUNDBOX_PORT", "8765"))
    url = f"http://localhost:{port}"
    if "--open" in sys.argv:
        threading.Timer(1.2, webbrowser.open, args=(url,)).start()
    print(f"Soundbox en {url}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
