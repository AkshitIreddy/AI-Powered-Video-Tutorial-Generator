import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { strictPort: true, port: 1438 },
  preview: { strictPort: true, port: 4178 },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2023", sourcemap: true },
});
