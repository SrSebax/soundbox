import { useEffect, useState } from "react";
import { api, type DirListing } from "./api";
import { IconFolder, IconX } from "./icons";

type Props = {
  initialPath: string;
  onSelect: (path: string) => void;
  onClose: () => void;
};

/** Explorador de carpetas del equipo (vía API local), ya que el navegador no expone rutas reales. */
export default function FolderPicker({ initialPath, onSelect, onClose }: Props) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const open = async (path?: string) => {
    try {
      setListing(await api.listDirs(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      if (!listing) setListing(await api.listDirs().catch(() => null));
    }
  };

  useEffect(() => {
    open(initialPath || undefined);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createFolder = async () => {
    if (!listing || !newName.trim()) return;
    try {
      const { path } = await api.mkdir(listing.path, newName.trim());
      setNewName("");
      await open(path);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Elegir carpeta" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Carpeta de destino</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconX />
          </button>
        </header>

        <div className="picker-path">
          <button className="btn ghost small" disabled={!listing?.parent} onClick={() => open(listing!.parent!)}>
            ↑ Subir
          </button>
          <button className="btn ghost small" onClick={() => open(listing?.home)}>Inicio</button>
          <code title={listing?.path}>{listing?.path ?? "…"}</code>
        </div>

        {error && <p className="error-text">{error}</p>}

        <ul className="picker-list">
          {listing?.dirs.length === 0 && <li className="muted">Sin subcarpetas</li>}
          {listing?.dirs.map((name) => (
            <li key={name}>
              <button onDoubleClick={() => onSelect(`${listing.path}/${name}`)} onClick={() => open(`${listing.path}/${name}`)}>
                <IconFolder size={16} /> {name}
              </button>
            </li>
          ))}
        </ul>

        <div className="picker-new">
          <input
            className="input"
            value={newName}
            placeholder="Nueva carpeta…"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()}
          />
          <button className="btn ghost small" onClick={createFolder} disabled={!newName.trim()}>Crear</button>
        </div>

        <footer className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!listing} onClick={() => listing && onSelect(listing.path)}>
            Usar esta carpeta
          </button>
        </footer>
      </div>
    </div>
  );
}
