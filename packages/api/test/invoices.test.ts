// Invoices module behaviors (plan 04-01 Task 3) — unit tests for the
// typed API module. Mocks the Supabase client following the D-79 fakes pattern.
import { describe, expect, it } from "vitest";
import {
  createDraftInvoice,
  deleteDraftInvoice,
  finalizeInvoice,
  getInvoice,
  getInvoiceLines,
  listInvoicesByBusiness,
  updateDraftInvoice,
  voidInvoice,
} from "../src/invoices";
import { makeClient } from "./fakes";

const INVOICE_ROW = {
  id: "inv-1",
  business_id: "b-1",
  fy: "26-27",
  status: "draft" as const,
  seq: null,
  issued_at: null,
  issued_by: null,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  customer_id: "c-1",
  customer_name: null,
  customer_gstin: null,
  customer_address: null,
  supply_type: null,
  reverse_charge: false,
  registration_type: null,
  subtotal_amount: 0,
  tax_amount: 0,
  total_amount: 0,
  round_off_amount: 0,
  paid_amount: 0,
  payment_status: "unpaid",
  created_by: null,
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

const LINE_ROW = {
  id: "line-1",
  invoice_id: "inv-1",
  position: 1,
  description: "Widget",
  hsn_sac: "8504",
  quantity: 10,
  unit_price_catalog: 100,
  unit_price_charged: 100,
  discount_pct: 0,
  gst_rate: 18,
  taxable_value: 1000,
  cgst_amount: 90,
  sgst_amount: 90,
  igst_amount: 0,
  catalog_item_id: "cat-1",
};

describe("listInvoicesByBusiness", () => {
  it("lists by business sorted created_at desc", async () => {
    const fake = makeClient();
    fake.next([INVOICE_ROW]);
    const res = await listInvoicesByBusiness(fake.client, "b-1");
    expect(res).toEqual({ ok: true, data: [INVOICE_ROW] });
    const call = fake.calls[0]!;
    expect(call.table).toBe("invoices");
    expect(call.order).toEqual({ col: "created_at", ascending: false });
    expect(call.filters).toContainEqual({ col: "business_id", op: "eq", val: "b-1" });
  });

  it("applies optional status filter", async () => {
    const fake = makeClient();
    fake.next([]);
    await listInvoicesByBusiness(fake.client, "b-1", "draft");
    const call = fake.calls[0]!;
    expect(call.filters).toContainEqual({ col: "status", op: "eq", val: "draft" });
  });

  it("omits status filter when not provided", async () => {
    const fake = makeClient();
    fake.next([]);
    await listInvoicesByBusiness(fake.client, "b-1");
    const call = fake.calls[0]!;
    expect(call.filters.find((f) => f.col === "status")).toBeUndefined();
  });
});

describe("getInvoice", () => {
  it("fetches with nested lines, scoped by id+business", async () => {
    const fake = makeClient();
    fake.next({ ...INVOICE_ROW, invoice_lines: [LINE_ROW] });
    const res = await getInvoice(fake.client, "inv-1", "b-1");
    expect(res.ok).toBe(true);
    const call = fake.calls[0]!;
    expect(call.table).toBe("invoices");
    expect(call.select).toBe("*, invoice_lines(*)");
    expect(call.single).toBe(true);
    expect(call.filters).toEqual([
      { col: "id", op: "eq", val: "inv-1" },
      { col: "business_id", op: "eq", val: "b-1" },
    ]);
  });
});

describe("getInvoiceLines", () => {
  it("fetches lines ordered by position asc", async () => {
    const fake = makeClient();
    fake.next([LINE_ROW]);
    const res = await getInvoiceLines(fake.client, "inv-1");
    expect(res.ok).toBe(true);
    const call = fake.calls[0]!;
    expect(call.table).toBe("invoice_lines");
    expect(call.order).toEqual({ col: "position", ascending: true });
    expect(call.filters).toContainEqual({ col: "invoice_id", op: "eq", val: "inv-1" });
  });
});

describe("createDraftInvoice", () => {
  it("inserts with correct defaults (status='draft', business_id, fy)", async () => {
    const fake = makeClient();
    fake.next(INVOICE_ROW);
    const res = await createDraftInvoice(fake.client, "b-1", { fy: "26-27" });
    expect(res.ok).toBe(true);
    const payload = fake.calls[0]!.payload as Record<string, unknown>;
    expect(payload["business_id"]).toBe("b-1");
    expect(payload["fy"]).toBe("26-27");
    expect(payload["status"]).toBe("draft");
    expect("customer_id" in payload).toBe(false);
  });

  it("includes customer_id when provided", async () => {
    const fake = makeClient();
    fake.next(INVOICE_ROW);
    await createDraftInvoice(fake.client, "b-1", { fy: "26-27", customer_id: "c-1" });
    const payload = fake.calls[0]!.payload as Record<string, unknown>;
    expect(payload["customer_id"]).toBe("c-1");
  });

  it("inserts and returns single row", async () => {
    const fake = makeClient();
    fake.next(INVOICE_ROW);
    await createDraftInvoice(fake.client, "b-1", { fy: "26-27" });
    const call = fake.calls[0]!;
    expect(call.op).toBe("insert");
    expect(call.single).toBe(true);
  });
});

describe("updateDraftInvoice", () => {
  it("only allows customer_id patch, guards status='draft'", async () => {
    const fake = makeClient();
    fake.next(INVOICE_ROW);
    await updateDraftInvoice(fake.client, {
      id: "inv-1",
      businessId: "b-1",
      patch: { customer_id: "c-2" },
    });
    const call = fake.calls[0]!;
    const payload = call.payload as Record<string, unknown>;
    expect(payload["customer_id"]).toBe("c-2");
    expect(call.filters).toEqual([
      { col: "id", op: "eq", val: "inv-1" },
      { col: "business_id", op: "eq", val: "b-1" },
      { col: "status", op: "eq", val: "draft" },
    ]);
  });

  it("empty patch produces empty payload", async () => {
    const fake = makeClient();
    fake.next(INVOICE_ROW);
    await updateDraftInvoice(fake.client, {
      id: "inv-1",
      businessId: "b-1",
      patch: {},
    });
    const payload = fake.calls[0]!.payload as Record<string, unknown>;
    expect(Object.keys(payload)).toHaveLength(0);
  });
});

describe("deleteDraftInvoice", () => {
  it("deletes guarded by status='draft' + business_id", async () => {
    const fake = makeClient();
    fake.next(null);
    await deleteDraftInvoice(fake.client, { id: "inv-1", businessId: "b-1" });
    const call = fake.calls[0]!;
    expect(call.op).toBe("delete");
    expect(call.filters).toEqual([
      { col: "id", op: "eq", val: "inv-1" },
      { col: "business_id", op: "eq", val: "b-1" },
      { col: "status", op: "eq", val: "draft" },
    ]);
  });
});

describe("finalizeInvoice", () => {
  it("calls functions.invoke with correct payload", async () => {
    const fake = makeClient();
    fake.nextFunction({
      invoice_id: "inv-1",
      doc_number: "INV/26-27/0001",
      status: "issued",
      total_amount: 1180,
    });
    const res = await finalizeInvoice(fake.client, "inv-1", "b-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.invoice_id).toBe("inv-1");
      expect(res.data.doc_number).toBe("INV/26-27/0001");
      expect(res.data.status).toBe("issued");
    }
    expect(fake.functionCalls).toHaveLength(1);
    expect(fake.functionCalls[0]!.name).toBe("finalize-invoice");
    expect(fake.functionCalls[0]!.body).toEqual({
      invoice_id: "inv-1",
      business_id: "b-1",
    });
  });

  it("maps insufficient_stock error to VALIDATION_FAILED", async () => {
    const fake = makeClient();
    fake.nextFunction(null, {
      code: "insufficient_stock",
      message: "Insufficient stock for Widget: 5 available, 10 requested",
    });
    const res = await finalizeInvoice(fake.client, "inv-1", "b-1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe("VALIDATION_FAILED");
      expect(res.error.message).toContain("Insufficient stock");
    }
  });

  it("maps invoice_not_found to ROW_NOT_FOUND", async () => {
    const fake = makeClient();
    fake.nextFunction(null, {
      code: "invoice_not_found_or_not_draft",
      message: "Invoice not found",
    });
    const res = await finalizeInvoice(fake.client, "inv-1", "b-1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe("ROW_NOT_FOUND");
    }
  });

  it("maps forbidden to PERMISSION_DENIED", async () => {
    const fake = makeClient();
    fake.nextFunction(null, {
      code: "forbidden",
      message: "Admin role required",
    });
    const res = await finalizeInvoice(fake.client, "inv-1", "b-1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe("PERMISSION_DENIED");
    }
  });
});

describe("voidInvoice", () => {
  it("calls functions.invoke with correct payload including reason", async () => {
    const fake = makeClient();
    fake.nextFunction({
      invoice_id: "inv-1",
      status: "voided",
    });
    const res = await voidInvoice(fake.client, "inv-1", "b-1", "Duplicate entry");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.invoice_id).toBe("inv-1");
      expect(res.data.status).toBe("voided");
    }
    expect(fake.functionCalls).toHaveLength(1);
    expect(fake.functionCalls[0]!.name).toBe("void-invoice");
    expect(fake.functionCalls[0]!.body).toEqual({
      invoice_id: "inv-1",
      business_id: "b-1",
      void_reason: "Duplicate entry",
    });
  });

  it("maps forbidden to PERMISSION_DENIED (admin-only void, D-16)", async () => {
    const fake = makeClient();
    fake.nextFunction(null, {
      code: "forbidden",
      message: "voiding restricted to admins",
    });
    const res = await voidInvoice(fake.client, "inv-1", "b-1", "reason");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe("PERMISSION_DENIED");
    }
  });
});
