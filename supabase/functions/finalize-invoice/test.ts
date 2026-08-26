// finalize-invoice — dual-runtime handler tests (deps injected, zero network).
//
// Tests import handleFinalizeInvoice() directly with a mocked service-role
// client. These run under Node/vitest, NOT Deno, and do NOT require a live
// Supabase stack.
//
// The Edge Function is a thin shell: it verifies the JWT, reads data via
// service-role, computes taxes via @billing/gst, and delegates to the
// finalize_invoice_fn RPC. Tests focus on:
//   - Input validation (zod)
//   - JWT verification (auth.getUser)
//   - RPC delegation and error mapping
//   - Tax computation (totalInvoice via @billing/gst)
//   - Error path coverage (insufficient stock, already issued, etc.)

import { describe, expect, it, vi } from "vitest";
import { handleFinalizeInvoice } from "./index";

// ---------------------------------------------------------------------------
// Types for mock structure
// ---------------------------------------------------------------------------

interface MockRow {
  [key: string]: unknown;
}

interface MockQueryResult {
  data: unknown;
  error: unknown;
}

// ---------------------------------------------------------------------------
// Mock Supabase client builder
// ---------------------------------------------------------------------------

/**
 * Creates a mock Supabase service-role client that resolves each .from()
 * call with the pre-configured table data. Chainable methods (select, eq,
 * order) return the builder itself; terminal methods (.single(), implicit
 * then) resolve with the table's configured result.
 */
function createMockClient(opts: {
  user?: { id: string } | null;
  tables: Record<string, MockRow | MockRow[]>;
  rpcResults?: Record<string, MockQueryResult>;
}) {
  const tableResults: Record<string, MockQueryResult> = {};
  for (const [table, data] of Object.entries(opts.tables)) {
    tableResults[table] = { data, error: null };
  }

  const rpcResults = opts.rpcResults ?? {};

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue(
        opts.user === undefined || opts.user === null
          ? { data: { user: null }, error: { message: "invalid token" } }
          : { data: { user: opts.user }, error: null },
      ),
    },
    from: vi.fn().mockImplementation((table: string) => {
      const result = tableResults[table] ?? {
        data: null,
        error: { message: `table "${table}" not configured in mock` },
      };
      // Create builder object then wire self-referencing mocks AFTER init
      // to avoid TDZ (const cannot be referenced during its own initializer).
      const builder = {
        select: vi.fn(),
        eq: vi.fn(),
        order: vi.fn(),
        single: vi.fn().mockResolvedValue(result),
        // For queries without .single(), the builder is thenable:
        then: (resolve: (r: MockQueryResult) => void) => resolve(result),
      };
      builder.select.mockReturnValue(builder);
      builder.eq.mockReturnValue(builder);
      builder.order.mockReturnValue(builder);
      return builder;
    }),
    rpc: vi.fn().mockImplementation((fn: string, _params?: unknown) => {
      const result = rpcResults[fn] ?? {
        data: null,
        error: { code: "P0002", message: `rpc "${fn}" not configured` },
      };
      return Promise.resolve(result);
    }),
  };

  return client;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// v4-compliant UUIDs: version nibble=4, variant nibble∈{8,9,a,b}
const USER_ID = "11111111-1111-4111-8111-111111111111";
const INVOICE_ID = "22222222-2222-4222-a222-222222222222";
const BUSINESS_ID = "33333333-3333-4333-b333-333333333333";
const CUSTOMER_ID = "44444444-4444-4444-a444-444444444444";
const CATALOG_ITEM_ID = "55555555-5555-4555-a555-555555555555";

const PROFILE = { id: USER_ID, role: "admin", is_active: true };

const BUSINESS = {
  id: BUSINESS_ID,
  state: "27",          // Maharashtra
  registration_type: "regular",
};

const DRAFT_INVOICE = {
  id: INVOICE_ID,
  business_id: BUSINESS_ID,
  status: "draft",
  customer_id: CUSTOMER_ID,
  reverse_charge: false,
};

const CUSTOMER = { state: "27" }; // Same state → intra-state

const LINE_1 = {
  position: 1,
  quantity: 2,
  unit_price_charged: 500,
  discount_pct: 0,
  gst_rate: 18,
  catalog_item_id: CATALOG_ITEM_ID,
  description: "Widget A",
};

const LINE_2 = {
  position: 2,
  quantity: 1,
  unit_price_charged: 200,
  discount_pct: 10,
  gst_rate: 18,
  catalog_item_id: null, // Ad-hoc line — no stock decrement
  description: "Custom service",
};

const SUCCESSFUL_RPC_RESULT = {
  invoice_id: INVOICE_ID,
  doc_number: "INV/26-27/0001",
  status: "issued",
  total_amount: 1346,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_SERVICE_ROLE_KEY: "svc-key",
};

function post(body: unknown): Request {
  return new Request("http://localhost/finalize-invoice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postWithAuth(body: unknown, token = "valid-token"): Request {
  return new Request("http://localhost/finalize-invoice", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function baseTables(overrides: Record<string, unknown> = {}) {
  return {
    profiles: PROFILE,
    invoices: DRAFT_INVOICE,
    invoice_lines: [LINE_1, LINE_2],
    customers: CUSTOMER,
    businesses: BUSINESS,
    ...overrides,
  };
}

function baseDeps(
  clientOverrides: Record<string, unknown> = {},
  rpcOverrides: Record<string, MockQueryResult> = {},
) {
  return {
    env: ENV,
    createServiceClient: () =>
      createMockClient({
        user: { id: USER_ID },
        tables: baseTables(),
        rpcResults: {
          finalize_invoice_fn: { data: SUCCESSFUL_RPC_RESULT, error: null },
          ...rpcOverrides,
        },
        ...clientOverrides,
      }) as never,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleFinalizeInvoice", () => {
  // ── Input validation ───────────────────────────────────────────────────

  it("rejects non-POST with 405", async () => {
    const res = await handleFinalizeInvoice(
      new Request("http://localhost/finalize-invoice", { method: "GET" }),
      baseDeps(),
    );
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: { code: "method_not_allowed" } });
  });

  it("rejects invalid payload with 400", async () => {
    const res = await handleFinalizeInvoice(post({}), baseDeps());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_payload" } });
  });

  it("rejects invalid UUID in payload with 400", async () => {
    const res = await handleFinalizeInvoice(
      post({ invoice_id: "not-a-uuid", business_id: "also-not" }),
      baseDeps(),
    );
    expect(res.status).toBe(400);
  });

  it("reports server_misconfigured without env vars", async () => {
    const res = await handleFinalizeInvoice(
      post({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      { env: {} },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "server_misconfigured" } });
  });

  // ── JWT verification ───────────────────────────────────────────────────

  it("rejects missing bearer token with 401", async () => {
    const res = await handleFinalizeInvoice(
      post({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      baseDeps(),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "missing_bearer" } });
  });

  it("rejects invalid token with 401", async () => {
    const res = await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () =>
          createMockClient({
            user: null, // getUser returns null user
            tables: baseTables(),
            rpcResults: {
              finalize_invoice_fn: { data: SUCCESSFUL_RPC_RESULT, error: null },
            },
          }) as never,
      },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "invalid_token" } });
  });

  it("rejects inactive caller with 403", async () => {
    const res = await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () =>
          createMockClient({
            user: { id: USER_ID },
            tables: {
              ...baseTables(),
              profiles: { ...PROFILE, is_active: false },
            },
            rpcResults: {
              finalize_invoice_fn: { data: SUCCESSFUL_RPC_RESULT, error: null },
            },
          }) as never,
      },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  // ── Invoice validation ─────────────────────────────────────────────────

  it("returns 404 for non-existent invoice", async () => {
    const res = await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () =>
          createMockClient({
            user: { id: USER_ID },
            tables: {
              ...baseTables(),
              invoices: null, // Invoice not found
            },
            rpcResults: {
              finalize_invoice_fn: { data: SUCCESSFUL_RPC_RESULT, error: null },
            },
          }) as never,
      },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "invoice_not_found_or_not_draft" },
    });
  });

  it("returns 422 when invoice has no lines", async () => {
    const res = await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () =>
          createMockClient({
            user: { id: USER_ID },
            tables: {
              ...baseTables(),
              invoice_lines: [], // No lines
            },
            rpcResults: {
              finalize_invoice_fn: { data: SUCCESSFUL_RPC_RESULT, error: null },
            },
          }) as never,
      },
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: "invoice_has_no_lines" },
    });
  });

  // ── RPC error mapping ──────────────────────────────────────────────────

  it("maps insufficient stock RPC error to 422", async () => {
    const res = await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () =>
          createMockClient({
            user: { id: USER_ID },
            tables: baseTables(),
            rpcResults: {
              finalize_invoice_fn: {
                data: null,
                error: {
                  code: "23514",
                  message:
                    'insufficient stock for "Widget A": 0 available, 2 requested',
                },
              },
            },
          }) as never,
      },
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: { code: "insufficient_stock" },
    });
  });

  it("maps already-issued RPC error to 409", async () => {
    const res = await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () =>
          createMockClient({
            user: { id: USER_ID },
            tables: baseTables(),
            rpcResults: {
              finalize_invoice_fn: {
                data: null,
                error: { code: "23505", message: "already_issued" },
              },
            },
          }) as never,
      },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "already_issued" } });
  });

  it("maps forbidden RPC error to 403", async () => {
    const res = await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () =>
          createMockClient({
            user: { id: USER_ID },
            tables: baseTables(),
            rpcResults: {
              finalize_invoice_fn: {
                data: null,
                error: { code: "42501", message: "no access to business" },
              },
            },
          }) as never,
      },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "forbidden" } });
  });

  it("maps unknown RPC error to 500", async () => {
    const res = await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () =>
          createMockClient({
            user: { id: USER_ID },
            tables: baseTables(),
            rpcResults: {
              finalize_invoice_fn: {
                data: null,
                error: { code: "XX000", message: "something broke" },
              },
            },
          }) as never,
      },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: { code: "finalize_failed" },
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────

  it("finalizes a valid draft invoice → 200", async () => {
    const rpcFn = vi.fn().mockResolvedValue({
      data: SUCCESSFUL_RPC_RESULT,
      error: null,
    });

    const res = await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () =>
          createMockClient({
            user: { id: USER_ID },
            tables: baseTables(),
            rpcResults: { finalize_invoice_fn: { data: SUCCESSFUL_RPC_RESULT, error: null } },
          }) as never,
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(SUCCESSFUL_RPC_RESULT);
  });

  it("passes correct parameters to the RPC", async () => {
    const rpcFn = vi.fn().mockResolvedValue({
      data: SUCCESSFUL_RPC_RESULT,
      error: null,
    });

    // Create a client where we can spy on the rpc call
    const fakeClient = createMockClient({
      user: { id: USER_ID },
      tables: baseTables(),
      rpcResults: { finalize_invoice_fn: { data: SUCCESSFUL_RPC_RESULT, error: null } },
    });
    // Override rpc with our spy
    fakeClient.rpc = rpcFn;

    const res = await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () => fakeClient as never,
      },
    );

    expect(res.status).toBe(200);
    expect(rpcFn).toHaveBeenCalledTimes(1);
    const [fnName, params] = rpcFn.mock.calls[0] as [string, Record<string, unknown>];
    expect(fnName).toBe("finalize_invoice_fn");
    expect(params.p_caller_id).toBe(USER_ID);
    expect(params.p_invoice_id).toBe(INVOICE_ID);
    expect(params.p_business_id).toBe(BUSINESS_ID);
    expect(params.p_supply_type).toBe("intra_state"); // Both Maharashtra (27)
    // Totals computed by totalInvoice() from @billing/gst:
    // Line 1: qty=2, price=500, discount=0%, rate=18% → base=1000, taxable=1000, tax=180
    // Line 2: qty=1, price=200, discount=10%, rate=18% → base=200, discount=20, taxable=180, tax=32.40
    // Total: subtotal=1180, tax=212.40, total=1392.40, roundOff=0
    expect(typeof params.p_subtotal).toBe("number");
    expect(typeof params.p_tax).toBe("number");
    expect(typeof params.p_total).toBe("number");
    expect(typeof params.p_round_off).toBe("number");
    // Line details should be an array with position 1 and 2
    const ld = params.p_line_details as Array<Record<string, unknown>>;
    expect(Array.isArray(ld)).toBe(true);
    expect(ld).toHaveLength(2);
    expect(ld[0].position).toBe(1);
    expect(ld[1].position).toBe(2);
  });

  // ── POS derivation ─────────────────────────────────────────────────────

  it("derives inter_state for different supplier/customer states", async () => {
    const fakeClient = createMockClient({
      user: { id: USER_ID },
      tables: {
        ...baseTables(),
        customers: { state: "09" }, // UP — different from Maharashtra (27)
      },
      rpcResults: { finalize_invoice_fn: { data: SUCCESSFUL_RPC_RESULT, error: null } },
    });
    const rpcFn = vi.fn().mockResolvedValue({
      data: SUCCESSFUL_RPC_RESULT,
      error: null,
    });
    fakeClient.rpc = rpcFn;

    const res = await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () => fakeClient as never,
      },
    );

    expect(res.status).toBe(200);
    const [, params] = rpcFn.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.p_supply_type).toBe("inter_state");
  });

  // ── Tax computation via @billing/gst ───────────────────────────────────

  it("computes taxes via totalInvoice() (not trusting client values)", async () => {
    const fakeClient = createMockClient({
      user: { id: USER_ID },
      tables: baseTables(),
      rpcResults: { finalize_invoice_fn: { data: SUCCESSFUL_RPC_RESULT, error: null } },
    });
    const rpcFn = vi.fn().mockResolvedValue({
      data: SUCCESSFUL_RPC_RESULT,
      error: null,
    });
    fakeClient.rpc = rpcFn;

    await handleFinalizeInvoice(
      postWithAuth({ invoice_id: INVOICE_ID, business_id: BUSINESS_ID }),
      {
        env: ENV,
        createServiceClient: () => fakeClient as never,
      },
    );

    const [, params] = rpcFn.mock.calls[0] as [string, Record<string, unknown>];
    const lineDetails = params.p_line_details as Array<{
      position: number;
      taxable: number;
      cgst: number;
      sgst: number;
      igst: number;
    }>;

    // Line 1: 2 × ₹500 = ₹1000 base, 0% discount, 18% GST = ₹180 tax
    // CGST=90, SGST=90 (intra-state, same-state Maharashtra)
    expect(lineDetails[0].taxable).toBe(1000);
    expect(lineDetails[0].cgst).toBe(90);
    expect(lineDetails[0].sgst).toBe(90);
    expect(lineDetails[0].igst).toBe(0);

    // Line 2: 1 × ₹200 = ₹200 base, 10% discount = ₹180 taxable, 18% GST = ₹32.40
    // fullTax = divRoundHalfUp(18000 * 1800, 10000) = 3240 paise → ₹32.40
    // intra-state: CGST = SGST = 3240/2 = 1620 paise → ₹16.20 each
    expect(lineDetails[1].taxable).toBe(180);
    expect(lineDetails[1].cgst + lineDetails[1].sgst).toBeCloseTo(32.4); // 16.20 + 16.20
    expect(lineDetails[1].igst).toBe(0);

    // Totals
    expect(params.p_subtotal).toBe(1180); // 1000 + 180
    expect(params.p_tax).toBeCloseTo(212.4); // 180 + 32.4
  });
});
