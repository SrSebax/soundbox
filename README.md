# Soundbox

Aplicación web de uso personal para descargar audio de YouTube en MP3. Corre en el navegador y se arranca con npm.

- **Frontend:** React + Vite (`index.html`, `src/`)
- **Backend:** Python 3 + FastAPI, con yt-dlp usado como librería y FFmpeg para la conversión (`server.py` y módulos en la raíz)

## Requisitos

- Node.js 20+ y npm
- Python 3.10+
- FFmpeg en el PATH (macOS: `brew install ffmpeg`)
- Recomendado: Deno, Node o Bun. yt-dlp necesita un runtime de JavaScript para leer los formatos de YouTube; Soundbox usa el que encuentre.

## Uso

```bash
npm install      # instala dependencias JS y crea .venv con las de Python
npm run dev      # desarrollo: API en :8765 + Vite en http://localhost:5173
npm start        # compila el frontend y lo sirve todo en http://localhost:8765
```

Si Python no se detecta, define `SOUNDBOX_PYTHON=/ruta/a/python3` y ejecuta `npm run setup`.

1. Pega un enlace (Cmd/Ctrl+V lo analiza solo). Detecta si es canción o playlist.
2. En playlists, desmarca lo que no quieras. Las ya descargadas y las no disponibles aparecen desmarcadas.
3. Elige calidad (128 / 192 / 320 kbps) y carpeta (botón **Elegir…**). Las playlists se guardan en una subcarpeta con su nombre.
4. **Descargar** muestra el progreso por canción y el general. **Cancelar** detiene la descarga y limpia los temporales.

## Detalles

- Archivos `Artista - Título.mp3` sin caracteres inválidos; se quitan etiquetas como "(Official Video)".
- Metadatos ID3v2.3: título, artista, álbum (nombre de la playlist), pista, año y carátula (miniatura recortada en cuadrado).
- Los videos privados, eliminados o con error se saltan y quedan registrados en la página y en `~/.soundbox/soundbox.log`.
- Historial en `~/.soundbox/history.json`, indexado por ID de video. Borra una entrada para volver a descargarla.
- Los enlaces `watch?v=…&list=…` se tratan como playlist, salvo los mixes automáticos (`list=RD…`).
- El servidor solo escucha en `127.0.0.1` y rechaza peticiones con un `Host` distinto de localhost.

## Estructura

```
index.html, src/        frontend (React)
server.py               API (FastAPI): /api/info, /api/download, /api/cancel, /api/events (SSE), /api/fs
downloader.py           yt-dlp: análisis, descarga, conversión, progreso y cancelación (en un hilo aparte)
tagging.py              metadatos ID3 (mutagen)
history.py              historial de descargas
utils.py                detección de enlaces, nombres de archivo, artista/título
config.py               rutas, ajustes y log
scripts/                setup del entorno Python y lanzador
```
