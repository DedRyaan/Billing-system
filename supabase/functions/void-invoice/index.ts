// void-invoice — server-side void with admin-only enforcement (Plan 04-03).
//
// Transitions an issued invoice to voided status. The admin role check lives
// inside the SECURITY DEFINER Postgres function void_invoice_fn() because
// current_user_role() returns NULL for service_role contexts (Assumption 9).
// Migration 0019 added the service-role void path on trg_document_transition.
//
// Flow:
//   1. JWT verify via GoTrue (auth.getUser on the bearer token)
//   2. zod-validate {invoice_id, business_id, void_reason}
//   3. RPC void_invoice_fn with p_caller_id from verified JWT
//   4. The Postgres function: checks admin role, voids invoice, creates
//      replacement draft with copied lines, writes audit trail
//   5. Map Postgres exceptions to HTTP status codes
//
// Postgres error code mapping:
//   no_data_found (P0002)           → 404 invoice_not_found_or_not_issued
//   insufficient_privilege (42501)  → 403 staff void attempt
//   check_violation (23514)         → 409 already voided
//
// Service-role key confinement: SUPABASE_SERVICE_ROLE_KEY is injected into
// the function runtime ONLY — it must never reach a client.
//
// Dual-runtime note: bare `zod` / `@supabase/supabase-js` imports resolve
// in Deno 2 (edge runtime) and under Node/vitest, where tests import
// handleVoidInvoice() directly with injected deps.

import {
  createClient as supabaseCreateClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema — single-command endpoint (no discriminated union needed)
// ---------------------------------------------------------------------------

const voidSchema = z.object({
  invoice_id: z.string().uuid(),
  business_id: z.string().uuid(),
  void_reason: z.string().min(1, "Void reason is required").max(500),
});

type VoidPayload = z.infer<typeof voidSchema>;

// ---------------------------------------------------------------------------
// Dependency injection — same pattern as invite-user / bootstrap
// ---------------------------------------------------------------------------

export interface VoidDeps {
  env?: Record<string, string | undefined>;
  createServiceClient?: (
    url: string,
    serviceKey: string,
  ) => SupabaseClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bearerToken(req: Request): string | null {
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

export async function handleVoidInvoice(
  req: Request,
  deps: VoidDeps = {},
): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: { code: "method_not_allowed" } }, 405);
  }

  try {
    // --- Environment ---
    const proc = globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    };
    const env = deps.env ?? proc.process?.env ?? {};
    const supabaseUrl = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return json({ error: { code: "server_misconfigured" } }, 500);
    }

    const service = deps.createServiceClient
      ? deps.createServiceClient(supabaseUrl, serviceKey)
      : supabaseCreateClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

    // --- JWT verification ---
    const token = bearerToken(req);
    if (!token) {
      return json({ error: { code: "missing_bearer" } }, 401);
    }

    const verified = await service.auth.getUser(token);
    if (verified.error || !verified.data.user) {
      return json({ error: { code: "invalid_token" } }, 401);
    }
    const userId = verified.data.user.id;

    // --- Payload validation ---
    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      payload = null;
    }

    const parsed = voidSchema.safeParse(payload);
    if (!parsed.success) {
      return json({ error: { code: "invalid_payload" } }, 400);
    }

    const { invoice_id, business_id, void_reason } = parsed.data;

    // --- RPC call ---
    // The Postgres void_invoice_fn handles: admin role check, business
    // membership, issued-status guard, void transition, replacement draft
    // creation, and audit trail — all in one transaction.
    const { data, error } = await service.rpc("void_invoice_fn", {
      p_caller_id: userId,
      p_invoice_id: invoice_id,
      p_business_id: business_id,
      p_void_reason: void_reason,
    });

    if (error) {
      const pgCode = error.code ?? "";

      // P0002 = no_data_found (invoice not found or not issued)
      if (pgCode === "P0002") {
        return json(
          { error: { code: "invoice_not_found_or_not_issued" } },
          404,
        );
      }

      // 42501 = insufficient_privilege (staff void attempt)
      if (pgCode === "42501") {
        return json(
          {
            error: {
              code: "forbidden",
              message:
                "voiding an issued invoice is restricted to admins (D-16)",
            },
          },
          403,
        );
      }

      // 23514 = check_violation (voided documents are frozen / already voided)
      if (pgCode === "23514") {
        return json({ error: { code: "already_voided" } }, 409);
      }

      // P22023 = invalid_parameter_value (caller not found or inactive)
      if (pgCode === "P22023") {
        return json({ error: { code: "caller_not_found_or_inactive" } }, 403);
      }

      // Unknown Postgres error — surface the raw message for debugging
      return json(
        {
          error: {
            code: "void_failed",
            message: error.message ?? "unknown error",
            pgCode,
          },
        },
        500,
      );
    }

    // --- Success ---
    return json(data, 200);
  } catch (err) {
    // Network / transport errors (e.g. Supabase unreachable) surface as 500
    const message =
      err instanceof Error ? err.message : "unknown transport error";
    return json({ error: { code: "network", message } }, 500);
  }
}

// Edge runtime entrypoint. Guarded so Node/vitest can import this module for
// handler-level tests without touching Deno globals.
const denoGlobal = globalThis as unknown as {
  Deno?: { serve: (handler: (req: Request) => Promise<Response>) => void };
};
denoGlobal.Deno?.serve((req: Request) => handleVoidInvoice(req));
