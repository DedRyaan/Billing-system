// Auth module behaviors (plan 03-03 Task 1) - RED phase.
// All deps injected; ZERO network.

import { describe, expect, it, vi } from "vitest";
import {
  adoptSession,
  classifySessionEnd,
  observeAuthFailures,
  restoreSession,
  signIn,
  signOutLocal,
} from "../src/auth";
import { createBillingClient } from "../src/client";
import type { SupabaseClient } from "@supabase/supabase-js";

const ENV = { url: "https://example.supabase.co", anonKey: "anon" };

/** Memory storage so auth-js never touches (missing) node localStorage. */
function memoryStorage(): import("@supabase/supabase-js").SupportedStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  };
}

function makeClient(overrides: Partial<Record<string, unknown>> = {}): SupabaseClient {
  const client = createBillingClient(ENV, { storage: memoryStorage() });
  for (const [k, v] of Object.entries(overrides)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any)[k] = v;
  }
  return client;
}

const SESSION_JSON = {
  access_token: "at",
  refresh_token: "rt",
  token_type: "bearer",
  expires_in: 3600,
  user: { id: "u1" },
};

describe("signIn", () => {
  it("returns ok:true carrying the raw session JSON", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: SESSION_JSON, error: null });
    const result = await signIn({ invoke }, { email: "User@Example.com ", password: "pw" });
    expect(result).toEqual({ ok: true, session: SESSION_JSON });
    // Email normalized identically to migration 0008 lower(btrim()) storage.
    expect(invoke).toHaveBeenCalledWith(
      "auth-sign-in",
      expect.objectContaining({
        body: { action: "sign-in", email: "user@example.com", password: "pw" },
      }),
    );
  });

  it("maps invalid_credentials body to the shared-copy reason", async () => {
    const http401 = {
      name: "FunctionsHttpError",
      context: {
        json: async () => ({
          error: { code: "invalid_credentials", message: "Invalid email or password." },
        }),
      },
    };
    const invoke = vi.fn().mockResolvedValue({ data: null, error: http401 });
    const result = await signIn({ invoke }, { email: "a@b.co", password: "x" });
    expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("maps thrown transport failures to network", async () => {
    const invoke = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await signIn({ invoke }, { email: "a@b.co", password: "x" });
    expect(result).toMatchObject({ ok: false, reason: "network" });
  });

  it("maps relay-style errors to network", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: { name: "FunctionsRelayError", message: "relay" },
    });
    const result = await signIn({ invoke }, { email: "a@b.co", password: "x" });
    expect(result).toMatchObject({ ok: false, reason: "network" });
  });

  it("maps malformed success payloads to unknown_response", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { weird: true }, error: null });
    const result = await signIn({ invoke }, { email: "a@b.co", password: "x" });
    expect(result).toMatchObject({ ok: false, reason: "unknown_response" });

    const invoke2 = vi.fn().mockResolvedValue({
      data: { access_token: "only-one-token" },
      error: null,
    });
    const result2 = await signIn({ invoke: invoke2 }, { email: "a@b.co", password: "x" });
    expect(result2).toMatchObject({ ok: false, reason: "unknown_response" });
  });

  it("maps HTTP error bodies with foreign codes to unknown_response", async () => {
    const http400 = {
      name: "FunctionsHttpError",
      context: { json: async () => ({ error: { code: "invalid_payload" } }) },
    };
    const invoke = vi.fn().mockResolvedValue({ data: null, error: http400 });
    const result = await signIn({ invoke }, { email: "not-an-email", password: "x" });
    expect(result).toMatchObject({ ok: false, reason: "unknown_response" });
  });
});

describe("adoptSession", () => {
  it("extracts access+refresh tokens into setSession", async () => {
    const setSession = vi.fn().mockResolvedValue({ data: {}, error: null });
    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.auth as any).setSession = setSession;
    await adoptSession(client, SESSION_JSON);
    expect(setSession).toHaveBeenCalledWith({ access_token: "at", refresh_token: "rt" });
  });

  it("surfaces setSession errors as a union, not an exception", async () => {
    const setSession = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Invalid JWT" },
    });
    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.auth as any).setSession = setSession;
    const result = await adoptSession(client, SESSION_JSON);
    expect(result).toEqual({ ok: false, reason: "unknown", message: "Invalid JWT" });
  });
});

describe("restoreSession", () => {
  it("reports authenticated when a persisted session exists", async () => {
    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.auth as any).getSession = async () => ({
      data: { session: { access_token: "a", refresh_token: "r" } },
      error: null,
    });
    await expect(restoreSession(client)).resolves.toEqual({ status: "authenticated" });
  });

  it("reports unauthenticated when none exists", async () => {
    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.auth as any).getSession = async () => ({ data: { session: null }, error: null });
    await expect(restoreSession(client)).resolves.toEqual({ status: "unauthenticated" });
  });

  it("never throws - storage explosions degrade to unauthenticated", async () => {
    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.auth as any).getSession = async () => {
      throw new Error("storage corrupted");
    };
    await expect(restoreSession(client)).resolves.toEqual({ status: "unauthenticated" });
  });
});

describe("signOutLocal", () => {
  it("resolves to ok on success", async () => {
    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.auth as any).signOut = async () => ({ error: null });
    await expect(signOutLocal(client)).resolves.toEqual({ ok: true });
  });

  it("surfaces signOut errors as a union", async () => {
    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.auth as any).signOut = async () => ({ error: { message: "boom" } });
    await expect(signOutLocal(client)).resolves.toMatchObject({ ok: false });
  });
});

describe("observeAuthFailures", () => {
  type Handler = (event: string, session: unknown) => void;
  function clientWithEmitter() {
    let handler: Handler | undefined;
    const unsubscribe = vi.fn();
    const client = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.auth as any).onAuthStateChange = (cb: Handler) => {
      handler = cb;
      return { data: { subscription: { unsubscribe } } };
    };
    return { client, fire: (e: string, s?: unknown) => handler?.(e, s ?? null), unsubscribe };
  }

  it("emits refresh_rejected on SIGNED_OUT", () => {
    const { client, fire } = clientWithEmitter();
    const cb = vi.fn();
    observeAuthFailures(client, cb);
    fire("SIGNED_OUT", null);
    expect(cb).toHaveBeenCalledWith({ kind: "refresh_rejected" });
  });

  it("emits refresh_rejected on TOKEN_REFRESHED carrying no session", () => {
    const { client, fire } = clientWithEmitter();
    const cb = vi.fn();
    observeAuthFailures(client, cb);
    fire("TOKEN_REFRESHED", null);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("never emits on INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED-with-session", () => {
    const { client, fire } = clientWithEmitter();
    const cb = vi.fn();
    observeAuthFailures(client, cb);
    fire("INITIAL_SESSION", {});
    fire("SIGNED_IN", { access_token: "a" });
    fire("TOKEN_REFRESHED", { access_token: "a" });
    expect(cb).not.toHaveBeenCalled();
  });

  it("unsubscribe propagates", () => {
    const { client, unsubscribe } = clientWithEmitter();
    const stop = observeAuthFailures(client, vi.fn());
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe("classifySessionEnd", () => {
  it("locked_at wins", () => {
    expect(classifySessionEnd({ locked_at: "2026-01-01", is_active: true })).toBe("locked");
    expect(classifySessionEnd({ locked_at: "2026-01-01", is_active: false })).toBe("locked");
  });
  it("inactive -> deactivated", () => {
    expect(classifySessionEnd({ locked_at: null, is_active: false })).toBe("deactivated");
  });
  it("otherwise ended", () => {
    expect(classifySessionEnd({ locked_at: null, is_active: true })).toBe("ended");
  });
});
