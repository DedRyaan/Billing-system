import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// File-based typed routing (D-68): the router plugin generates
// src/routeTree.gen.ts (gitignored, typechecked when present).
// Tailwind v4 CSS-first tokens live in src/styles/tokens.css (D-69).
export default defineConfig({
  plugins: [TanStackRouterVite(), tailwindcss(), react()],
  server: {
    // Matches tauri.conf.json devUrl - strict so Tauri never races a drifted port.
    port: 5173,
    strictPort: true,
  },
});
