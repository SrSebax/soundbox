import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  estimateBytes,
  estimateSeconds,
  formatBytes,
  formatDuration,
  formatEta,
  looksLikeYouTube,
  thumbnail,
  type Health,
  type JobState,
  type JobTrack,
  type Media,
  type Settings,
} from "./api";
import {
  IconAlert,
  IconCheckCircle,
  IconClock,
  IconDisk,
  IconDownload,
  IconFolder,
  IconLink,
  IconList,
  IconMusic,
  IconSearch,
} from "./icons";

const QUALITY_OPTIONS = [
  { value: 320, label: "320 kbps", hint: "Alta calidad" },
  { value: 192, label: "192 kbps", hint: "Estándar" },
  { value: 128, label: "128 kbps", hint: "Ligera" },
];

const STATUS_LABEL: Record<JobTrack["status"], string> = {
  pending: "En cola",
  downloading: "Descargando",
  ok: "Descargada",
  skipped: "Omitida",
  failed: "Error",
  cancelled: "Cancelada",
};

type Props = {
  job: JobState | null;
  settings: Settings | null;
  health: Health | null;
  updateSettings: (patch: Partial<Settings>) => void;
  onPickFolder: () => void;
};

const plural = (n: number) => `${n} ${n === 1 ? "canción" : "canciones"}`;
const cleanUploader = (name: string) => name.replace(/ - Topic$/, "");

export default function Downloads({ job, settings, health, updateSettings, onPickFolder }: Props) {
  const [url, setUrl] = useState("");
  const [media, setMedia] = useState<Media | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [range, setRange] = useState({ from: 1, to: 1 });
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const lastAnalyzed = useRef("");

  const skip = settings?.skip_downloaded ?? true;
  const bitrate = settings?.bitrate ?? 192;
  const running = job?.running ?? false;
  const total = media?.tracks.length ?? 0;

  // Reloj para el tiempo restante mientras hay una descarga en curso.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [running]);

  const rangeSelection = (m: Media, from: number, to: number, skipDownloaded = skip) =>
    new Set(
      m.tracks.flatMap((t, i) =>
        i + 1 >= from && i + 1 <= to && t.available && !(skipDownloaded && t.downloaded) ? [i] : [],
      ),
    );

  const analyze = async (raw: string = url) => {
    const text = raw.trim();
    if (!text || analyzing) return;
    if (!looksLikeYouTube(text)) {
      setError("Ese enlace no es de YouTube. Pega el enlace de un video o de una playlist.");
      return;
    }
    setError(null);
    setAnalyzing(true);
    lastAnalyzed.current = text;
    try {
      const m = await api.info(text);
      setMedia(m);
      setRange({ from: 1, to: m.tracks.length });
      setSelected(rangeSelection(m, 1, m.tracks.length));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  // Al terminar una descarga de este enlace, marca como descargadas las pistas correspondientes.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!job) return;
    if (wasRunning.current && !job.running && media && job.url === media.url) {
      const done = new Set(job.tracks.filter((t) => t.status === "ok" || t.status === "skipped").map((t) => t.key));
      setMedia({ ...media, tracks: media.tracks.map((t, i) => (done.has(i) ? { ...t, downloaded: true } : t)) });
      setSelected((prev) => new Set([...prev].filter((i) => !done.has(i))));
    }
    wasRunning.current = job.running;
  }, [job, media]);

  const jobForMedia = job && media && job.url === media.url && job.tracks.length > 0 ? job : null;
  const statusByKey = useMemo(() => {
    const map = new Map<number, JobTrack>();
    jobForMedia?.tracks.forEach((t) => map.set(t.key, t));
    return map;
  }, [jobForMedia]);

  const availableIdx = media ? media.tracks.flatMap((t, i) => (t.available ? [i] : [])) : [];
  const allSelected = availableIdx.length > 0 && availableIdx.every((i) => selected.has(i));
  const unavailable = total - availableIdx.length;

  // Estimaciones de peso y tiempo para la selección actual.
  const estimate = useMemo(() => {
    if (!media) return null;
    const durations = [...selected].map((i) => media.tracks[i]?.duration ?? null);
    const known = durations.filter((d): d is number => !!d);
    const seconds = known.reduce((a, b) => a + b, 0);
    return {
      bytes: estimateBytes(seconds, bitrate),
      partial: known.length < durations.length,
      time: estimateSeconds(durations),
      length: seconds,
    };
  }, [media, selected, bitrate]);

  // Tiempo restante real a partir del avance de la descarga en curso.
  const remaining = useMemo(() => {
    if (!jobForMedia?.running || !jobForMedia.started_at) return null;
    const elapsed = now - jobForMedia.started_at;
    if (jobForMedia.overall > 0.03 && elapsed > 3) {
      return (elapsed * (1 - jobForMedia.overall)) / jobForMedia.overall;
    }
    const pending = jobForMedia.tracks.filter((t) => t.status === "pending" || t.status === "downloading");
    return estimateSeconds(pending.map((t) => media?.tracks[t.key]?.duration ?? null));
  }, [jobForMedia, now, media]);

  const toggle = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const toggleAll = () => {
    setRange({ from: 1, to: total });
    setSelected(allSelected ? new Set() : new Set(availableIdx));
  };

  const changeRange = (key: "from" | "to", value: number) => {
    if (!media) return;
    const v = Math.min(Math.max(1, Number.isFinite(value) ? value : 1), total);
    const next = { ...range, [key]: v };
    if (next.from > next.to) {
      if (key === "from") next.to = v;
      else next.from = v;
    }
    setRange(next);
    setSelected(rangeSelection(media, next.from, next.to));
  };

  const setSkip = (value: boolean) => {
    updateSettings({ skip_downloaded: value });
    if (media) setSelected(rangeSelection(media, range.from, range.to, value));
  };

  const startDownload = async () => {
    if (!media || !settings || selected.size === 0) return;
    setError(null);
    try {
      await api.download({
        url: media.url,
        kind: media.kind,
        title: media.title,
        tracks: [...selected].sort((a, b) => a - b).map((key) => ({ ...media.tracks[key], key })),
        dest_dir: settings.dest_dir,
        bitrate,
        skip_downloaded: skip,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openFolder = (path: string | null) => {
    if (path) api.openFolder(path).catch((e) => setError((e as Error).message));
  };

  const destPreview = useMemo(() => {
    if (!settings) return "";
    const folder = settings.dest_dir.split(/[\\/]/).filter(Boolean).pop() ?? settings.dest_dir;
    const sub = media?.kind === "playlist" ? `${media.title}/` : "";
    return `${folder}/${sub}Artista - Título.mp3`;
  }, [settings, media]);

  const failures = jobForMedia?.tracks.filter((t) => t.status === "failed") ?? [];
  const finished = jobForMedia && !jobForMedia.running && jobForMedia.summary;
  const current = jobForMedia?.running && jobForMedia.current !== null ? jobForMedia.tracks[jobForMedia.current] : null;
  const elapsedTotal =
    finished && jobForMedia.started_at && jobForMedia.finished_at ? jobForMedia.finished_at - jobForMedia.started_at : null;

  return (
    <div className="page">
      <header className="page-head">
        <h1 className="page-title">Descargas</h1>
        <p className="page-sub">Pega un enlace de YouTube y llévate el audio en MP3.</p>
      </header>

      <section className="panel url-panel">
        <form
          className="url-form"
          onSubmit={(e) => {
            e.preventDefault();
            analyze();
          }}
        >
          <div className="url-field">
            <IconLink size={18} />
            <input
              className="input url-input"
              value={url}
              placeholder="https://www.youtube.com/playlist?list=…"
              onChange={(e) => setUrl(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text").trim();
                if (text && text !== lastAnalyzed.current) setTimeout(() => analyze(text), 0);
              }}
              autoFocus
            />
          </div>
          <button type="submit" className="btn primary fetch-btn" disabled={analyzing || !url.trim()}>
            {analyzing ? <span className="spinner" /> : <IconSearch />}
            {analyzing ? "Analizando" : "Buscar"}
          </button>
        </form>
        {error && (
          <div className="alert error">
            <IconAlert size={18} />
            <div>
              <strong>No se pudo completar</strong>
              <p>{error}</p>
            </div>
          </div>
        )}
      </section>

      {!media && (
        <section className="panel empty">
          {analyzing ? (
            <>
              <div className="empty-icon pulse">
                <span className="spinner accent" />
              </div>
              <h3>Analizando enlace…</h3>
              <p>Leyendo la información del video o de la playlist.</p>
            </>
          ) : (
            <ol className="steps">
              <li>
                <span className="step-icon"><IconLink size={20} /></span>
                <strong>Pega un enlace</strong>
                <span>Una canción o una playlist completa. Se detecta sola.</span>
              </li>
              <li>
                <span className="step-icon"><IconList size={20} /></span>
                <strong>Elige las canciones</strong>
                <span>Desmarca las que no quieras y escoge la calidad.</span>
              </li>
              <li>
                <span className="step-icon"><IconDownload size={20} /></span>
                <strong>Descarga en MP3</strong>
                <span>Con título, artista, álbum y carátula incluidos.</span>
              </li>
            </ol>
          )}
        </section>
      )}

      {media && (
        <section className="panel media-panel">
          <div className="media-hero">
            <div className="hero-backdrop" style={{ backgroundImage: `url(${thumbnail(media.tracks[0]?.id ?? "")})` }} />
            <div className="cover">
              <img src={thumbnail(media.tracks[0]?.id ?? "")} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
              {media.kind === "playlist" && <span className="cover-badge">{plural(total)}</span>}
            </div>
            <div className="media-info">
              <span className="kind-tag">{media.kind === "playlist" ? "Playlist" : "Canción"}</span>
              <h2 title={media.title}>{media.title}</h2>
              <p className="media-meta">
                {media.uploader && (
                  <>
                    <span className="avatar">{cleanUploader(media.uploader).charAt(0).toUpperCase()}</span>
                    <span>{cleanUploader(media.uploader)}</span>
                    <span className="sep">·</span>
                  </>
                )}
                <span>
                  {media.kind === "playlist"
                    ? plural(total)
                    : formatDuration(media.tracks[0]?.duration ?? null) || "Duración desconocida"}
                </span>
                {unavailable > 0 && (
                  <>
                    <span className="sep">·</span>
                    <span className="warn-text">{unavailable} no disponibles</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="options-grid">
            <div className="option-block">
              <span className="label">Formato</span>
              <div className="format-tabs">
                <span className="format-tab active">
                  <IconMusic size={15} /> Audio MP3
                </span>
              </div>
            </div>
            <div className="option-block">
              <span className="label">Calidad</span>
              <div className="quality-grid" role="radiogroup" aria-label="Calidad">
                {QUALITY_OPTIONS.map((q) => (
                  <button
                    key={q.value}
                    role="radio"
                    aria-checked={bitrate === q.value}
                    className={`quality ${bitrate === q.value ? "active" : ""}`}
                    disabled={running}
                    onClick={() => updateSettings({ bitrate: q.value })}
                  >
                    <strong>{q.label}</strong>
                    <span>{q.hint}</span>
                    {estimate && estimate.length > 0 && (
                      <em>≈ {formatBytes(estimateBytes(estimate.length, q.value))}</em>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="range-row">
            {media.kind === "playlist" && (
              <>
                <span className="muted">Desde</span>
                <input
                  type="number"
                  className="input num"
                  min={1}
                  max={total}
                  value={range.from}
                  disabled={running}
                  onChange={(e) => changeRange("from", e.target.valueAsNumber)}
                />
                <span className="muted">hasta</span>
                <input
                  type="number"
                  className="input num"
                  min={1}
                  max={total}
                  value={range.to}
                  disabled={running}
                  onChange={(e) => changeRange("to", e.target.valueAsNumber)}
                />
                <label className="check">
                  <input type="checkbox" checked={allSelected} disabled={running} onChange={toggleAll} />
                  Seleccionar todo
                </label>
              </>
            )}
            <label className="check push">
              <input type="checkbox" checked={skip} disabled={running} onChange={(e) => setSkip(e.target.checked)} />
              Omitir ya descargadas
            </label>
          </div>

          <ul className="tracks">
            {media.tracks.map((t, i) => {
              const st = statusByKey.get(i);
              const size = t.duration ? formatBytes(estimateBytes(t.duration, bitrate)) : null;
              return (
                <li
                  key={`${t.id}-${i}`}
                  className={`row ${!t.available ? "unavailable" : ""} ${st ? `st-${st.status}` : ""} ${selected.has(i) ? "selected" : ""}`}
                >
                  <label>
                    <input type="checkbox" checked={selected.has(i)} disabled={running} onChange={() => toggle(i)} />
                    <span className="row-num">{i + 1}</span>
                    <span className="row-thumb">
                      {t.available && (
                        <img
                          src={thumbnail(t.id)}
                          alt=""
                          loading="lazy"
                          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                        />
                      )}
                      {st?.status === "ok" && (
                        <span className="thumb-overlay ok">
                          <IconCheckCircle size={20} />
                        </span>
                      )}
                      {st?.status === "failed" && (
                        <span className="thumb-overlay failed">
                          <IconAlert size={20} />
                        </span>
                      )}
                    </span>
                    <span className="row-meta">
                      <span className="row-title" title={t.title}>{t.title}</span>
                      {st?.status === "failed" ? (
                        <span className="row-sub error" title={st.error}>{st.detail}</span>
                      ) : st?.status === "skipped" ? (
                        <span className="row-sub">{st.detail}</span>
                      ) : (
                        <span className="row-sub">
                          {cleanUploader(t.uploader)}
                          {!t.available && <span className="warn-text"> · No disponible (privado o eliminado)</span>}
                          {t.available && t.downloaded && " · Ya descargada"}
                        </span>
                      )}
                    </span>
                    <span className="row-end">
                      {st && st.status !== "pending" ? (
                        <span className={`pill ${st.status}`}>
                          {st.status === "downloading" ? `${Math.round(st.progress * 100)}%` : STATUS_LABEL[st.status]}
                        </span>
                      ) : (
                        <>
                          {st?.status === "pending" && <span className="pill pending">En cola</span>}
                          {size && <span className="row-size">{size}</span>}
                          <span>{formatDuration(t.duration)}</span>
                        </>
                      )}
                    </span>
                  </label>
                  {st?.status === "downloading" && (
                    <div className="row-bar">
                      <div style={{ width: `${st.progress * 100}%` }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {jobForMedia?.running && (
            <div className="progress-card">
              <div className="progress-top">
                <div className="ellipsis">
                  <span className="muted">
                    Canción {(jobForMedia.current ?? 0) + 1} de {jobForMedia.tracks.length}
                  </span>
                  <strong className="ellipsis">{current?.title ?? jobForMedia.phase}</strong>
                </div>
                <div className="progress-stats">
                  <span className="phase">{jobForMedia.phase}</span>
                  <span className="big-pct">{Math.round(jobForMedia.overall * 100)}%</span>
                </div>
              </div>
              <div className="bar">
                <div style={{ width: `${jobForMedia.overall * 100}%` }} />
              </div>
              <div className="progress-foot">
                <span>
                  <IconClock size={14} /> Quedan ≈ {remaining !== null ? formatEta(remaining) : "—"}
                </span>
                <span>
                  {jobForMedia.tracks.filter((t) => t.status === "ok").length} descargadas
                  {failures.length > 0 && <span className="error-text-inline"> · {failures.length} con error</span>}
                </span>
              </div>
            </div>
          )}

          {finished && (
            <div className={`result-card ${jobForMedia.summary!.failed || jobForMedia.error ? "has-errors" : ""}`}>
              <div className="result-head">
                <span className="result-icon">
                  {jobForMedia.summary!.failed || jobForMedia.error ? <IconAlert size={22} /> : <IconCheckCircle size={22} />}
                </span>
                <div>
                  <strong>
                    {jobForMedia.summary!.cancelled
                      ? "Descarga cancelada"
                      : jobForMedia.summary!.failed || jobForMedia.error
                        ? "Descarga terminada con errores"
                        : "Descarga completada"}
                  </strong>
                  <p>
                    {jobForMedia.summary!.ok} descargadas · {jobForMedia.summary!.skipped} omitidas ·{" "}
                    {jobForMedia.summary!.failed} con error
                    {elapsedTotal !== null && ` · en ${formatEta(elapsedTotal)}`}
                  </p>
                </div>
                <button className="btn ghost" onClick={() => openFolder(jobForMedia.dest)}>
                  <IconFolder size={16} /> Abrir carpeta
                </button>
              </div>
              {jobForMedia.error && <p className="result-general">{jobForMedia.error}</p>}
              {failures.length > 0 && (
                <ul className="failure-list">
                  {failures.map((f) => (
                    <li key={f.key}>
                      <span className="failure-title">{f.title}</span>
                      <span className="failure-reason">{f.detail}</span>
                      {f.error && f.error !== f.detail && <code className="failure-tech">{f.error}</code>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="media-foot">
            <div className="foot-info">
              <div className="estimates">
                <span className="chip">
                  <IconMusic size={14} /> {plural(selected.size)}
                </span>
                <span className="chip" title="Peso aproximado de los MP3 según duración y calidad">
                  <IconDisk size={14} /> ≈ {estimate ? formatBytes(estimate.bytes) : "0 KB"}
                  {estimate?.partial && "+"}
                </span>
                <span className="chip" title="Tiempo aproximado de descarga y conversión">
                  <IconClock size={14} /> ≈ {estimate && selected.size ? formatEta(estimate.time) : "—"}
                </span>
              </div>
              <button className="dest" onClick={onPickFolder} disabled={running} title={settings?.dest_dir}>
                <IconFolder size={14} />
                <span className="ellipsis">{destPreview}</span>
              </button>
            </div>
            <div className="foot-actions">
              {running && (
                <button className="btn danger" onClick={() => api.cancel()} disabled={job?.cancelling}>
                  {job?.cancelling ? "Cancelando…" : "Cancelar"}
                </button>
              )}
              <button
                className="btn primary big"
                disabled={running || selected.size === 0 || !settings?.dest_dir || !health?.ffmpeg}
                onClick={startDownload}
              >
                {running ? <span className="spinner" /> : <IconDownload />}
                {running ? "Descargando…" : `Descargar ${plural(selected.size)}`}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
