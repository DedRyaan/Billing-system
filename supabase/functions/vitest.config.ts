import { defineConfig } from "vitest/config";

// Edge-function dual-runtime suites: Node/vitest importing Deno-targeted
// handlers with injected deps. Deliberately NO globalSetup (root config
// requires a local Supabase stack these pure handler tests never touch).
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/test.ts"],
  },
});
