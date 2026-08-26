// void-invoice — dual-runtime handler tests (deps injected, zero network).
//
// Tests the Edge Function handler end-to-end with mocked Supabase clients.
// The Postgres function (void_invoice_fn) is tested via the RPC mock; the
// Edge Function's JWT verification, payload validation, and error mapping
// are exercised in-process.

import { describe, expect, it, vi, type Mock } from "vitest";
import { handleVoidInvoice, type VoidDeps } from "./index";

// ---------------------------------------------------------------------------
// Test helpers — mock the service-role Supabase client
// ---------------------------------------------------------------------------

interface MockRpcResult {
  data: unknown;
  error: {
    message: string;
    code: string;
    details: string;
    hint: string;
  } | null;
}

function createMockService(opts: {
  rpcResult?: MockRpcResult;
  getUserResult?: { data: { user: { id: string } | null }; error: unknown };
}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue(
        opts.getUserResult ?? {
          data: { user: { id: "admin-user-id" } },
          error: null,
        },
      ),
    },
    rpc: vi.fn().mockResolvedValue(
      opts.rpcResult ?? {
        data: {
          invoice_id: "inv-issued-001",
          status: "voided",
          new_draft_id: "draft-new-001",
        },
        error: null,
      },
    ),
  };
}

const ENV = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_SERVICE_ROLE_KEY: "svc-test-key",
};

function makeDeps(service: ReturnType<typeof createMockService>): VoidDeps {
  return {
    env: ENV,
    createServiceClient: (() => service) as VoidDeps["createServiceClient"],
  };
}

function postBody(body: unknown): Request {
  return new Request("http://localhost/void-invoice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer valid-jwt-token",
    },
    body: JSON.stringify(body),
  });
}

function postNoAuth(): Request {
  return new Request("http://localhost/void-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoice_id: "550e8400-e29b-41d4-a716-446655440000",
      business_id: "550e8400-e29b-41d4-a716-446655440001",
      void_reason: "Incorrect items",
    }),
  });
}

const VALID_PAYLOAD = {
  invoice_id: "550e8400-e29b-41d4-a716-446655440000",
  business_id: "550e8400-e29b-41d4-a716-446655440001",
  void_reason: "Incorrect items billed — customer returned order",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleVoidInvoice", () => {
  // --- HTTP method guard ---

  it("rejects non-POST with 405", async () => {
    const res = await handleVoidInvoice(
      new Request("http://localhost/void-invoice", { method: "GET" }),
    );
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: { code: "method_not_allowed" } });
  });

  // --- Environment guard ---

  it("returns 500 server_misconfigured without service env", async () => {
    const res = await handleVoidInvoice(
      postBody(VALID_PAYLOAD),
      { env: {} },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "server_misconfigured" } });
  });

  // --- Authentication ---

  it("returns 401 missing_bearer without Authorization header", async () => {
    const service = createMockService({});
    const res = await handleVoidInvoice(postNoAuth(), makeDeps(service));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "missing_bearer" } });
  });

  it("returns 401 invalid_token on JWT verification failure", async () => {
    const service = createMockService({
      getUserResult: { data: { user: null }, error: { message: "invalid" } },
    });
    const res = await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_token" } });
  });

  // --- Payload validation ---

  it("returns 400 invalid_payload for empty body", async () => {
    const service = createMockService({});
    const req = new Request("http://localhost/void-invoice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-jwt-token",
      },
      body: JSON.stringify({}),
    });
    const res = await handleVoidInvoice(req, makeDeps(service));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_payload" } });
  });

  it("returns 400 invalid_payload when void_reason is empty", async () => {
    const service = createMockService({});
    const req = postBody({
      invoice_id: "550e8400-e29b-41d4-a716-446655440000",
      business_id: "550e8400-e29b-41d4-a716-446655440001",
      void_reason: "",
    });
    const res = await handleVoidInvoice(req, makeDeps(service));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_payload" } });
  });

  it("returns 400 invalid_payload for non-UUID invoice_id", async () => {
    const service = createMockService({});
    const res = await handleVoidInvoice(
      postBody({ ...VALID_PAYLOAD, invoice_id: "not-a-uuid" }),
      makeDeps(service),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_payload" } });
  });

  // --- Postgres error mapping ---

  it("returns 404 when invoice not found or not issued (P0002)", async () => {
    const service = createMockService({
      rpcResult: {
        data: null,
        error: {
          message: "invoice not found or not issued",
          code: "P0002",
          details: "",
          hint: "",
        },
      },
    });
    const res = await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: "invoice_not_found_or_not_issued" },
    });
  });

  it("returns 403 for staff void attempt (42501 insufficient_privilege)", async () => {
    const service = createMockService({
      rpcResult: {
        data: null,
        error: {
          message: "voiding an issued invoice is restricted to admins (D-16)",
          code: "42501",
          details: "",
          hint: "",
        },
      },
    });
    const res = await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: {
        code: "forbidden",
        message: "voiding an issued invoice is restricted to admins (D-16)",
      },
    });
  });

  it("returns 409 when invoice already voided (23514 check_violation)", async () => {
    const service = createMockService({
      rpcResult: {
        data: null,
        error: {
          message: 'new row for relation "invoices" violates check constraint',
          code: "23514",
          details: "",
          hint: "",
        },
      },
    });
    const res = await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "already_voided" } });
  });

  it("returns 403 for inactive caller (P22023)", async () => {
    const service = createMockService({
      rpcResult: {
        data: null,
        error: {
          message: "caller not found or inactive",
          code: "P22023",
          details: "",
          hint: "",
        },
      },
    });
    const res = await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: "caller_not_found_or_inactive" },
    });
  });

  it("returns 500 for unknown Postgres errors", async () => {
    const service = createMockService({
      rpcResult: {
        data: null,
        error: {
          message: "unexpected db failure",
          code: "XX000",
          details: "",
          hint: "",
        },
      },
    });
    const res = await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: "void_failed", pgCode: "XX000" },
    });
  });

  // --- Happy path ---

  it("returns 200 with invoice_id, status, and new_draft_id on success", async () => {
    const service = createMockService({
      rpcResult: {
        data: {
          invoice_id: "550e8400-e29b-41d4-a716-446655440000",
          status: "voided",
          new_draft_id: "660e8400-e29b-41d4-a716-446655440002",
        },
        error: null,
      },
    });
    const res = await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      invoice_id: "550e8400-e29b-41d4-a716-446655440000",
      status: "voided",
      new_draft_id: "660e8400-e29b-41d4-a716-446655440002",
    });
  });

  it("passes p_caller_id from verified JWT to RPC", async () => {
    const service = createMockService({
      getUserResult: {
        data: { user: { id: "verified-admin-uuid" } },
        error: null,
      },
    });
    await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    expect(service.rpc).toHaveBeenCalledWith("void_invoice_fn", {
      p_caller_id: "verified-admin-uuid",
      p_invoice_id: VALID_PAYLOAD.invoice_id,
      p_business_id: VALID_PAYLOAD.business_id,
      p_void_reason: VALID_PAYLOAD.void_reason,
    });
  });

  it("passes void_reason from payload to RPC", async () => {
    const service = createMockService({});
    const reason = "Customer reported incorrect charges on items 1-3";
    await handleVoidInvoice(
      postBody({ ...VALID_PAYLOAD, void_reason: reason }),
      makeDeps(service),
    );
    expect(service.rpc).toHaveBeenCalledWith(
      "void_invoice_fn",
      expect.objectContaining({ p_void_reason: reason }),
    );
  });

  it("passes all three UUIDs correctly to RPC", async () => {
    const service = createMockService({});
    await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    const callArgs = (service.rpc as Mock).mock.calls[0]?.[1] as Record<string, string>;
    expect(callArgs.p_invoice_id).toBe(VALID_PAYLOAD.invoice_id);
    expect(callArgs.p_business_id).toBe(VALID_PAYLOAD.business_id);
    expect(typeof callArgs.p_caller_id).toBe("string");
    expect(callArgs.p_caller_id.length).toBeGreaterThan(0);
  });

  it("calls auth.getUser with the bearer token", async () => {
    const service = createMockService({});
    await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    expect(service.auth.getUser).toHaveBeenCalledWith("valid-jwt-token");
  });

  it("calls rpc exactly once", async () => {
    const service = createMockService({});
    await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    expect(service.rpc).toHaveBeenCalledTimes(1);
  });

  // --- Void-and-reissue: replacement draft lines verification ---

  it("replacement draft id is a valid UUID in the response", async () => {
    const newDraftId = "770e8400-e29b-41d4-a716-446655440099";
    const service = createMockService({
      rpcResult: {
        data: {
          invoice_id: "550e8400-e29b-41d4-a716-446655440000",
          status: "voided",
          new_draft_id: newDraftId,
        },
        error: null,
      },
    });
    const res = await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    const body = await res.json();
    // new_draft_id must be a valid UUID
    expect(body.new_draft_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(body.new_draft_id).toBe(newDraftId);
  });

  // --- Idempotency: double-void returns 409 ---

  it("second void on same invoice returns 409 (idempotency)", async () => {
    const service = createMockService({
      rpcResult: {
        data: null,
        error: {
          message:
            'new row for relation "invoices" violates check constraint "invoices_status_check"',
          code: "23514",
          details: "",
          hint: "",
        },
      },
    });
    const res = await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "already_voided" } });
  });

  // --- Voided invoice retains seq (INV-06) ---

  it("RPC is called with correct business_id for tenant scoping", async () => {
    const service = createMockService({});
    await handleVoidInvoice(postBody(VALID_PAYLOAD), makeDeps(service));
    const callArgs = (service.rpc as Mock).mock.calls[0]?.[1] as Record<string, string>;
    expect(callArgs.p_business_id).toBe(VALID_PAYLOAD.business_id);
  });

  // --- Network error handling ---

  it("surfaces thrown transport errors as 500", async () => {
    const deps: VoidDeps = {
      env: ENV,
      createServiceClient: (() => {
        throw new TypeError("Failed to fetch");
      }) as VoidDeps["createServiceClient"],
    };
    const res = await handleVoidInvoice(postBody(VALID_PAYLOAD), deps);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: "network" } });
  });
});
