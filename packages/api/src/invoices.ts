// Invoices module (INV-01..08, D-79 single-door). The ONLY sanctioned path
// for invoice data access — no ad-hoc `client.from('invoices')` calls
// anywhere else. Draft CRUD goes through RLS; finalize/void go through Edge
// Functions via supabase.functions.invoke().
//
// Locked decisions implemented here:
//   D-45       ad-hoc custom-priced lines (unit_price_catalog NULL)
//   D-48       catalog price AND discount stored separately
//   R-50       typed API module for invoice lifecycle
//   R-51       keysFor.invoices follows D-81 [entity, businessId, ...rest]
//   R-46       finalizeInvoice calls Edge Function (server recomputes taxes)
//   R-47       FY derived at finalize time, not client-submitted
import type { SupabaseClient } from "@supabase/supabase-js";
import { asError, fromPostgrest, type Result } from "./result";

// ---------------------------------------------------------------------------
// Types — derived from migration 0004 + 0019 schema, matching db-types
// ---------------------------------------------------------------------------

export interface InvoiceRow {
  id: string;
  business_id: string;
  fy: string;
  status: "draft" | "issued" | "voided";
  seq: number | null;
  issued_at: string | null;
  issued_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_gstin: string | null;
  customer_address: Record<string, unknown> | null;
  supply_type: string | null;
  reverse_charge: boolean;
  registration_type: string | null;
  subtotal_amount: number;
  tax_amount: number;
  total_amount: number;
  round_off_amount: number;
  paid_amount: number;
  payment_status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  hsn_sac: string | null;
  quantity: number;
  unit_price_catalog: number | null;
  unit_price_charged: number;
  discount_pct: number;
  gst_rate: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  catalog_item_id: string | null;
}

export interface CreateDraftInput {
  customer_id?: string | null;
  fy: string;
}

export interface UpdateDraftPatch {
  customer_id?: string | null;
}

export interface FinalizeResult {
  invoice_id: string;
  doc_number: string;
  status: "issued";
  total_amount: number;
}

export interface VoidResult {
  invoice_id: string;
  status: "voided";
  new_draft_id?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RowEnvelope = { data: unknown; error: unknown };

/** Map Edge Function error responses into the Result<T> envelope. */
function mapEdgeFunctionError(
  err: unknown,
): Result<never> {
  const mapped = asError(err);
  // Edge Function errors carry a `code` field from the Postgres exception
  // or a custom error object. Map known codes to typed reasons.
  if (mapped.reason === "UNKNOWN" && "code" in mapped) {
    const code = (mapped as { code?: string }).code;
    if (code === "insufficient_stock") {
      return {
        ok: false,
        error: {
          reason: "VALIDATION_FAILED",
          message: mapped.message,
          pgCode: "23514",
        },
      };
    }
    if (code === "invoice_not_found_or_not_draft") {
      return { ok: false, error: { reason: "ROW_NOT_FOUND", message: mapped.message } };
    }
    if (code === "forbidden") {
      return {
        ok: false,
        error: { reason: "PERMISSION_DENIED", message: mapped.message, pgCode: "42501" },
      };
    }
  }
  return { ok: false, error: mapped };
}

// ---------------------------------------------------------------------------
// CRUD functions — draft lifecycle (RLS-gated)
// ---------------------------------------------------------------------------

/**
 * List invoices for a business, optionally filtered by status.
 * Ordered by created_at descending (newest first).
 */
export async function listInvoicesByBusiness(
  client: SupabaseClient,
  businessId: string,
  status?: "draft" | "issued" | "voided",
): Promise<Result<InvoiceRow[]>> {
  let q = client
    .from("invoices")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (status !== undefined) {
    q = q.eq("status", status);
  }
  const res = (await q) as RowEnvelope;
  return fromPostgrest<InvoiceRow[]>(Promise.resolve(res) as never);
}

/**
 * Get a single invoice with its lines (detail view).
 * Filters by both id AND business_id for tenant scoping.
 */
export async function getInvoice(
  client: SupabaseClient,
  invoiceId: string,
  businessId: string,
): Promise<Result<InvoiceRow & { invoice_lines: InvoiceLineRow[] }>> {
  const res = (await client
    .from("invoices")
    .select("*, invoice_lines(*)")
    .eq("id", invoiceId)
    .eq("business_id", businessId)
    .single()) as RowEnvelope;
  return fromPostgrest<InvoiceRow & { invoice_lines: InvoiceLineRow[] }>(
    Promise.resolve(res) as never,
  );
}

/**
 * Get lines for an invoice, ordered by position ascending.
 */
export async function getInvoiceLines(
  client: SupabaseClient,
  invoiceId: string,
): Promise<Result<InvoiceLineRow[]>> {
  const res = (await client
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("position", { ascending: true })) as RowEnvelope;
  return fromPostgrest<InvoiceLineRow[]>(Promise.resolve(res) as never);
}

/**
 * Create a draft invoice. Only status='draft' is allowed by RLS insert
 * policy. customer_id is optional — the bill-entry screen sets it when the
 * user picks a customer.
 */
export async function createDraftInvoice(
  client: SupabaseClient,
  businessId: string,
  input: CreateDraftInput,
): Promise<Result<InvoiceRow>> {
  const payload: Record<string, unknown> = {
    business_id: businessId,
    fy: input.fy,
    status: "draft",
  };
  if (input.customer_id !== undefined) {
    payload["customer_id"] = input.customer_id;
  }
  const res = (await client
    .from("invoices")
    .insert(payload)
    .select()
    .single()) as RowEnvelope;
  return fromPostgrest<InvoiceRow>(Promise.resolve(res) as never);
}

/**
 * Update a draft invoice. Only customer_id is patchable on drafts.
 * Guards: status='draft' + business_id match (RLS + explicit filter).
 */
export async function updateDraftInvoice(
  client: SupabaseClient,
  args: { id: string; businessId: string; patch: UpdateDraftPatch },
): Promise<Result<InvoiceRow>> {
  const payload: Record<string, unknown> = {};
  if (args.patch.customer_id !== undefined) {
    payload["customer_id"] = args.patch.customer_id;
  }
  const res = (await client
    .from("invoices")
    .update(payload)
    .eq("id", args.id)
    .eq("business_id", args.businessId)
    .eq("status", "draft")
    .select()
    .single()) as RowEnvelope;
  return fromPostgrest<InvoiceRow>(Promise.resolve(res) as never);
}

/**
 * Delete a draft invoice. Only status='draft' rows are deletable.
 * Guards: status='draft' + business_id match.
 */
export async function deleteDraftInvoice(
  client: SupabaseClient,
  args: { id: string; businessId: string },
): Promise<Result<void>> {
  const res = (await client
    .from("invoices")
    .delete()
    .eq("id", args.id)
    .eq("business_id", args.businessId)
    .eq("status", "draft")) as RowEnvelope;
  return fromPostgrest<void>(Promise.resolve(res) as never);
}

// ---------------------------------------------------------------------------
// Edge Function wrappers — finalize + void (server-side only)
// ---------------------------------------------------------------------------

/**
 * Finalize an invoice: allocate number, snapshot buyer, compute taxes,
 * freeze the document. Calls the finalize-invoice Edge Function which
 * runs as service_role in a single Postgres transaction (R-46).
 *
 * The client NEVER writes issued-invoice columns directly.
 */
export async function finalizeInvoice(
  client: SupabaseClient,
  invoiceId: string,
  businessId: string,
): Promise<Result<FinalizeResult>> {
  try {
    const { data, error } = await client.functions.invoke("finalize-invoice", {
      body: { invoice_id: invoiceId, business_id: businessId },
    });
    if (error) return mapEdgeFunctionError(error);
    return { ok: true, data: data as FinalizeResult };
  } catch (err) {
    return mapEdgeFunctionError(err);
  }
}

/**
 * Void an issued invoice with a required reason. Admin-only (D-16).
 * Calls the void-invoice Edge Function which runs as service_role (R-46).
 * Optionally creates a replacement draft with the voided invoice's lines.
 */
export async function voidInvoice(
  client: SupabaseClient,
  invoiceId: string,
  businessId: string,
  reason: string,
): Promise<Result<VoidResult>> {
  try {
    const { data, error } = await client.functions.invoke("void-invoice", {
      body: {
        invoice_id: invoiceId,
        business_id: businessId,
        void_reason: reason,
      },
    });
    if (error) return mapEdgeFunctionError(error);
    return { ok: true, data: data as VoidResult };
  } catch (err) {
    return mapEdgeFunctionError(err);
  }
}
