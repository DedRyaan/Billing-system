// bootstrap-status - the D-73 first-run probe (plan 03-03).
//
// Mirrors bootstrap-super-admin's structure (deps-injected service client,
// dual-runtime). Anon callers cannot read profiles under RLS - so a server-
// truth probe needs service role. This function answers exactly ONE question
// with the smallest possible surface:
//
//   POST /bootstrap-status -> { bootstrapped: boolean }
//
// head:true + count:"exact" transfers zero rows; no payload is accepted; no
// PII crosses the boundary (T-3-11: stateless single count behind platform
// rate limits, same accepted posture as the other pre-auth functions).
//
// Dual-runtime note: bare @supabase/supabase-js import resolves in Deno 2 and
// Node/vitest, where tests import handleBootstrapStatus() with injected deps.

import { createClient as supabaseCreateClient, type SupabaseClient } from "@supabase/supabase-js";

export interface BootstrapStatusDeps {
  env?: Record<string, string | undefined>;
  createServiceClient?: (url: string, serviceKey: string) => SupabaseClient;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface CountResult {
  count: number | null;
  error: { message?: string } | null;
}

export async function handleBootstrapStatus(
  req: Request,
  deps: BootstrapStatusDeps = {},
): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: { code: "method_not_allowed" } }, 405);
  }

  const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  const env = deps.env ?? proc.process?.env ?? {};
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return json({ error: { code: "server_misconfigured" } }, 500);
  }

  try {
    const service = deps.createServiceClient
      ? deps.createServiceClient(supabaseUrl, serviceKey)
      : supabaseCreateClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

    // Awaitable PostgREST builder: head:true + exact count, zero row transfer.
    const result = (await Promise.resolve(
      service.from("profiles").select("id", { count: "exact", head: true }),
    )) as CountResult;
    if (result.error) {
      return json({ error: { code: "probe_failed" } }, 500);
    }
    return json({ bootstrapped: (result.count ?? 0) > 0 }, 200);
  } catch (_err) {
    // Construction or transport failure - network-class outcome, never a hang.
    return json({ error: { code: "network" } }, 502);
  }
}

const denoGlobal = globalThis as unknown as {
  Deno?: { serve: (handler: (req: Request) => Promise<Response>) => void };
};
denoGlobal.Deno?.serve((req: Request) => handleBootstrapStatus(req));
