// Payments module behaviors (plan 05-01 Task 2) — unit tests for the
// typed API module. Mocks the Supabase client following the D-79 fakes pattern.
import { describe, expect, it } from "vitest";
import {
  listOutstandingInvoices,
  listPaymentsByInvoice,
  recordPayment,
} from "../src/payments";
import { makeClient } from "./fakes";

const PAYMENT_ROW = {
  id: "pay-1",
  invoice_id: "inv-1",
  business_id: "b-1",
  amount: 5000,
  method: "cash",
  note: "Partial payment",
  recorded_by: "user-1",
  operation_id: "op-1",
  created_at: "2026-08-27T10:00:00Z",
};

const INVOICE_ROW = {
  id: "inv-2",
  business_id: "b-1",
  fy: "26-27",
  status: "issued" as const,
  seq: 1,
  issued_at: "2026-08-20T00:00:00Z",
  issued_by: "user-1",
  voided_at: null,
  voided_by: null,
  void_reason: null,
  customer_id: "c-1",
  customer_name: "Acme Corp",
  customer_gstin: null,
  customer_address: null,
  supply_type: null,
  reverse_charge: false,
  registration_type: null,
  subtotal_amount: 10000,
  tax_amount: 1800,
  total_amount: 11800,
  round_off_amount: 0,
  paid_amount: 0,
  payment_status: "unpaid",
  created_by: "user-1",
  created_at: "2026-08-19T00:00:00Z",
  updated_at: "2026-08-19T00:00:00Z",
};

describe("recordPayment", () => {
  it("inserts with correct payload shape and returns PaymentRow", async () => {
    const fake = makeClient();
    fake.next(PAYMENT_ROW);
    const res = await recordPayment(fake.client, {
      invoiceId: "inv-1",
      businessId: "b-1",
      amount: 5000,
      method: "cash",
      note: "Partial payment",
      operationId: "op-1",
      recordedBy: "user-1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.id).toBe("pay-1");
      expect(res.data.amount).toBe(5000);
    }
    const call = fake.calls[0]!;
    expect(call.table).toBe("payments");
    expect(call.op).toBe("insert");
    expect(call.single).toBe(true);
    const payload = call.payload as Record<string, unknown>;
    expect(payload.invoice_id).toBe("inv-1");
    expect(payload.business_id).toBe("b-1");
    expect(payload.amount).toBe(5000);
    expect(payload.method).toBe("cash");
    expect(payload.note).toBe("Partial payment");
    expect(payload.operation_id).toBe("op-1");
    expect(payload.recorded_by).toBe("user-1");
  });

  it("pre-validates amount > 0 before hitting DB", async () => {
    const fake = makeClient();
    // No next() — the function should bail before any DB call
    const res = await recordPayment(fake.client, {
      invoiceId: "inv-1",
      businessId: "b-1",
      amount: 0,
      operationId: "op-2",
      recordedBy: "user-1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok && res.error.reason === "VALIDATION_FAILED") {
      expect(res.error.pgCode).toBe("23514");
    }
    // No DB calls should have been made
    expect(fake.calls).toHaveLength(0);
  });

  it("pre-validates negative amount", async () => {
    const fake = makeClient();
    const res = await recordPayment(fake.client, {
      invoiceId: "inv-1",
      businessId: "b-1",
      amount: -100,
      operationId: "op-3",
      recordedBy: "user-1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe("VALIDATION_FAILED");
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("maps P0001 (overpayment) to VALIDATION_FAILED", async () => {
    const fake = makeClient();
    fake.next(null, {
      code: "P0001",
      message: "payment exceeds invoice balance - total 10000, ledger sum 11000 (overpayment rejected)",
    });
    const res = await recordPayment(fake.client, {
      invoiceId: "inv-1",
      businessId: "b-1",
      amount: 11000,
      operationId: "op-4",
      recordedBy: "user-1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok && res.error.reason === "VALIDATION_FAILED") {
      expect(res.error.pgCode).toBe("P0001");
      expect(res.error.message).toContain("overpayment");
    }
  });

  it("maps 23505 (duplicate operation_id) to idempotent success with re-fetched row", async () => {
    const fake = makeClient();
    // First call: insert returns 23505 unique_violation
    fake.next(null, { code: "23505", message: "duplicate key value" });
    // Second call: re-fetch by operation_id returns the original row
    fake.next(PAYMENT_ROW);
    const res = await recordPayment(fake.client, {
      invoiceId: "inv-1",
      businessId: "b-1",
      amount: 5000,
      method: "cash",
      operationId: "op-1",
      recordedBy: "user-1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.operation_id).toBe("op-1");
      expect(res.data.amount).toBe(5000);
    }
    // Two calls: the insert + the re-fetch
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.op).toBe("insert");
    // Re-fetch: .from("payments").select("*").eq(...).eq(...).single()
    expect(fake.calls[1]!.table).toBe("payments");
    expect(fake.calls[1]!.select).toBe("*");
    expect(fake.calls[1]!.single).toBe(true);
    const refetchFilters = fake.calls[1]!.filters;
    expect(refetchFilters).toContainEqual({ col: "operation_id", op: "eq", val: "op-1" });
    expect(refetchFilters).toContainEqual({ col: "business_id", op: "eq", val: "b-1" });
  });

  it("forwards method and note as nullable fields", async () => {
    const fake = makeClient();
    const row = { ...PAYMENT_ROW, method: null, note: null };
    fake.next(row);
    const res = await recordPayment(fake.client, {
      invoiceId: "inv-1",
      businessId: "b-1",
      amount: 100,
      operationId: "op-5",
      recordedBy: "user-1",
    });
    expect(res.ok).toBe(true);
    const payload = fake.calls[0]!.payload as Record<string, unknown>;
    expect(payload.method).toBeUndefined();
    expect(payload.note).toBeUndefined();
  });

  it("forwards unknown Postgrest errors through fromPostgrest", async () => {
    const fake = makeClient();
    fake.next(null, { code: "42501", message: "permission denied" });
    const res = await recordPayment(fake.client, {
      invoiceId: "inv-1",
      businessId: "b-1",
      amount: 100,
      operationId: "op-6",
      recordedBy: "user-1",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe("PERMISSION_DENIED");
    }
  });
});

describe("listPaymentsByInvoice", () => {
  it("returns payments ordered by created_at ASC", async () => {
    const fake = makeClient();
    const rows = [
      { ...PAYMENT_ROW, id: "pay-1", created_at: "2026-08-20T00:00:00Z" },
      { ...PAYMENT_ROW, id: "pay-2", created_at: "2026-08-25T00:00:00Z" },
    ];
    fake.next(rows);
    const res = await listPaymentsByInvoice(fake.client, "inv-1", "b-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(2);
      expect(res.data[0]!.id).toBe("pay-1");
      expect(res.data[1]!.id).toBe("pay-2");
    }
    const call = fake.calls[0]!;
    expect(call.table).toBe("payments");
    expect(call.order).toEqual({ col: "created_at", ascending: true });
    expect(call.filters).toContainEqual({ col: "invoice_id", op: "eq", val: "inv-1" });
    expect(call.filters).toContainEqual({ col: "business_id", op: "eq", val: "b-1" });
  });

  it("returns empty array when no payments exist", async () => {
    const fake = makeClient();
    fake.next([]);
    const res = await listPaymentsByInvoice(fake.client, "inv-1", "b-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual([]);
    }
  });
});

describe("listOutstandingInvoices", () => {
  it("returns issued non-paid invoices ordered by issued_at ASC", async () => {
    const fake = makeClient();
    const invoices = [
      { ...INVOICE_ROW, id: "inv-2", issued_at: "2026-08-15T00:00:00Z" },
      { ...INVOICE_ROW, id: "inv-3", issued_at: "2026-08-20T00:00:00Z" },
    ];
    fake.next(invoices);
    const res = await listOutstandingInvoices(fake.client, "b-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(2);
    }
    const call = fake.calls[0]!;
    expect(call.table).toBe("invoices");
    expect(call.order).toEqual({ col: "issued_at", ascending: true });
    expect(call.filters).toContainEqual({ col: "business_id", op: "eq", val: "b-1" });
    expect(call.filters).toContainEqual({ col: "status", op: "eq", val: "issued" });
    expect(call.filters).toContainEqual({ col: "payment_status", op: "neq", val: "paid" });
  });

  it("returns empty when no outstanding invoices exist", async () => {
    const fake = makeClient();
    fake.next([]);
    const res = await listOutstandingInvoices(fake.client, "b-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual([]);
    }
  });
});
