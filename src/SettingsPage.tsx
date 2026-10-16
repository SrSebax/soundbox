import type { Health, Settings } from "./api";
import { IconFolder } from "./icons";

type Props = {
  settings: Settings | null;
  health: Health | null;
  running: boolean;
  updateSettings: (patch: Partial<Settings>) => void;
  onPickFolder: () => void;
};

const QUALITIES = [
  { value: 320, hint: "Alta" },
  { value: 192, hint: "Estándar" },
  { value: 128, hint: "Ligera" },
];

export default function SettingsPage({ settings, health, running, updateSettings, onPickFolder }: Props) {
  return (
    <div className="page">
      <h1 className="page-title">Ajustes</h1>

      <section className="panel settings">
        <div className="setting">
          <div>
            <h3>Carpeta de destino</h3>
            <p className="hint">Las playlists se guardan en una subcarpeta con su nombre.</p>
          </div>
          <div className="folder-row">
            <input
              className="input"
              value={settings?.dest_dir ?? ""}
              disabled={running}
              onChange={(e) => updateSettings({ dest_dir: e.target.value })}
            />
            <button className="btn ghost" disabled={running} onClick={onPickFolder}>
              <IconFolder size={16} /> Elegir…
            </button>
          </div>
        </div>

        <div className="setting">
          <div>
            <h3>Calidad por defecto</h3>
            <p className="hint">Bitrate del MP3 generado.</p>
          </div>
          <div className="quality-grid">
            {QUALITIES.map((q) => (
              <button
                key={q.value}
                className={`quality ${settings?.bitrate === q.value ? "active" : ""}`}
                disabled={running}
                onClick={() => updateSettings({ bitrate: q.value })}
              >
                <strong>{q.value} kbps</strong>
                <span>{q.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="setting inline">
          <div>
            <h3>Omitir canciones ya descargadas</h3>
            <p className="hint">Usa el historial para no descargar dos veces la misma canción.</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings?.skip_downloaded ?? true}
              disabled={running}
              onChange={(e) => updateSettings({ skip_downloaded: e.target.checked })}
            />
            <span />
          </label>
        </div>
      </section>

      <section className="panel settings">
        <div className="setting inline">
          <h3>FFmpeg</h3>
          <span className={`status-tag ${health?.ffmpeg ? "ok" : "bad"}`}>{health?.ffmpeg ? "Instalado" : "No encontrado"}</span>
        </div>
        <div className="setting inline">
          <h3>Runtime de JavaScript para yt-dlp</h3>
          <span className={`status-tag ${health?.js_runtimes.length ? "ok" : "warn"}`}>
            {health?.js_runtimes.length ? health.js_runtimes.join(", ") : "Ninguno (recomendado: Deno o Node)"}
          </span>
        </div>
        <div className="setting inline">
          <h3>Versión</h3>
          <span className="muted">Soundbox {health?.version ?? ""}</span>
        </div>
      </section>
    </div>
  );
}
