import { defineConfig } from 'vitest/config';

// Package-local runner — deliberately NO globalSetup. The root vitest config
// requires Supabase env vars via tests/global-setup.ts; this pure engine must
// run anywhere with zero infrastructure (RESEARCH § Validation Architecture).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
