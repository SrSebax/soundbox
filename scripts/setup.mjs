// Prepara el entorno Python (.venv + requirements.txt). Se ejecuta en `npm install`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { venvPython, root } from "./py.mjs";

const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit", cwd: root }).status === 0;
const has = (cmd) => spawnSync(cmd, ["-version"], { stdio: "ignore" }).status === 0;

function findPython() {
  const candidates = [process.env.SOUNDBOX_PYTHON, "python3.14", "python3.13", "python3.12",
    "python3.11", "python3.10", "python3", "python", "py"].filter(Boolean);
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ["-c", "import sys; print(sys.version_info >= (3, 10))"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim() === "True") return cmd;
  }
  return null;
}

if (!existsSync(venvPython)) {
  const python = findPython();
  if (!python) {
    console.error("✗ Soundbox necesita Python 3.10 o superior. Instálalo o define SOUNDBOX_PYTHON.");
    process.exit(1);
  }
  console.log(`→ Creando entorno Python con ${python}…`);
  if (!run(python, ["-m", "venv", join(root, ".venv")])) process.exit(1);
}

console.log("→ Instalando dependencias de Python…");
if (!run(venvPython, ["-m", "pip", "install", "-q", "--upgrade", "pip"]) ||
    !run(venvPython, ["-m", "pip", "install", "-q", "-r", "requirements.txt"])) {
  process.exit(1);
}

if (!has("ffmpeg")) {
  console.warn("⚠ FFmpeg no está en el PATH. Instálalo (macOS: brew install ffmpeg) para convertir a MP3.");
}
console.log("✓ Entorno de Soundbox listo.");
