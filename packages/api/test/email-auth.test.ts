import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTH_REDIRECT_URL,
  parseAuthCallbackUrl,
  sendPasswordResetEmail,
  sendSignInEmail,
  verifyEmailCode,
} from "../src/email-auth";

function fakeAuth(overrides: Record<string, unknown>): SupabaseClient {
  return { auth: overrides } as unknown as SupabaseClient;
}

// header.payload.signature with payload {"sub":"user-1"} (base64url).
const JWT = `x.${btoa(JSON.stringify({ sub: "user-1" })).replace(/=+$/, "")}.y`;

describe("sendSignInEmail", () => {
  it("never creates accounts and sends links back into the app", async () => {
    const signInWithOtp = vi.fn(async () => ({ data: {}, error: null }));
    const res = await sendSignInEmail(fakeAuth({ signInWithOtp }), "  Priya@Example.IN ");
    expect(res).toEqual({ ok: true });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "priya@example.in",
      options: { shouldCreateUser: false, emailRedirectTo: AUTH_REDIRECT_URL },
    });
  });

  it("hides unknown-address errors (no account enumeration)", async () => {
    const signInWithOtp = vi.fn(async () => ({
      data: {},
      error: { status: 422, code: "otp_disabled", message: "Signups not allowed for otp" },
    }));
    expect(await sendSignInEmail(fakeAuth({ signInWithOtp }), "nobody@x.in")).toEqual({ ok: true });
  });

  it("reports rate limiting and network failure", async () => {
    const limited = vi.fn(async () => ({
      data: {},
      error: { status: 429, code: "over_email_send_rate_limit" },
    }));
    expect(await sendSignInEmail(fakeAuth({ signInWithOtp: limited }), "a@x.in")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await sendSignInEmail(fakeAuth({ signInWithOtp: offline }), "a@x.in")).toEqual({
      ok: false,
      reason: "network",
    });
  });
});

describe("sendPasswordResetEmail", () => {
  it("redirects the reset link to the app", async () => {
    const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
    await sendPasswordResetEmail(fakeAuth({ resetPasswordForEmail }), "A@x.in");
    expect(resetPasswordForEmail).toHaveBeenCalledWith("a@x.in", { redirectTo: AUTH_REDIRECT_URL });
  });
});

describe("verifyEmailCode", () => {
  it("uses the recovery type for reset codes and returns the session", async () => {
    const verifyOtp = vi.fn(async () => ({
      data: { session: { access_token: "at", refresh_token: "rt" } },
      error: null,
    }));
    const res = await verifyEmailCode(fakeAuth({ verifyOtp }), {
      email: "a@x.in",
      code: " 123 456 ",
      purpose: "recovery",
    });
    expect(res).toEqual({ ok: true, session: { access_token: "at", refresh_token: "rt" } });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "a@x.in", token: "123456", type: "recovery" });
  });

  it("uses the email type for sign-in codes", async () => {
    const verifyOtp = vi.fn(async () => ({
      data: { session: { access_token: "at", refresh_token: "rt" } },
      error: null,
    }));
    await verifyEmailCode(fakeAuth({ verifyOtp }), { email: "a@x.in", code: "654321", purpose: "sign_in" });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "a@x.in", token: "654321", type: "email" });
  });

  it("rejects malformed codes without a network call, and maps wrong codes", async () => {
    const verifyOtp = vi.fn(async () => ({
      data: { session: null },
      error: { status: 403, code: "otp_expired" },
    }));
    const client = fakeAuth({ verifyOtp });
    expect(await verifyEmailCode(client, { email: "a@x.in", code: "abc", purpose: "sign_in" })).toEqual({
      ok: false,
      reason: "invalid_code",
    });
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(await verifyEmailCode(client, { email: "a@x.in", code: "111111", purpose: "sign_in" })).toEqual({
      ok: false,
      reason: "invalid_code",
    });
  });
});

describe("parseAuthCallbackUrl", () => {
  it("reads tokens, type and user id from the fragment", () => {
    const parsed = parseAuthCallbackUrl(
      `settle://auth/callback#access_token=${JWT}&expires_in=3600&refresh_token=rt&token_type=bearer&type=recovery`,
    );
    expect(parsed).toEqual({
      kind: "session",
      session: { access_token: JWT, refresh_token: "rt" },
      type: "recovery",
      userId: "user-1",
    });
  });

  it("reads Supabase error redirects", () => {
    expect(
      parseAuthCallbackUrl(
        "settle://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      ),
    ).toEqual({
      kind: "error",
      code: "otp_expired",
      description: "Email link is invalid or has expired",
    });
  });

  it("ignores other schemes, routes and incomplete links", () => {
    expect(parseAuthCallbackUrl("https://auth/callback#access_token=a&refresh_token=b")).toBeNull();
    expect(parseAuthCallbackUrl("settle://bills/123#access_token=a&refresh_token=b")).toBeNull();
    expect(parseAuthCallbackUrl("settle://auth/callback#access_token=a")).toBeNull();
    expect(parseAuthCallbackUrl("not a url")).toBeNull();
  });
});
