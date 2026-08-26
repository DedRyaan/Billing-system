import { defineConfig } from "vitest/config";
import path from "path";

// Edge-function dual-runtime suites: Node/vitest importing Deno-targeted
// handlers with injected deps. Deliberately NO globalSetup (root config
// requires a local Supabase stack these pure handler tests never touch).
export default defineConfig({
  resolve: {
    alias: {
      "@billing/gst": path.resolve(__dirname, "../../packages/gst/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["**/test.ts"],
  },
});
