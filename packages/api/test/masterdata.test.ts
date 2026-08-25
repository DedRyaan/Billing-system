// Customers + catalog-items + memberships module behaviors - RED.
import { describe, expect, it } from "vitest";
import {
  UNIT_OPTIONS,
  createCatalogItem,
  deactivateItem,
  listCatalogItems,
  updateCatalogItem,
} from "../src/catalog-items";
import {
  createCustomer,
  deactivateCustomer,
  embedGstinLookup,
  listCustomersByBusiness,
  readGstinLookup,
  updateCustomer,
} from "../src/customers";
import {
  assignmentsOf,
  deactivateStaff,
  listRosterForAdmin,
  reactivateStaff,
  setMembership,
} from "../src/memberships";
import { makeClient } from "./fakes";

const CUSTOMER_ROW = {
  id: "c-1",
  business_id: "b-1",
  name: "Sharma Electronics",
  gstin: "27AAPFU0939F1ZV",
  phone: null,
  address: { lines: ["12 MG Road"], city: "Pune", pincode: "411001" },
  state: "27",
  notes: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("customers", () => {
  it("lists by business sorted name asc, scoped by eq filter", async () => {
    const fake = makeClient();
    fake.next([CUSTOMER_ROW]);
    const res = await listCustomersByBusiness(fake.client, "b-1");
    expect(res).toEqual({ ok: true, data: [CUSTOMER_ROW] });
    const call = fake.calls[0]!;
    expect(call.table).toBe("customers");
    expect(call.order).toEqual({ col: "name", ascending: true });
    expect(call.filters).toContainEqual({ col: "business_id", op: "eq", val: "b-1" });
  });

  it("create inserts with business scope and nullables preserved", async () => {
    const fake = makeClient();
    fake.next(CUSTOMER_ROW);
    const res = await createCustomer(fake.client, "b-1", {
      name: "Sharma Electronics",
      gstin: "27AAPFU0939F1ZV",
      phone: null,
      address: { lines: ["12 MG Road"], city: "Pune", pincode: "411001" },
      stateCode: "27",
      notes: null,
    });
    expect(res.ok).toBe(true);
    const payload = fake.calls[0]!.payload as Record<string, unknown>;
    expect(payload["business_id"]).toBe("b-1");
    expect(payload["state"]).toBe("27");
    expect(payload["notes"]).toBeNull();
  });

  it("update NEVER re-scopes business_id in the patch and filters by id+business", async () => {
    const fake = makeClient();
    fake.next(CUSTOMER_ROW);
    await updateCustomer(fake.client, { id: "c-1", businessId: "b-1", patch: { phone: "98" } });
    const call = fake.calls[0]!;
    const payload = call.payload as Record<string, unknown>;
    expect(payload["phone"]).toBe("98");
    expect("business_id" in payload).toBe(false);
    expect(call.filters).toEqual([
      { col: "id", op: "eq", val: "c-1" },
      { col: "business_id", op: "eq", val: "b-1" },
    ]);
  });

  it("deactivate is a soft-retire (is_active=false), never delete", async () => {
    const fake = makeClient();
    fake.next(CUSTOMER_ROW);
    await deactivateCustomer(fake.client, { id: "c-1", businessId: "b-1" });
    const call = fake.calls[0]!;
    expect(call.op).toBe("update");
    expect((call.payload as Record<string, unknown>)["is_active"]).toBe(false);
    expect(call.op).not.toBe("delete");
  });

  it("_gstin_lookup reserved key round-trips inside the address jsonb envelope", () => {
    const snapshot = { legalName: "Acme Pvt Ltd", stateCode: "29", fetchedAt: "2026-08-26T00:00:00Z" };
    const next = embedGstinLookup(CUSTOMER_ROW.address, snapshot);
    expect(next).toMatchObject({ lines: ["12 MG Road"], _gstin_lookup: snapshot });
    expect(readGstinLookup(next)).toEqual(snapshot);
    expect(readGstinLookup(null)).toBeUndefined();
    // Original untouched (no mutation of cached rows).
    expect("_gstin_lookup" in (CUSTOMER_ROW.address as object)).toBe(false);
  });
});

describe("catalog-items", () => {
  it("UNIT_OPTIONS is a typed non-empty constant", () => {
    expect(UNIT_OPTIONS.length).toBeGreaterThan(3);
    expect(UNIT_OPTIONS).toContain("nos");
  });

  it("create converts gstRateBps via bpsToPercentString and pricePaise to numeric(14,2)", async () => {
    const fake = makeClient();
    fake.next({});
    const res = await createCatalogItem(fake.client, "b-1", {
      name: "Cable 2m",
      kind: "goods",
      hsnSac: "8544",
      gstRateBps: 1800n,
      unit: "nos",
      pricePaise: 123450n,
      mrpPaise: null,
      stockQty: 5,
      isActive: true,
    });
    expect(res.ok).toBe(true);
    const payload = fake.calls[0]!.payload as Record<string, unknown>;
    // Engine-canonical percent form (bpsToPercentString trims zeros).
    expect(payload["gst_rate"]).toBe("18");
    expect(payload["price"]).toBe("1234.50");
    expect(payload["mrp"]).toBeNull();
    expect(payload["business_id"]).toBe("b-1");
    expect(payload["hsn_sac"]).toBe("8544");
  });

  it("lists scoped + sorted by name", async () => {
    const fake = makeClient();
    fake.next([]);
    await listCatalogItems(fake.client, "b-2");
    const call = fake.calls[0]!;
    expect(call.table).toBe("catalog_items");
    expect(call.order).toEqual({ col: "name", ascending: true });
    expect(call.filters).toContainEqual({ col: "business_id", op: "eq", val: "b-2" });
  });

  it("update keeps tenant scoping in filters only", async () => {
    const fake = makeClient();
    fake.next({});
    await updateCatalogItem(fake.client, {
      id: "it-1",
      businessId: "b-1",
      patch: { pricePaise: 999n },
    });
    const call = fake.calls[0]!;
    expect(call.filters).toEqual([
      { col: "id", op: "eq", val: "it-1" },
      { col: "business_id", op: "eq", val: "b-1" },
    ]);
    expect((call.payload as Record<string, unknown>)["price"]).toBe("9.99");
  });

  it("setInactive replaces delete (A7)", async () => {
    const fake = makeClient();
    fake.next({});
    await deactivateItem(fake.client, { id: "it-1", businessId: "b-1" });
    const call = fake.calls[0]!;
    expect(call.op).toBe("update");
    expect((call.payload as Record<string, unknown>)["is_active"]).toBe(false);
  });

  it("staff denial maps to PERMISSION_DENIED union", async () => {
    const fake = makeClient();
    fake.next(null, { code: "42501", message: "guard trigger denial D-44" });
    const res = await createCatalogItem(fake.client, "b-1", {
      name: "X",
      kind: "services",
      gstRateBps: 500n,
      unit: "nos",
      pricePaise: 100n,
    });
    if (!res.ok) expect(res.error.reason).toBe("PERMISSION_DENIED");
    else throw new Error("expected denial");
  });
});

describe("memberships", () => {
  it("roster lists profiles ordered full_name (RLS decides visibility)", async () => {
    const fake = makeClient();
    fake.next([{ id: "u1", full_name: "A" }]);
    await listRosterForAdmin(fake.client);
    const call = fake.calls[0]!;
    expect(call.table).toBe("profiles");
    expect(call.order).toEqual({ col: "full_name", ascending: true });
  });

  it("assignmentsOf joins businesses for names and scopes user_id", async () => {
    const fake = makeClient();
    fake.next([]);
    await assignmentsOf(fake.client, "user-7");
    const call = fake.calls[0]!;
    expect(call.table).toBe("business_members");
    expect(call.select).toContain("businesses");
    expect(call.filters).toContainEqual({ col: "user_id", op: "eq", val: "user-7" });
  });

  it("setMembership(true) inserts a bare membership row", async () => {
    const fake = makeClient();
    fake.next({});
    await setMembership(fake.client, { userId: "u-1", businessId: "b-1", assigned: true });
    const call = fake.calls[0]!;
    expect(call.op).toBe("insert");
    expect(call.payload).toEqual({ user_id: "u-1", business_id: "b-1" });
  });

  it("setMembership(false) deletes scoped by both columns", async () => {
    const fake = makeClient();
    fake.next(null);
    await setMembership(fake.client, { userId: "u-1", businessId: "b-1", assigned: false });
    const call = fake.calls[0]!;
    expect(call.op).toBe("delete");
    expect(call.filters).toEqual([
      { col: "user_id", op: "eq", val: "u-1" },
      { col: "business_id", op: "eq", val: "b-1" },
    ]);
  });

  it.each([
    [deactivateStaff, "deactivate_staff_account"],
    [reactivateStaff, "reactivate_staff_account"],
  ])("%s wraps its RPC passing p_target verbatim", async (fn, rpcName) => {
    const fake = makeClient();
    fake.next({});
    await fn(fake.client, "target-uuid");
    const call = fake.calls.find((c) => c.rpcName !== undefined)!;
    expect(call.rpcName).toBe(rpcName);
    expect(call.rpcArgs).toEqual({ p_target: "target-uuid" });
  });
});
