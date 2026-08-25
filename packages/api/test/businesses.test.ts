// Businesses module behaviors - RED.
import { describe, expect, it, vi } from "vitest";
import {
  archiveBusiness,
  createBusiness,
  listBusinesses,
  restoreBusiness,
  updateBusiness,
} from "../src/businesses";
import { makeClient } from "./fakes";

const ROW = {
  id: "bid-1",
  legal_name: "Acme Traders",
  trade_name: "Acme",
  gstin: "27AAPFU0939F1ZV",
  number_format: "prefix_fy_seq",
  prefix: "INV",
  address: null,
  state: "27",
  phone: null,
  email: null,
  registration_type: "regular",
  logo_path: null,
  archived_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

describe("listBusinesses", () => {
  it("selects all ordered by legal_name ascending and returns ok rows", async () => {
    const fake = makeClient();
    fake.next([ROW]);
    const res = await listBusinesses(fake.client);
    expect(res).toEqual({ ok: true, data: [ROW] });
    const call = fake.calls[0]!;
    expect(call.table).toBe("businesses");
    expect(call.order).toEqual({ col: "legal_name", ascending: true });
  });

  it("maps RLS denials to loud PERMISSION_DENIED carrying the code", async () => {
    const fake = makeClient();
    fake.next(null, { code: "42501", message: 'row-level security for table "businesses"' });
    const res = await listBusinesses(fake.client);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.reason).toBe("PERMISSION_DENIED");
      if (res.error.reason === "PERMISSION_DENIED") expect(res.error.pgCode).toBe("42501");
    }
  });
});

describe("createBusiness", () => {
  const VALID = {
    gstin: "33AAACC1206D1ZN",
    legal_name: "New Co",
    state: "33",
    registration_type: "composition" as const,
    number_format: "prefix_seq" as const,
  };

  it("inserts the typed payload and returns the row via single()", async () => {
    const fake = makeClient();
    fake.next(ROW);
    const res = await createBusiness(fake.client, VALID);
    expect(res.ok).toBe(true);
    const call = fake.calls[0]!;
    expect(call.op).toBe("insert");
    expect(call.payload).toMatchObject({
      legal_name: "New Co",
      registration_type: "composition",
      number_format: "prefix_seq",
    });
    expect(call.single).toBe(true);
  });

  it("rejects a foreign state code BEFORE any network call (VALIDATION_FAILED)", async () => {
    const fake = makeClient();
    const res = await createBusiness(fake.client, { ...VALID, state: "99" });
    expect(fake.calls.length).toBe(0); // nothing sent
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("VALIDATION_FAILED");
  });

  it("surfaces super-admin-only insert denial as PERMISSION_DENIED", async () => {
    const fake = makeClient();
    fake.next(null, { code: "42501", message: "violates row-level security" });
    const res = await createBusiness(fake.client, VALID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("PERMISSION_DENIED");
  });
});

describe("updateBusiness", () => {
  it("patches by id and NEVER re-scopes protected columns", async () => {
    const fake = makeClient();
    fake.next(ROW);
    const res = await updateBusiness(fake.client, "bid-1", { trade_name: "New Trade" });
    expect(res.ok).toBe(true);
    const call = fake.calls[0]!;
    expect(call.op).toBe("update");
    expect(call.filters).toEqual([{ col: "id", op: "eq", val: "bid-1" }]);
    const payload = call.payload as Record<string, unknown>;
    expect(payload["trade_name"]).toBe("New Trade");
    expect("business_id" in payload).toBe(false);
    expect("gstin" in payload).toBe(false); // GSTIN immutable from this path
    expect("id" in payload).toBe(false);
  });
});

describe("archive/restore RPC wrappers", () => {
  it("wraps archive_business with p_business_id verbatim", async () => {
    const fake = makeClient();
    fake.next({ success: true });
    await archiveBusiness(fake.client, "bid-42");
    const call = fake.calls.find((c) => c.rpcName !== undefined)!;
    expect(call.rpcName).toBe("archive_business");
    expect(call.rpcArgs).toEqual({ p_business_id: "bid-42" });
  });

  it("wraps restore_business identically", async () => {
    const spy = vi.fn();
    void spy;
    const fake = makeClient();
    fake.next({ success: true });
    await restoreBusiness(fake.client, "bid-7");
    const call = fake.calls.find((c) => c.rpcName !== undefined)!;
    expect(call.rpcName).toBe("restore_business");
    expect(call.rpcArgs).toEqual({ p_business_id: "bid-7" });
  });
});
