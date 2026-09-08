import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri v2 desktop frontend build (apps/desktop). devUrl 1420 matches
// src-tauri/tauri.conf.json; strictPort keeps the Rust host and Vite on the
// same origin assumption.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  base: "./",
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
