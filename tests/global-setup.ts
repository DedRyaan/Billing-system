// Global setup: assert the local Supabase stack is reachable before any test
// runs. Connection details come from `pnpm exec supabase status`.
import type { GlobalSetupContext } from "vitest/node";

declare module "vitest/node" {
  export interface ProvidedContext {
    supabaseLocalUrl: string;
    supabaseLocalAnonKey: string;
  }
}

export default async function (_context?: GlobalSetupContext): Promise<void> {
  const url = process.env.SUPABASE_LOCAL_URL;
  const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY;
  const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_KEY;

  if (!url || !anonKey || !serviceKey) {
    throw new Error(
      [
        "Local Supabase env vars are not set.",
        "",
        "Start the local stack and copy the printed values into your environment:",
        "  pnpm exec supabase start",
        "  pnpm exec supabase status",
        "",
        "Required variables:",
        "  SUPABASE_LOCAL_URL          <- API URL",
        "  SUPABASE_LOCAL_ANON_KEY     <- anon key",
        "  SUPABASE_LOCAL_SERVICE_KEY  <- service_role key",
      ].join("\n"),
    );
  }

  try {
    await fetch(new URL("/rest/v1/", url), {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new Error(
      `Local Supabase stack unreachable at ${url}. Is it running? Start it with: pnpm exec supabase start`,
      { cause },
    );
  }
}
