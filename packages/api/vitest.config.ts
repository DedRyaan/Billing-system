import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Package-local runner - deliberately NO globalSetup (gst precedent): this
// suite runs anywhere with zero infrastructure. Tests inject fake clients;
// no network, no Supabase env vars required.
export default defineConfig({
  resolve: {
    alias: {
      // Runtime bridge to the REAL Edge Function source for byte-equality
      // testing. Typechecking maps the same specifier to a local .d.ts stub
      // (see tsconfig paths) so the Deno-targeted file stays out of this
      // package's strict Node program.
      'auth-sign-in-source': fileURLToPath(
        new URL('../../supabase/functions/auth-sign-in/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
