// Auth module - the Edge-Function-first sign-in flow + session lifecycle
// unions (plan 03-03, AUTH-01/AUTH-05, D-70..D-73).
//
// Dual-runtime precedent (auth-sign-in/bootstrap-super-admin style): every
// function takes injected deps so tests run against fakes with zero network.
//
// Enumeration-resistance posture: signIn NEVER invents a lockout signal.
// Sign-in failures are exactly what the server body says - and the server
// says only 'invalid_credentials' for unknown email, wrong password AND
// locked accounts alike (T-1-27/T-3-08). Locked/deactivated knowledge is
// POST-HOC only, via classifySessionEnd on the user's OWN profile row.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimal structural view of a GoTrue session JSON as returned by auth-sign-in. */
export interface GoTrueSessionJSON {
  access_token: string;
  refresh_token: string;
  [key: string]: unknown;
}

export type SignInFailureReason = "invalid_credentials" | "network" | "unknown_response";

export type SignInResult =
  | { ok: true; session: GoTrueSessionJSON }
  | { ok: false; reason: SignInFailureReason; message?: string };

export interface SignInInput {
  email: string;
  password: string;
}

type InvokeFn = (functionName: string, options?: { body?: unknown }) => Promise<unknown>;

interface InvokeEnvelope<T> {
  data: T | null;
  error: unknown;
}

export interface AuthFunctionDeps {
  /** Injectable transport; defaults to client.functions.invoke. */
  invoke?: InvokeFn;
  client?: SupabaseClient;
}

function defaultInvoke(deps: AuthFunctionDeps): InvokeFn {
  if (deps.invoke) return deps.invoke;
  const client = deps.client;
  if (!client) throw new Error("signIn deps require an invoke fn or a client");
  return (functionName, options) =>
    client.functions.invoke(functionName, options as Parameters<typeof client.functions.invoke>[1]) as
      ReturnType<InvokeFn>;
}

interface FunctionsHttpLikeError {
  name?: string;
  context?: { json?: () => Promise<unknown> };
}

async function errorBody(error: unknown): Promise<unknown | null> {
  const candidate = error as FunctionsHttpLikeError | null;
  if (candidate && typeof candidate === "object" && candidate.context?.json) {
    try {
      return (await candidate.context.json()) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

/** Extract the error code from either {error:{code}} or flat {code} body shapes. */
function bodyErrorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const nested = record["error"];
  if (typeof nested === "object" && nested !== null) {
    const code = (nested as Record<string, unknown>)["code"];
    if (typeof code === "string") return code;
  }
  const code = record["code"];
  return typeof code === "string" ? code : undefined;
}

function isGoTrueSessionJSON(value: unknown): value is GoTrueSessionJSON {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const accessToken = record["access_token"];
  return (
    typeof accessToken === "string" && accessToken.length > 0 && typeof record["refresh_token"] === "string"
  );
}

/**
 * Sign in through the auth-sign-in Edge Function (never direct GoTrue -
 * lockout counting lives there). Email is normalized identically to
 * migration 0008's lower(btrim()) storage so attempt counting cannot split
 * across case/whitespace variants.
 */
export async function signIn(deps: AuthFunctionDeps, input: SignInInput): Promise<SignInResult> {
  const invoke = defaultInvoke(deps);
  let envelope: InvokeEnvelope<unknown>;
  try {
    envelope = (await invoke("auth-sign-in", {
      body: {
        action: "sign-in",
        email: input.email.trim().toLowerCase(),
        password: input.password,
      },
    })) as InvokeEnvelope<unknown>;
  } catch (err) {
    // Transport-level failure (offline, DNS, CORS...).
    return {
      ok: false,
      reason: "network",
      ...(err instanceof Error ? { message: err.message } : {}),
    };
  }

  if (envelope.error) {
    const code = bodyErrorCode(await errorBody(envelope.error));
    if (code === "invalid_credentials") return { ok: false, reason: "invalid_credentials" };
    const name = (envelope.error as { name?: string })?.name ?? "";
    if (!name.includes("Http")) {
      // Relay/transport-class error from the functions runtime.
      return { ok: false, reason: "network" };
    }
    // HTTP error whose body carried no recognizable code.
    return { ok: false, reason: "unknown_response", message: name || "http_error" };
  }

  const data = envelope.data;
  // Some supabase-js versions unwrap data to the payload directly.
  const payload =
    data !== null &&
    typeof data === "object" &&
    "data" in (data as Record<string, unknown>) &&
    !("access_token" in (data as Record<string, unknown>))
      ? (data as { data: unknown }).data
      : data;

  if (!isGoTrueSessionJSON(payload)) {
    return { ok: false, reason: "unknown_response" };
  }
  return { ok: true, session: payload };
}

export type AdoptSessionResult =
  | { ok: true }
  | { ok: false; reason: "unknown"; message: string };

/** Adopt a returned session into the client's auth stack (persists via storage seam). */
export async function adoptSession(
  client: SupabaseClient,
  sessionJson: GoTrueSessionJSON,
): Promise<AdoptSessionResult> {
  const res = await client.auth.setSession({
    access_token: sessionJson.access_token,
    refresh_token: sessionJson.refresh_token,
  });
  if (res.error) {
    return { ok: false, reason: "unknown", message: res.error.message };
  }
  return { ok: true };
}

export type RestoreResult = { status: "authenticated" | "unauthenticated" };

/** Restore-before-render read of persisted state. NEVER throws (D-72 no half-auth). */
export async function restoreSession(client: SupabaseClient): Promise<RestoreResult> {
  try {
    const { data } = await client.auth.getSession();
    return { status: data.session ? "authenticated" : "unauthenticated" };
  } catch {
    return { status: "unauthenticated" };
  }
}

export type SignOutResult = { ok: true } | { ok: false; reason: "network" | "unknown"; message?: string };

/** Sign out THIS device only (AUTH-05/D-71); errors surface as union. */
export async function signOutLocal(client: SupabaseClient): Promise<SignOutResult> {
  try {
    const { error } = await client.auth.signOut();
    if (error) return { ok: false, reason: "unknown", message: error.message };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? "network" : "unknown",
      ...(err instanceof Error ? { message: err.message } : {}),
    };
  }
}

export interface AuthFailureEvent {
  kind: "refresh_rejected";
}

/**
 * Wrap onAuthStateChange and emit ONLY post-hoc failure events:
 * SIGNED_OUT pushed by the server / TOKEN_REFRESHED arriving without a
 * session. Explicit local signOut suppression is the CONSUMER's job (the
 * interceptor sets its own flag while calling signOutLocal) - this module
 * stays a faithful event mirror.
 */
export function observeAuthFailures(
  client: SupabaseClient,
  cb: (event: AuthFailureEvent) => void,
): () => void {
  const { data } = client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      cb({ kind: "refresh_rejected" });
      return;
    }
    if (event === "TOKEN_REFRESHED" && !session) {
      cb({ kind: "refresh_rejected" });
    }
  });
  return () => data.subscription.unsubscribe();
}

export type SessionEndReason = "locked" | "deactivated" | "ended";

export interface SessionEndProfile {
  locked_at: string | null;
  is_active: boolean;
}

/**
 * Post-hoc taxonomy (D-72/T-3-08): probing the user's OWN profile after a
 * refresh rejection yields exactly one honest banner reason.
 */
export function classifySessionEnd(profile: SessionEndProfile): SessionEndReason {
  if (profile.locked_at !== null) return "locked";
  if (!profile.is_active) return "deactivated";
  return "ended";
}

