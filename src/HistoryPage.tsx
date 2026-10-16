import { useEffect, useMemo, useState } from "react";
import { api, thumbnail, type HistoryItem } from "./api";
import { IconClock, IconSearch, IconTrash } from "./icons";

type Props = { version: number; onChanged: () => void };

const dateFormat = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });

export default function HistoryPage({ version, onChanged }: Props) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .history()
      .then(setItems)
      .catch((e) => setError((e as Error).message));

  useEffect(() => {
    load();
  }, [version]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!items || !q) return items ?? [];
    return items.filter((i) => `${i.artist} ${i.title}`.toLowerCase().includes(q));
  }, [items, query]);

  const remove = async (id: string) => {
    try {
      await api.removeHistory(id);
      setItems((prev) => prev?.filter((i) => i.id !== id) ?? null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Historial</h1>

      <section className="panel">
        <div className="history-head">
          <div className="search">
            <IconSearch size={16} />
            <input
              className="input"
              placeholder="Buscar por artista o título…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="muted">{items ? `${items.length} canciones` : ""}</span>
        </div>
        <p className="hint">Las canciones del historial se omiten al descargar. Quítalas para volver a descargarlas.</p>
        {error && <p className="error-text">{error}</p>}

        {items && filtered.length === 0 ? (
          <div className="empty compact">
            <div className="empty-icon">
              <IconClock size={22} />
            </div>
            <h3>{items.length ? "Sin resultados" : "Aún no hay descargas"}</h3>
          </div>
        ) : (
          <ul className="tracks history-list">
            {filtered.map((item) => (
              <li key={item.id} className="row">
                <div className="row-inner">
                  <span className="row-thumb">
                    <img src={thumbnail(item.id)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                  </span>
                  <span className="row-meta">
                    <span className="row-title" title={item.path}>{item.artist} — {item.title}</span>
                    <span className="row-sub">
                      {dateFormat.format(new Date(item.date))}
                      {item.bitrate ? ` · ${item.bitrate} kbps` : ""}
                    </span>
                  </span>
                  <button className="icon-btn danger" title="Quitar del historial" onClick={() => remove(item.id)}>
                    <IconTrash size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
