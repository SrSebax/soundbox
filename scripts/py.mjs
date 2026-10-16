// Ejecuta el Python del entorno virtual del proyecto: `node scripts/py.mjs <args>`.
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const venvPython = process.platform === "win32"
  ? join(root, ".venv", "Scripts", "python.exe")
  : join(root, ".venv", "bin", "python");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const child = spawn(venvPython, process.argv.slice(2), { stdio: "inherit", cwd: root, env: process.env });
  child.on("error", () => {
    console.error("✗ No se encontró el entorno Python. Ejecuta `npm install` o `npm run setup`.");
    process.exit(1);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code) => process.exit(code ?? 0));
}
