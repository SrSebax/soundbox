import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Health, type JobState, type Settings } from "./api";
import Downloads from "./Downloads";
import FolderPicker from "./FolderPicker";
import HistoryPage from "./HistoryPage";
import SettingsPage from "./SettingsPage";
import { IconClock, IconDownload, IconGear, IconInstagram, IconPlay } from "./icons";

type Page = "downloads" | "history" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("downloads");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [connected, setConnected] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refreshHealth = () => api.health().then(setHealth).catch(() => undefined);

  // Carga inicial y suscripción a eventos del servidor (SSE).
  useEffect(() => {
    api.settings().then(setSettings).catch(() => setConnected(false));
    refreshHealth();
    const source = new EventSource("/api/events");
    source.onmessage = (e) => {
      setConnected(true);
      setJob(JSON.parse(e.data));
    };
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, []);

  // Al terminar una descarga se refrescan el historial y el contador.
  const wasRunning = useRef(false);
  useEffect(() => {
    const running = job?.running ?? false;
    if (wasRunning.current && !running) {
      setHistoryVersion((v) => v + 1);
      refreshHealth();
    }
    wasRunning.current = running;
  }, [job?.running]);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    api.saveSettings(patch).catch((e) => setError((e as Error).message));
  };

  const running = job?.running ?? false;

  const navItem = (id: Page, label: string, icon: ReactNode, extra?: ReactNode) => (
    <button className={`nav-item ${page === id ? "active" : ""}`} onClick={() => setPage(id)}>
      {icon}
      <span>{label}</span>
      {extra}
    </button>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo">
            <IconPlay size={16} />
          </span>
          <span className="brand-name">Soundbox</span>
        </div>

        <nav className="nav">
          {navItem("downloads", "Descargas", <IconDownload />, running && <span className="nav-dot" />)}
          {navItem("history", "Historial", <IconClock />, health ? <span className="nav-count">{health.history}</span> : null)}
        </nav>

        <div className="sidebar-bottom">
          {navItem("settings", "Ajustes", <IconGear />)}
          <a
            className="credit"
            href="https://www.instagram.com/sebax_lond/"
            target="_blank"
            rel="noopener noreferrer"
            title="Instagram de Sebas Lon"
          >
            <span className="credit-icon">
              <IconInstagram size={18} />
            </span>
            <span className="credit-text">
              <span>Creado por</span>
              <strong>Sebas Lon</strong>
              <em>@sebax_lond</em>
            </span>
          </a>
          <div className="sidebar-foot">
            <span className={`dot ${health ? (health.ffmpeg ? "ok" : "bad") : ""}`} />
            <span>Soundbox {health ? (health.ffmpeg ? "Conectado" : "No conectado") : "…"}</span>
            <span className="foot-version">v{health?.version ?? "1.0.0"}</span>
          </div>
        </div>
      </aside>

      <main className="main">
        {!connected && (
          <div className="banner">No hay conexión con el servidor de Soundbox. ¿Está corriendo `npm run dev`?</div>
        )}
        {health && !health.ffmpeg && (
          <div className="banner">FFmpeg no está instalado o no está en el PATH. Es necesario para convertir a MP3.</div>
        )}
        {error && (
          <div className="banner" onClick={() => setError(null)}>
            {error}
          </div>
        )}

        <div hidden={page !== "downloads"}>
          <Downloads
            job={job}
            settings={settings}
            health={health}
            updateSettings={updateSettings}
            onPickFolder={() => setPickerOpen(true)}
          />
        </div>
        <div hidden={page !== "history"}>
          <HistoryPage version={historyVersion} onChanged={refreshHealth} />
        </div>
        <div hidden={page !== "settings"}>
          <SettingsPage
            settings={settings}
            health={health}
            running={running}
            updateSettings={updateSettings}
            onPickFolder={() => setPickerOpen(true)}
          />
        </div>
      </main>

      {pickerOpen && settings && (
        <FolderPicker
          initialPath={settings.dest_dir}
          onClose={() => setPickerOpen(false)}
          onSelect={(path) => {
            updateSettings({ dest_dir: path });
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
