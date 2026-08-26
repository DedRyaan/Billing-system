// finalize-invoice — the INV-03/INV-04/INV-05 server-side finalize endpoint.
//
// Thin JWT-verification shell (Strategy B): the Edge Function computes taxes
// via @billing/gst's totalInvoice() and passes pre-computed totals to the
// Postgres SECURITY DEFINER function finalize_invoice_fn(), which runs the
// entire atomic transaction (number allocation, buyer snapshot, line freeze,
// stock decrement, audit trail) in a single Postgres commit.
//
// The client NEVER writes issued-invoice columns directly (R-44).
// Server recomputes taxes — never trusts client values (R-46, T-4-06).
// FY derived from IST calendar at finalize time — not from client input (R-47).
//
// Caller gate: POST with Authorization: Bearer <JWT>. The token is verified
// server-side via GoTrue (auth.getUser), then the profile role resolves from
// the SERVER-CONTROLLED profiles row (never JWT metadata) and must be
// is_active — any member can finalize drafts (D-41 shared pool).
//
// Dual-runtime note (invite-user/bootstrap precedent): bare `zod` /
// `@supabase/supabase-js` / `@billing/gst` imports resolve in Deno 2
// (edge runtime) and under Node/vitest, where tests import
// handleFinalizeInvoice() directly with injected deps.

import {
  createClient as supabaseCreateClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { z } from "zod";
import {
  totalInvoice,
  derivePlaceOfSupply,
  type LineInput,
  type TaxHead,
} from "@billing/gst";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const finalizeSchema = z.object({
  invoice_id: z.string().uuid(),
  business_id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Deps — injected for dual-runtime testing
// ---------------------------------------------------------------------------

export interface FinalizeDeps {
  env?: Record<string, string | undefined>;
  createServiceClient?: (url: string, serviceKey: string) => SupabaseClient;
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

/** Convert numeric (rupee decimal) from DB to bigint paise for @billing/gst. */
function rupeesToPaise(n: number): bigint {
  return BigInt(Math.round(n * 100));
}

/** Convert BigInt paise to numeric rupee decimal for the Postgres function. */
function paiseToRupees(p: bigint): number {
  return Number(p) / 100;
}

/** Convert an invoice_lines row to a LineInput for totalInvoice(). */
function rowToLineInput(line: {
  quantity: number;
  unit_price_charged: number;
  discount_pct: number;
  gst_rate: number;
}): LineInput {
  return {
    qtyMilli: BigInt(Math.round(line.quantity * 1000)),
    unitPricePaise: rupeesToPaise(line.unit_price_charged),
    discountBps: BigInt(Math.round(line.discount_pct * 100)),
    gstRateBps: BigInt(Math.round(line.gst_rate * 100)),
    pricingMode: "exclusive",
    character: "taxable",
  };
}

// ---------------------------------------------------------------------------
// Error code mapping from Postgres RAISE EXCEPTION SQLSTATE codes
// ---------------------------------------------------------------------------

function mapRpcError(error: {
  code?: string;
  message?: string;
}): { status: number; body: unknown } {
  const code = error.code ?? "";
  const msg = error.message ?? "";

  // SQLSTATE 22023: invalid_parameter_value — business logic validation errors
  if (code === "22023") {
    if (msg.includes("not found or not draft") || msg.includes("modified concurrently")) {
      return { status: 404, body: { error: { code: "invoice_not_found_or_not_draft" } } };
    }
    if (msg.includes("not found or inactive")) {
      return { status: 403, body: { error: { code: "forbidden" } } };
    }
    if (msg.includes("has no lines")) {
      return { status: 422, body: { error: { code: "invoice_has_no_lines" } } };
    }
    if (msg.includes("line_details count mismatch")) {
      return { status: 422, body: { error: { code: "line_details_mismatch" } } };
    }
    if (msg.includes("line freeze failed")) {
      return { status: 500, body: { error: { code: "line_freeze_failed", message: msg } } };
    }
    if (msg.includes("negative amounts")) {
      return { status: 422, body: { error: { code: "negative_amounts" } } };
    }
  }

  // SQLSTATE 42501: insufficient_privilege — access denied
  if (code === "42501") {
    return { status: 403, body: { error: { code: "forbidden" } } };
  }

  // SQLSTATE 23514: check_violation — insufficient stock (CHECK constraint backstop)
  if (code === "23514") {
    return { status: 422, body: { error: { code: "insufficient_stock", message: msg } } };
  }

  // SQLSTATE 23505: unique_violation — already issued (race condition)
  if (code === "23505") {
    return { status: 409, body: { error: { code: "already_issued" } } };
  }

  // SQLSTATE 40001: serialization_failure — concurrent modification
  if (code === "40001") {
    return { status: 409, body: { error: { code: "concurrent modification" } } };
  }

  // Fallback
  return {
    status: 500,
    body: { error: { code: "finalize_failed", message: msg } },
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleFinalizeInvoice(
  req: Request,
  deps: FinalizeDeps = {},
): Promise<Response> {
  // ── Method guard ───────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return json({ error: { code: "method_not_allowed" } }, 405);
  }

  // ── Env ────────────────────────────────────────────────────────────────
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

  // ── Parse payload ──────────────────────────────────────────────────────
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }
  const parsed = finalizeSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: { code: "invalid_payload" } }, 400);
  }
  const { invoice_id: invoiceId, business_id: businessId } = parsed.data;

  // ── Verify JWT ─────────────────────────────────────────────────────────
  const token = bearerToken(req);
  if (!token) {
    return json({ error: { code: "missing_bearer" } }, 401);
  }
  const verified = await service.auth.getUser(token);
  if (verified.error || !verified.data.user) {
    return json({ error: { code: "invalid_token" } }, 401);
  }
  const userId = verified.data.user.id;

  // ── Read caller profile (server-controlled, never JWT metadata) ────────
  const profileRes = await service
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", userId)
    .single();
  if (profileRes.error || !profileRes.data) {
    return json({ error: { code: "no_profile" } }, 403);
  }
  if (!profileRes.data.is_active) {
    return json({ error: { code: "forbidden" } }, 403);
  }

  // ── Read draft invoice via service-role (bypasses RLS) ─────────────────
  const invoiceRes = await service
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("business_id", businessId)
    .eq("status", "draft")
    .single();
  if (invoiceRes.error || !invoiceRes.data) {
    return json(
      { error: { code: "invoice_not_found_or_not_draft" } },
      404,
    );
  }
  const invoice = invoiceRes.data;

  // ── Read lines ─────────────────────────────────────────────────────────
  const linesRes = await service
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("position", { ascending: true });
  if (linesRes.error) {
    return json({ error: { code: "lines_read_failed" } }, 500);
  }
  const lines = linesRes.data as Array<{
    quantity: number;
    unit_price_charged: number;
    discount_pct: number;
    gst_rate: number;
    position: number;
  }> | null;
  if (!lines || lines.length === 0) {
    return json({ error: { code: "invoice_has_no_lines" } }, 422);
  }

  // ── Read customer for POS derivation (if customer_id set) ──────────────
  let customer: { state: string | null } | null = null;
  if (invoice.customer_id) {
    const customerRes = await service
      .from("customers")
      .select("state")
      .eq("id", invoice.customer_id)
      .single();
    if (customerRes.data) {
      customer = customerRes.data;
    }
  }

  // ── Read business for supplier state + registration type ────────────────
  const businessRes = await service
    .from("businesses")
    .select("state, registration_type")
    .eq("id", businessId)
    .single();
  if (businessRes.error || !businessRes.data) {
    return json({ error: { code: "business_not_found" } }, 404);
  }
  const business = businessRes.data;
  if (!business.state) {
    return json(
      { error: { code: "business_state_missing", message: "Business has no state set — required for GST classification" } },
      422,
    );
  }

  // ── Derive Place of Supply ─────────────────────────────────────────────
  const customerStateCode = customer?.state ?? business.state;
  const posResult = derivePlaceOfSupply({
    supplierStateCode: business.state,
    kind: "goods_movement",
    shipToStateCode: customerStateCode,
  });
  if (!posResult.ok) {
    return json(
      { error: { code: "pos_derivation_failed", message: posResult.reason } },
      422,
    );
  }
  const supplyType = posResult.supplyType;
  const head: TaxHead = posResult.head;

  // ── Convert lines to LineInput[] for totalInvoice() ────────────────────
  const lineInputs: LineInput[] = lines.map(rowToLineInput);

  // ── Compute taxes server-side via @billing/gst (R-46, T-4-06) ──────────
  const totals = totalInvoice(lineInputs, {
    head,
    registrationType: business.registration_type as
      | "regular"
      | "composition",
    reverseCharge: invoice.reverse_charge ?? false,
  });
  if (!totals.ok) {
    return json(
      { error: { code: "tax_computation_failed", message: totals.reason } },
      422,
    );
  }

  // ── Build line details for Postgres function ───────────────────────────
  const lineDetails = totals.lines.map((line, idx) => ({
    position: idx + 1,
    taxable: paiseToRupees(line.taxablePaise),
    cgst: paiseToRupees(line.cgstPaise),
    sgst: paiseToRupees(line.sgstOrUtgstPaise),
    igst: paiseToRupees(line.igstPaise),
  }));

  // ── Call finalize_invoice_fn RPC (atomic Postgres transaction) ──────────
  const rpcRes = await service.rpc("finalize_invoice_fn", {
    p_caller_id: userId,
    p_invoice_id: invoiceId,
    p_business_id: businessId,
    p_subtotal: paiseToRupees(totals.subtotalPaise),
    p_tax: paiseToRupees(totals.taxPaise),
    p_total: paiseToRupees(totals.grandTotalPaise),
    p_round_off: paiseToRupees(totals.roundOffPaise),
    p_supply_type: supplyType,
    p_line_details: lineDetails,
  });

  if (rpcRes.error) {
    const mapped = mapRpcError(rpcRes.error);
    return json(mapped.body, mapped.status);
  }

  return json(rpcRes.data, 200);
}

// Edge runtime entrypoint. Guarded so Node/vitest can import this module for
// handler-level tests without touching Deno globals.
const denoGlobal = globalThis as unknown as {
  Deno?: { serve: (handler: (req: Request) => Promise<Response>) => void };
};
denoGlobal.Deno?.serve((req: Request) => handleFinalizeInvoice(req));
