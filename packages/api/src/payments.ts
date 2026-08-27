// Payments module (PAY-01..04, D-79 single-door). The ONLY sanctioned path
// for payment data access — no ad-hoc `client.from('payments')` calls
// anywhere else. Writes go through RLS insert; the DB trigger
// `maintain_invoice_payment_totals` derives paid_amount/payment_status.
//
// Locked decisions:
//   D-79       single-door pattern — all payment access through this module
//   D-81       query keys follow [entity, businessId, ...rest] frozen tuples
//   Pitfall 7  operation_id = client-generated UUID; 23505 = idempotent no-op
//   PAY-01     recordPayment inserts via direct RLS
//   PAY-02     append-only ledger enforced by DB triggers
//   PAY-03     payment history read path
//   PAY-04     outstanding invoices (issued + non-paid, ordered by age)
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgrest, type Result } from "./result";
import type { InvoiceRow } from "./invoices";

// ---------------------------------------------------------------------------
// Types — derived from migration 0005 schema (public.payments)
// ---------------------------------------------------------------------------

export interface PaymentRow {
  id: string;
  invoice_id: string;
  business_id: string;
  amount: number;
  method: string | null;
  note: string | null;
  recorded_by: string | null;
  operation_id: string | null;
  created_at: string;
}

export interface RecordPaymentInput {
  invoiceId: string;
  businessId: string;
  amount: number;
  method?: string | null;
  note?: string | null;
  operationId: string;
  recordedBy: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RowEnvelope = { data: unknown; error: unknown };

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Record a payment against an issued invoice (PAY-01).
 *
 * The DB trigger `maintain_invoice_payment_totals` recomputes
 * paid_amount/payment_status atomically. Clients MUST NOT write these columns.
 *
 * Idempotency: the caller supplies a stable `operationId` (client-generated
 * UUID). On duplicate, the unique backstop yields 23505 and the row is
 * silently collapsed — we re-fetch and return success (Pitfall 7).
 *
 * Overpayment: the trigger's P0001 guard rejects inserts where the new
 * ledger sum exceeds the invoice total. We map it to VALIDATION_FAILED.
 */
export async function recordPayment(
  client: SupabaseClient,
  input: RecordPaymentInput,
): Promise<Result<PaymentRow>> {
  // Pre-validation: amount must be positive (avoids a round-trip for bad data).
  if (input.amount <= 0) {
    return {
      ok: false,
      error: {
        reason: "VALIDATION_FAILED",
        message: "Payment amount must be greater than zero",
        pgCode: "23514",
      },
    };
  }

  // Build insert payload — omit nullable fields when not provided so the
  // column defaults apply cleanly.
  const payload: Record<string, unknown> = {
    invoice_id: input.invoiceId,
    business_id: input.businessId,
    amount: input.amount,
    recorded_by: input.recordedBy,
    operation_id: input.operationId,
  };
  if (input.method !== undefined && input.method !== null) {
    payload.method = input.method;
  }
  if (input.note !== undefined && input.note !== null) {
    payload.note = input.note;
  }

  const res = (await client
    .from("payments")
    .insert(payload)
    .select()
    .single()) as RowEnvelope;

  if (res.error) {
    const code = (res.error as { code?: string }).code;

    // 23505 = unique_violation on (business_id, operation_id).
    // The operation already succeeded on a prior attempt — re-fetch and
    // return success instead of an error (idempotent no-op, Pitfall 7).
    if (code === "23505") {
      const dupe = (await client
        .from("payments")
        .select("*")
        .eq("operation_id", input.operationId)
        .eq("business_id", input.businessId)
        .single()) as RowEnvelope;
      return fromPostgrest<PaymentRow>(Promise.resolve(dupe) as never);
    }

    // P0001 (overpayment) is now in VALIDATION_PG_CODES and maps to
    // VALIDATION_FAILED automatically via fromPostgrest → toDataAccessError.
  }

  // All other errors (including P0001 overpayment, now mapped to
  // VALIDATION_FAILED via VALIDATION_PG_CODES in errors.ts) flow through
  // fromPostgrest naturally.
  return fromPostgrest<PaymentRow>(Promise.resolve(res) as never);
}

/**
 * List all payments for a specific invoice (PAY-03), ordered by created_at ASC
 * (chronological ledger).
 */
export async function listPaymentsByInvoice(
  client: SupabaseClient,
  invoiceId: string,
  businessId: string,
): Promise<Result<PaymentRow[]>> {
  const res = (await client
    .from("payments")
    .select("*")
    .eq("invoice_id", invoiceId)
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })) as RowEnvelope;
  return fromPostgrest<PaymentRow[]>(Promise.resolve(res) as never);
}

/**
 * List outstanding invoices for a business (PAY-04): issued documents where
 * payment_status is not 'paid', sorted by issued_at ASC (oldest first = most
 * overdue). Balance = total_amount - paid_amount (trigger-maintained).
 */
export async function listOutstandingInvoices(
  client: SupabaseClient,
  businessId: string,
): Promise<Result<InvoiceRow[]>> {
  const res = (await client
    .from("invoices")
    .select("*")
    .eq("business_id", businessId)
    .eq("status", "issued")
    .neq("payment_status", "paid")
    .order("issued_at", { ascending: true })) as RowEnvelope;
  return fromPostgrest<InvoiceRow[]>(Promise.resolve(res) as never);
}
