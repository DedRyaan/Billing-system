import { describe, expect, it } from "vitest";
// The REAL Edge Function source - resolved at runtime by the vitest alias
// (vitest.config.ts) to supabase/functions/auth-sign-in/index.ts; types come
// from test/stubs/auth-sign-in.d.ts.
import { handleAuthSignIn } from "auth-sign-in-source";
import {
  GENERIC_CREDENTIALS_ERROR_BODY,
  GENERIC_CREDENTIALS_MESSAGE,
  PAYMENT_OVERPAYMENT_CODE,
  toDataAccessError,
} from "../src/errors";

const HANDLER_ENV = {
  SUPABASE_URL: "http://localhost",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-service-role",
};

type LockedProfile = { id: string; locked_at: string | null };

/**
 * Fake service client whose profile lookup returns a LOCKED profile. This
 * drives auth-sign-in down its earliest generic-failure return site without
 * any GoTrue traffic or env requirements.
 */
function lockedServiceClient(profile: LockedProfile | null): never {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: profile, error: null }),
  };
  return {
    from: () => chain,
    rpc: async () => ({ data: null, error: null }),
    auth: {},
  } as never;
}

function signInRequest(): Request {
  return new Request("http://localhost/auth-sign-in", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "sign-in", email: "user@example.com", password: "pw" }),
  });
}

describe("generic credentials copy has exactly ONE source", () => {
  it("Edge Function failure body is byte-equal to the shared constant", async () => {
    const res = await handleAuthSignIn(signInRequest(), {
      env: HANDLER_ENV,
      createServiceClient: () =>
        lockedServiceClient({ id: "u1", locked_at: new Date().toISOString() }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as unknown;

    // Byte-level equality of the serialized wire shape proves the UI constant
    // and the server response are the same bytes (T-3-04).
    expect(JSON.stringify(body)).toBe(JSON.stringify(GENERIC_CREDENTIALS_ERROR_BODY));
    expect(body).toEqual(GENERIC_CREDENTIALS_ERROR_BODY);
    expect(
      (body as { error: { message: string; code: string } }).error.message,
    ).toBe(GENERIC_CREDENTIALS_MESSAGE);
    expect(
      (body as { error: { code: string } }).error.code,
    ).toBe("invalid_credentials");
  });

  it("shared constant shape is frozen (code + message)", () => {
    expect(GENERIC_CREDENTIALS_ERROR_BODY.error.code).toBe("invalid_credentials");
    expect(GENERIC_CREDENTIALS_MESSAGE).toBe("Invalid email or password.");
  });
});

describe("toDataAccessError — payment overpayment mapping", () => {
  it("P0001 maps to VALIDATION_FAILED with the Postgres code intact", () => {
    const err = toDataAccessError({
      code: PAYMENT_OVERPAYMENT_CODE,
      message: "payment exceeds invoice balance - total 10000, ledger sum 11000 (overpayment rejected)",
    });
    expect(err.reason).toBe("VALIDATION_FAILED");
    if (err.reason === "VALIDATION_FAILED") {
      expect(err.pgCode).toBe("P0001");
      expect(err.message).toContain("overpayment");
    }
  });

  it("PAYMENT_OVERPAYMENT_CODE constant equals the literal string", () => {
    expect(PAYMENT_OVERPAYMENT_CODE).toBe("P0001");
  });
});
