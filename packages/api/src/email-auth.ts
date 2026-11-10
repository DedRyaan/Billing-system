// Email-based auth: magic-link sign-in and password-reset emails, plus the
// callback parser for links that come back into the desktop app.
//
// Every email carries BOTH a one-time code and a link:
//   * the code works anywhere (type it into the app, even if the email was
//     read on a phone);
//   * the link goes through Supabase's /verify endpoint, which redirects to
//     AUTH_REDIRECT_URL (bahi://auth/callback#access_token=...). Windows hands
//     that URL to the installed app via the registered bahi:// scheme.
//
// Enumeration resistance: sending never reveals whether an account exists.
// The UI shows one "if an account exists" message for every outcome except
// rate limiting and network failure, which say nothing about the address.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoTrueSessionJSON } from "./auth";

/** Where email links land. Must be in the project's redirect allow-list. */
export const AUTH_REDIRECT_URL = "bahi://auth/callback";

export type EmailSendResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" | "network" };

export type EmailCodePurpose = "sign_in" | "recovery";

export type VerifyCodeResult =
  | { ok: true; session: GoTrueSessionJSON }
  | { ok: false; reason: "invalid_code" | "rate_limited" | "network" };

interface AuthErrorLike {
  status?: number;
  code?: string;
  name?: string;
  message?: string;
}

function isRateLimit(err: AuthErrorLike): boolean {
  return err.status === 429 || (err.code ?? "").includes("rate_limit");
}

function isNetwork(err: AuthErrorLike): boolean {
  return err.name === "AuthRetryableFetchError" || err.status === 0;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Classify a send failure; anything that is not throttling/network is hidden. */
function sendOutcome(error: AuthErrorLike | null): EmailSendResult {
  if (error === null) return { ok: true };
  if (isRateLimit(error)) return { ok: false, reason: "rate_limited" };
  if (isNetwork(error)) return { ok: false, reason: "network" };
  // Unknown address ("Signups not allowed for otp"), banned user, etc. all
  // look like success to the person typing - never confirm an account exists.
  return { ok: true };
}

/** Email a one-time sign-in link + code. Never creates an account. */
export async function sendSignInEmail(
  client: SupabaseClient,
  email: string,
): Promise<EmailSendResult> {
  try {
    const { error } = await client.auth.signInWithOtp({
      email: normalizeEmail(email),
      options: { shouldCreateUser: false, emailRedirectTo: AUTH_REDIRECT_URL },
    });
    return sendOutcome(error as AuthErrorLike | null);
  } catch {
    return { ok: false, reason: "network" };
  }
}

/**
 * Email a password-reset link + code. Used from the sign-in screen
 * ("Forgot password?") and by admins from Team for a staff member.
 */
export async function sendPasswordResetEmail(
  client: SupabaseClient,
  email: string,
): Promise<EmailSendResult> {
  try {
    const { error } = await client.auth.resetPasswordForEmail(normalizeEmail(email), {
      redirectTo: AUTH_REDIRECT_URL,
    });
    return sendOutcome(error as AuthErrorLike | null);
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** Exchange the code typed from an email for a session. */
export async function verifyEmailCode(
  client: SupabaseClient,
  input: { email: string; code: string; purpose: EmailCodePurpose },
): Promise<VerifyCodeResult> {
  const token = input.code.replace(/\s+/g, "");
  if (!/^\d{6,10}$/.test(token)) return { ok: false, reason: "invalid_code" };
  try {
    const { data, error } = await client.auth.verifyOtp({
      email: normalizeEmail(input.email),
      token,
      type: input.purpose === "recovery" ? "recovery" : "email",
    });
    if (error) {
      const e = error as AuthErrorLike;
      if (isRateLimit(e)) return { ok: false, reason: "rate_limited" };
      if (isNetwork(e)) return { ok: false, reason: "network" };
      return { ok: false, reason: "invalid_code" };
    }
    if (!data.session) return { ok: false, reason: "invalid_code" };
    return {
      ok: true,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export type AuthCallback =
  | {
      kind: "session";
      session: GoTrueSessionJSON;
      /** "recovery" for password-reset links, "magiclink" for sign-in links. */
      type: string;
      /** Subject (user id) read from the access token, for routing only. */
      userId: string | null;
    }
  | { kind: "error"; code: string; description: string };

function decodeJwtSubject(jwt: string): string | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Parse a bahi://auth/callback URL. Returns null for anything that is not an
 * auth callback (other deep links, malformed input).
 */
export function parseAuthCallbackUrl(raw: string): AuthCallback | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "bahi:") return null;
  // bahi://auth/callback parses as host "auth", path "/callback".
  const route = `${url.host}${url.pathname}`.replace(/\/+$/, "");
  if (route !== "auth/callback") return null;

  // Supabase puts tokens (and errors) in the fragment; errors may also come
  // as query parameters.
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  for (const [k, v] of url.searchParams) if (!params.has(k)) params.set(k, v);

  const error = params.get("error") ?? params.get("error_code");
  if (error !== null) {
    return {
      kind: "error",
      code: params.get("error_code") ?? error,
      description: params.get("error_description") ?? "",
    };
  }
  const access = params.get("access_token");
  const refresh = params.get("refresh_token");
  if (!access || !refresh) return null;
  return {
    kind: "session",
    session: { access_token: access, refresh_token: refresh },
    type: params.get("type") ?? "magiclink",
    userId: decodeJwtSubject(access),
  };
}
