import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = process.env.SOUNDBOX_PORT ?? "8765";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: { "/api": `http://127.0.0.1:${API_PORT}` },
  },
});
