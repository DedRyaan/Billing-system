import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Package-local headless runner (jsdom) - zero network, zero browser E2E.
// The router plugin participates so the generated route tree exists before
// tests import it; generation writes src/routeTree.gen.ts (gitignored).
export default defineConfig({
  plugins: [TanStackRouterVite({ target: "react", verbose: false }), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/lib/test/setup.ts"],
  },
});
