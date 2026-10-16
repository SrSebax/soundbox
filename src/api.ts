export type Track = {
  id: string;
  title: string;
  url: string;
  uploader: string;
  duration: number | null;
  index: number;
  available: boolean;
  downloaded: boolean;
};

export type Media = {
  url: string;
  kind: "video" | "playlist";
  title: string;
  uploader: string;
  tracks: Track[];
};

export type TrackStatus = "pending" | "downloading" | "ok" | "skipped" | "failed" | "cancelled";

export type JobTrack = {
  key: number;
  title: string;
  status: TrackStatus;
  detail: string;
  error: string;
  progress: number;
};

export type LogEntry = { time: string; level: "info" | "ok" | "error"; msg: string };

export type JobState = {
  job_id: number;
  running: boolean;
  cancelling: boolean;
  url: string | null;
  title: string | null;
  dest: string | null;
  bitrate: number | null;
  tracks: JobTrack[];
  current: number | null;
  track_progress: number;
  overall: number;
  phase: string;
  summary: { ok: number; skipped: number; failed: number; cancelled: boolean } | null;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  log: LogEntry[];
};

export type Settings = { dest_dir: string; bitrate: number; skip_downloaded: boolean };

export type Health = { version: string; ffmpeg: boolean; js_runtimes: string[]; history: number };

export type HistoryItem = {
  id: string;
  title: string;
  artist: string;
  path: string;
  bitrate?: number;
  date: string;
};

export type DirListing = { path: string; parent: string | null; home: string; dirs: string[] };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
    } catch {
      /* respuesta sin JSON */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  health: () => request<Health>("/api/health"),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (patch: Partial<Settings>) => request<Settings>("/api/settings", json("PUT", patch)),
  info: (url: string) => request<Media>(`/api/info?url=${encodeURIComponent(url)}`),
  download: (body: {
    url: string;
    kind: string;
    title: string;
    tracks: (Track & { key: number })[];
    dest_dir: string;
    bitrate: number;
    skip_downloaded: boolean;
  }) => request<{ ok: boolean; dest: string }>("/api/download", json("POST", body)),
  cancel: () => request<{ ok: boolean }>("/api/cancel", { method: "POST" }),
  history: () => request<HistoryItem[]>("/api/history"),
  removeHistory: (id: string) => request<{ ok: boolean }>(`/api/history/${encodeURIComponent(id)}`, { method: "DELETE" }),
  openFolder: (path: string) => request<{ ok: boolean }>("/api/open", json("POST", { path })),
  listDirs: (path?: string) =>
    request<DirListing>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  mkdir: (path: string, name: string) => request<{ path: string }>("/api/fs/mkdir", json("POST", { path, name })),
};

/** Detección rápida en el cliente; el servidor hace la detección definitiva. */
export function looksLikeYouTube(text: string): boolean {
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export const thumbnail = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

export function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Tamaño aproximado de un MP3 CBR: duración × bitrate. */
export const estimateBytes = (seconds: number, kbps: number) => (seconds * kbps * 1000) / 8;

/**
 * Tiempo aproximado de descarga + conversión. Heurística: ~4 s de preparación por canción,
 * descarga a ~1,5 MB/s del audio original (~130 kbps) y conversión ~60× más rápida que tiempo real.
 */
export function estimateSeconds(durations: (number | null)[]): number {
  return durations.reduce<number>((acc, d) => {
    const dur = d ?? 210;
    const download = estimateBytes(dur, 130) / 1_500_000;
    return acc + 4 + download + dur / 60;
  }, 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
