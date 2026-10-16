"""Utilidades: detección de enlaces, limpieza de nombres y títulos."""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import parse_qs, urlparse

YT_HOSTS = ("youtube.com", "youtu.be", "youtube-nocookie.com")

_RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL"} | {f"{p}{i}" for p in ("COM", "LPT") for i in range(1, 10)}

# Etiquetas típicas que ensucian el título: (Official Video), [Lyrics], (Audio Oficial)...
_NOISE = re.compile(
    r"\s*[\(\[][^\)\]]*\b(?:official|oficial|video|v[ií]deo|videoclip|audio|lyrics?|letra|"
    r"visuali[sz]er|hd|hq|4k|mv)\b[^\)\]]*[\)\]]",
    re.IGNORECASE,
)
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def normalize_url(url: str) -> str:
    url = url.strip()
    return url if "://" in url else f"https://{url}"


def classify_url(url: str) -> str | None:
    """Devuelve 'video', 'playlist' o None si no es un enlace de YouTube reconocible."""
    parsed = urlparse(normalize_url(url))
    host = (parsed.hostname or "").lower()
    if not any(host == h or host.endswith("." + h) for h in YT_HOSTS):
        return None
    query = parse_qs(parsed.query)
    list_id = query.get("list", [""])[0]
    # Las listas "RD..." son mixes automáticos casi infinitos: se trata el enlace como canción.
    if list_id and not list_id.startswith("RD"):
        return "playlist"
    if host.endswith("youtu.be") and parsed.path.strip("/"):
        return "video"
    if "v" in query or parsed.path.startswith(("/shorts/", "/live/", "/embed/")):
        return "video"
    return None


def sanitize_filename(name: str, max_len: int = 150) -> str:
    """Nombre de archivo válido en Windows, macOS y Linux."""
    name = unicodedata.normalize("NFC", name)
    name = re.sub(r"[/\\|]", "-", name)
    name = name.replace(":", " -").replace('"', "'")
    name = re.sub(r'[<>?*\x00-\x1f]', "", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    if name.upper() in _RESERVED_NAMES:
        name = f"_{name}"
    if len(name) > max_len:
        name = name[:max_len].rstrip(" .")
    return name or "Sin título"


def clean_title(title: str) -> str:
    title = _NOISE.sub("", title)
    return re.sub(r"\s+", " ", title).strip(" -–—|")


def _clean_artist(artist: str) -> str:
    artist = re.sub(r"\s*-\s*Topic$", "", artist)
    artist = re.sub(r"(?<=\w)VEVO$", "", artist)
    return artist.strip()


def parse_artist_title(info: dict) -> tuple[str, str]:
    """Obtiene (artista, título) a partir de la información de yt-dlp."""
    artists = info.get("artists") or ([info["artist"]] if info.get("artist") else [])
    track = info.get("track")
    if artists and track:
        return ", ".join(artists), clean_title(track)

    title = clean_title(info.get("title") or "")
    for sep in (" - ", " – ", " — ", " | "):
        if sep in title:
            artist, song = title.split(sep, 1)
            if artist.strip() and song.strip():
                return artist.strip(), clean_title(song)

    uploader = info.get("channel") or info.get("uploader") or "Desconocido"
    return _clean_artist(uploader), title or info.get("id", "Sin título")


def clean_error(error: Exception | str) -> str:
    msg = _ANSI.sub("", str(error)).strip()
    msg = re.sub(r"^ERROR:\s*", "", msg)
    msg = re.sub(r"^\[[\w:]+\]\s*[\w-]+:\s*", "", msg)
    return msg.splitlines()[0] if msg else "Error desconocido"


# Traducción de los errores más comunes de yt-dlp a una explicación clara.
_ERROR_HINTS = [
    (r"private video|video is private", "El video es privado."),
    (r"playlist does not exist|playlist.*(private|unavailable)", "La playlist no existe o es privada."),
    (r"sign in to confirm your age|age[- ]restricted|inappropriate for some users",
     "El video tiene restricción de edad y YouTube exige iniciar sesión."),
    (r"members[- ]only|join this channel", "El video es exclusivo para miembros del canal."),
    (r"copyright", "El video fue bloqueado por derechos de autor."),
    (r"not (made )?available in your country|geo.?restrict", "El video no está disponible en tu país."),
    (r"premieres? in|live event will begin|this live event|is upcoming",
     "Es un estreno o directo que todavía no ha comenzado."),
    (r"not a bot", "YouTube pidió verificar que no eres un bot. Espera un rato e inténtalo de nuevo."),
    (r"video unavailable|this video is unavailable|has been removed|deleted video|does not exist",
     "El video no está disponible o fue eliminado."),
    (r"http error 403|forbidden", "YouTube rechazó la descarga (error 403). Actualiza yt-dlp e inténtalo de nuevo."),
    (r"http error 429|too many requests", "Demasiadas solicitudes a YouTube. Espera unos minutos."),
    (r"requested format is not available|no video formats|only images are available",
     "YouTube no ofreció un formato de audio descargable para este video."),
    (r"ffmpeg|ffprobe|postprocessing|conversion failed", "Falló la conversión a MP3 con FFmpeg."),
    (r"no space left", "No hay espacio suficiente en el disco."),
    (r"permission denied|read-only file system", "No hay permiso para escribir en la carpeta de destino."),
    (r"timed out|timeout|connection|network is unreachable|getaddrinfo|name resolution|ssl",
     "Problema de conexión a internet."),
    (r"unsupported url", "El enlace no es compatible."),
]


def explain_error(msg: str) -> str:
    """Devuelve una explicación en español del error; si no se reconoce, el mensaje original."""
    for pattern, text in _ERROR_HINTS:
        if re.search(pattern, msg, re.IGNORECASE):
            return text
    return msg


def format_duration(seconds: float | None) -> str:
    if not seconds:
        return ""
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
