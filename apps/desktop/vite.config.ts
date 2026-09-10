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
    // The Rust host's build tree lives under src-tauri/. Vite's watcher would
    // otherwise try to watch target/'s artifacts while `cargo run` is writing
    // them, and an EBUSY on one of those files kills the watcher — which takes
    // vite down with it and fails `beforeDevCommand` before the window ever
    // opens. Tauri's own Vite template carries this line for the same reason.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
