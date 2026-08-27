import { describe, expect, it } from "vitest";
import type { SupportedStorage } from "@supabase/supabase-js";
import {
  BillingConfigError,
  createBillingClient,
  storageAdapter,
} from "../src/client";
import { toDataAccessError } from "../src/errors";

const ENV = { url: "https://example.supabase.co", anonKey: "anon-key" };

function recordingStorage(): SupportedStorage & { calls: string[] } {
  const calls: string[] = [];
  const map = new Map<string, string>();
  return {
    calls,
    getItem: async (k) => {
      calls.push(`get:${k}`);
      return map.get(k) ?? null;
    },
    setItem: async (k, v) => {
      calls.push(`set:${k}`);
      map.set(k, v);
    },
    removeItem: async (k) => {
      calls.push(`del:${k}`);
      map.delete(k);
    },
  };
}

describe("createBillingClient", () => {
  it("fails fast on empty url", () => {
    expect(() => createBillingClient({ url: "", anonKey: "k" })).toThrow(BillingConfigError);
  });
  it("fails fast on empty anonKey", () => {
    expect(() => createBillingClient({ url: "https://x", anonKey: "" })).toThrow(BillingConfigError);
    try {
      createBillingClient({ url: "https://x", anonKey: "" });
      expect.unreachable();
    } catch (err) {
      expect((err as BillingConfigError).field).toBe("anonKey");
    }
  });

  it("returns a SupabaseClient<Database> with the auth API surface", () => {
    // Always inject storage in tests: the default adapter targets browser
    // localStorage, which does not exist under the node vitest env - and
    // auth-js eagerly loads persisted state at construction time.
    const client = createBillingClient(ENV, { storage: recordingStorage() });
    expect(typeof client.auth.signInWithPassword).toBe("function");
    expect(typeof client.auth.signOut).toBe("function");
    expect(typeof client.from).toBe("function");
  });

  it("plumbs the injected storage into the auth stack (no network)", async () => {
    const storage = recordingStorage();
    const client = createBillingClient(ENV, { storage });
    await client.auth.getSession(); // reads persisted state only - no network
    expect(storage.calls.some((c) => c.startsWith("get:sb-"))).toBe(true);
  });

  it("re-exports the storage adapter unchanged", () => {
    expect(typeof storageAdapter.getItem).toBe("function");
    expect(typeof storageAdapter.setItem).toBe("function");
    expect(typeof storageAdapter.removeItem).toBe("function");
  });
});

describe("toDataAccessError taxonomy", () => {
  it("maps RLS denial 42501 to PERMISSION_DENIED carrying the code", () => {
    const err = toDataAccessError({
      code: "42501",
      message: 'new row violates row-level security policy for table "customers"',
    });
    expect(err).toEqual({
      reason: "PERMISSION_DENIED",
      pgCode: "42501",
      message: 'new row violates row-level security policy for table "customers"',
    });
  });

  it("maps .single() zero rows PGRST116 to ROW_NOT_FOUND", () => {
    expect(toDataAccessError({ code: "PGRST116", message: "No rows found" })).toMatchObject({
      reason: "ROW_NOT_FOUND",
    });
  });

  it("maps check/unique violations to VALIDATION_FAILED", () => {
    for (const code of ["23514", "23505", "23503", "22P02"]) {
      expect(toDataAccessError({ code, message: "boom" })).toMatchObject({
        reason: "VALIDATION_FAILED",
        pgCode: code,
      });
    }
  });

  it("maps fetch failures to NETWORK", () => {
    expect(toDataAccessError(new TypeError("Failed to fetch"))).toMatchObject({
      reason: "NETWORK",
    });
    expect(toDataAccessError(new Error("fetch failed"))).toMatchObject({
      reason: "NETWORK",
    });
  });

  it("maps P0001 overpayment to VALIDATION_FAILED (payment trigger guard)", () => {
    const err = toDataAccessError({ code: "P0001", message: "payment exceeds invoice balance" });
    expect(err).toEqual({ reason: "VALIDATION_FAILED", message: "payment exceeds invoice balance", pgCode: "P0001" });
  });

  it("wraps plain errors as UNKNOWN", () => {
    expect(toDataAccessError(new Error("weird"))).toEqual({
      reason: "UNKNOWN",
      message: "weird",
    });
    expect(toDataAccessError(42)).toEqual({ reason: "UNKNOWN", message: "42" });
  });

  it("maps PostgREST status-carrying 403 to PERMISSION_DENIED", () => {
    const err = { message: "forbidden", status: 403 };
    expect(toDataAccessError(err)).toMatchObject({ reason: "PERMISSION_DENIED" });
  });
});
