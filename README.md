<div align="center">

# 🎧 Soundbox

**Descarga audio de YouTube en MP3 desde tu navegador.**
Canciones sueltas o playlists completas, con metadatos y carátula incluidos.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![yt-dlp](https://img.shields.io/badge/yt--dlp-FF0000?logo=youtube&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?logo=ffmpeg&logoColor=white)

</div>

---

## ✨ Características

- 🎵 **Canción o playlist** — pega un enlace y Soundbox detecta qué es.
- ✅ **Selección por canción** — en playlists elige qué descargar; las ya descargadas y las no disponibles vienen desmarcadas.
- 🎚️ **Calidad a elegir** — 128, 192 o 320 kbps.
- 🏷️ **Metadatos completos** — título, artista, álbum, pista, año y carátula cuadrada (ID3v2.3).
- 🧹 **Nombres limpios** — `Artista - Título.mp3`, sin "(Official Video)" ni caracteres inválidos.
- 📊 **Progreso en vivo** — por canción y general, vía Server-Sent Events.
- 🕘 **Historial** — buscable, evita descargar dos veces lo mismo.
- 🔒 **Solo local** — escucha en `127.0.0.1` y rechaza cualquier `Host` que no sea localhost.

## 📦 Requisitos

| Herramienta | Versión | Notas |
| --- | --- | --- |
| Node.js + npm | 20+ | |
| Python | 3.10+ | Si no se detecta, define `SOUNDBOX_PYTHON` |
| FFmpeg | — | Debe estar en el `PATH` (macOS: `brew install ffmpeg`) |
| Deno / Node / Bun | — | Recomendado: yt-dlp necesita un runtime JS para leer formatos de YouTube |

## 🚀 Inicio rápido

```bash
npm install      # instala dependencias JS y crea .venv con las de Python
npm start        # compila el frontend y abre http://localhost:8765
```

### Modo desarrollo

```bash
npm run dev      # API en :8765 + Vite con hot reload en http://localhost:5173
```

<details>
<summary>Otros comandos</summary>

| Comando | Qué hace |
| --- | --- |
| `npm run setup` | Recrea el entorno Python (`.venv` + `requirements.txt`) |
| `npm run build` | Compila el frontend en `dist/` |
| `npm run typecheck` | Revisa tipos con TypeScript |

Si Python no se detecta automáticamente:

```bash
SOUNDBOX_PYTHON=/ruta/a/python3 npm run setup
```

El puerto se cambia con `SOUNDBOX_PORT` (por defecto `8765`).

</details>

## 🎛️ Cómo se usa

1. **Pega un enlace** — `Cmd/Ctrl + V` lo analiza solo.
2. **Revisa la lista** — en playlists, desmarca lo que no quieras.
3. **Elige calidad y carpeta** — botón **Elegir…**. Las playlists se guardan en una subcarpeta con su nombre.
4. **Descargar** — sigue el progreso en vivo. **Cancelar** detiene todo y limpia los temporales.

## 🔍 Detalles

- Los videos privados, eliminados o con error se saltan y quedan registrados en la página y en el log.
- Los enlaces `watch?v=…&list=…` se tratan como playlist, salvo los mixes automáticos (`list=RD…`).
- Para volver a descargar una canción, borra su entrada del historial.

Todos los datos viven en `~/.soundbox/`:

```
~/.soundbox/
├── settings.json    carpeta destino, calidad, omitir descargadas
├── history.json     historial indexado por ID de video
└── soundbox.log     log rotativo de errores y eventos
```

## 🏗️ Arquitectura

```
┌──────────────────────┐   REST + SSE    ┌──────────────────────┐
│  Frontend (React)    │ ──────────────▶ │  Backend (FastAPI)   │
│  Vite · TypeScript   │ ◀────────────── │  127.0.0.1:8765      │
└──────────────────────┘                 └──────────┬───────────┘
                                                    │ hilo aparte
                                         ┌──────────▼───────────┐
                                         │ yt-dlp → FFmpeg → ID3│
                                         └──────────────────────┘
```

### Estructura

```
index.html, src/     frontend (React): descargas, historial, ajustes, selector de carpeta
server.py            API: /api/info, /api/download, /api/cancel, /api/events (SSE), /api/fs…
downloader.py        yt-dlp: análisis, descarga, conversión, progreso y cancelación
tagging.py           metadatos ID3 (mutagen)
history.py           historial de descargas
utils.py             detección de enlaces, nombres de archivo, artista/título
config.py            rutas, ajustes y log
scripts/             setup del entorno Python y lanzador
```

### API

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/health` | Versión, FFmpeg, runtimes JS y tamaño del historial |
| `GET` / `PUT` | `/api/settings` | Leer / guardar ajustes |
| `GET` | `/api/info?url=…` | Analiza un enlace (canción o playlist) |
| `POST` | `/api/download` | Inicia una descarga |
| `POST` | `/api/cancel` | Cancela la descarga en curso |
| `GET` | `/api/events` | Estado en vivo (SSE) |
| `GET` / `DELETE` | `/api/history[/{id}]` | Lista o borra entradas del historial |
| `GET` / `POST` | `/api/fs`, `/api/fs/mkdir` | Navega y crea carpetas |
| `POST` | `/api/open` | Abre una carpeta en el explorador del sistema |

---

<div align="center">

Hecho con ♥ por **Sebastian Londoño**

[![Instagram](https://img.shields.io/badge/Instagram-@sebax__lond-E4405F?logo=instagram&logoColor=white)](https://www.instagram.com/sebax_lond/)

<sub>Proyecto de uso personal. Descarga solo contenido que tengas derecho a guardar.</sub>

</div>

