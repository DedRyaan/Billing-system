// auth-sign-in — the D-28 brute-force lockout boundary (Plan 07).
//
// ONE audited service-role chokepoint for every password sign-in, because the
// Supabase Password Verification Hook is Teams/Enterprise-only (RESEARCH
// critical finding): on the Free tier (D-39) attempt counting lives HERE.
//
//   sign-in {email,password}
//     1. zod-validates (400 on malformed) BEFORE any GoTrue call
//     2. locked pre-check: a profile whose locked_at is set is rejected
//        IMMEDIATELY with the generic error — including when the presented
//        password is CORRECT (D-28's core truth). No GoTrue call, no new
//        ledger rows: a locked account accrues nothing further.
//     3. otherwise performs GoTrue's password grant itself over REST
//        (/auth/v1/token?grant=password, anon apikey header) and inspects
//        the outcome:
//        SUCCESS -> record_login_attempt(success=true), write_audit
//                   ('auth.login'), session JSON returned UNTOUCHED
//        FAILURE -> record_login_attempt(success=false) +
//                   write_audit('auth.login_failed'); when the returned
//                   consecutive-failure count reaches 5:
//                     auth.admin.updateUserById(target,{ban_duration:'292000h'})
//                     rpc set_locked_at(target)            (migration 0008)
//                     write_audit('auth.lockout')
//                   ~33 years is EFFECTIVELY PERMANENT: there is no
//                   auto-unlock timer anywhere (D-28) — restoration flows
//                   exclusively through the audited admin unlock path below.
//     UNKNOWN-EMAIL and WRONG-PASSWORD return byte-identical generic bodies
//     (one shared constant, two return sites) — no user enumeration (T-1-27).
//
//   unlock {target_user_id}
//     Caller JWT verified through GoTrue, role resolved from the SERVER-
//     CONTROLLED profiles row (never JWT metadata): admin/super_admin only,
//     active. Target must currently be banned or locked (else 409). Clears
//     the GoTrue ban via updateUserById({ban_duration:null}), then calls
//     Plan 06's unlock_account_profile RPC — which clears profiles.locked_at
//     inside its own audit trail (profile.unlock). This is the narrow D-29
//     exception working end-to-end: ANY admin may unlock even a locked-out
//     super admin; nothing about the account besides the lock is touched.
//
// ACCEPTED RESIDUAL (A4, T-1-26): an attacker hitting GoTrue DIRECTLY with
// the public project URL + anon key bypasses THIS counting entirely. Accepted
// for a small trusted team on a private deployment; CAPTCHA layering is the
// planned mitigation at the D-40 Pro upgrade. Everything routed through this
// function is counted, banned at five strikes, and audited (D-23 access
// events: auth.login / auth.login_failed / auth.lockout).
//
// OPEN QUESTION 1 SPIKE HOOK (RESEARCH): whether a ban_duration also rejects
// LIVE refresh-token exchanges needs the local stack (Docker) — the wire
// suite in tests/lockout.test.ts carries the probe; result recorded in the
// plan SUMMARY.
//
// Rate limiting: platform limits + full audit visibility (same accepted
// stance as bootstrap-super-admin / invite-user, T-1-25 mitigations).
//
// Service-role key confinement: SUPABASE_SERVICE_ROLE_KEY is injected into
// the function runtime ONLY — never hardcoded, never returned (T-1-28).
//
// Dual-runtime note (bootstrap/invite precedent): bare `zod` /
// @supabase/supabase-js imports resolve in Deno 2 (edge runtime) and under
// Node/vitest, where tests import handleAuthSignIn() with injected deps.

import { createClient as supabaseCreateClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const LOCKOUT_THRESHOLD = 5;
// ~292000h ≈ 33.3 years: beyond any realistic horizon, so the ban behaves as
// permanent while staying a plain Admin API value available on ALL plans.
const BAN_DURATION = "292000h";
const MIN_PASSWORD_LENGTH = 8;

/**
 * THE generic credential-failure body. Referenced by BOTH the unknown-email
 * and wrong-password return sites — byte-identical responses, no enumeration
 * signal (T-1-27). Also used for locked-account rejections so attackers learn
 * nothing about account state from response shape.
 */
const GENERIC_CREDENTIALS_ERROR = {
  error: { code: "invalid_credentials", message: "Invalid email or password." },
};

const commandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("sign-in"),
    // Normalized identically to migration 0008's lower(btrim()) storage so
    // attempt counting cannot be split across case/whitespace variants.
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(1),
  }),
  z.object({
    action: z.literal("unlock"),
    target_user_id: z.uuid(),
  }),
]);

export interface AuthSignInDeps {
  env?: Record<string, string | undefined>;
  createServiceClient?: (url: string, serviceKey: string) => SupabaseClient;
  /** Injectable transport for the GoTrue password-grant call (vitest). */
  gotrueFetch?: typeof fetch;
}

interface CallerProfile {
  id: string;
  role: string;
  is_active: boolean;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

async function audit(
  service: SupabaseClient,
  p_action: string,
  p_target_id: string | null,
  p_after: Record<string, unknown>,
): Promise<void> {
  await service.rpc("write_audit", {
    p_action,
    p_target_table: "profiles",
    p_target_id,
    p_business_id: null,
    p_before: null,
    p_after: JSON.stringify(p_after),
  });
}

/** Server-controlled profile lookup by canonical email (never user_metadata). */
async function profileByEmail(
  service: SupabaseClient,
  email: string,
): Promise<{ id: string; locked_at: string | null } | null> {
  const res = await service
    .from("profiles")
    .select("id, locked_at")
    .eq("email", email)
    .maybeSingle();
  return res.error ? null : (res.data as { id: string; locked_at: string | null } | null);
}

async function runSignIn(
  req: Request,
  service: SupabaseClient,
  cmd: { email: string; password: string },
  deps: AuthSignInDeps,
  env: Record<string, string | undefined>,
): Promise<Response> {
  // Locked pre-check FIRST (D-28): correct passwords do not open a locked
  // account. Rejection precedes any GoTrue traffic and records nothing.
  const existing = await profileByEmail(service, cmd.email);
  if (existing?.locked_at) {
    return json(GENERIC_CREDENTIALS_ERROR, 401);
  }

  const anonKey = env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    return json({ error: { code: "server_misconfigured" } }, 500);
  }
  const grantFetch = deps.gotrueFetch ?? globalThis.fetch;
  const grant = await grantFetch(`${env.SUPABASE_URL}/auth/v1/token?grant=password`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email: cmd.email, password: cmd.password }),
  });
  const grantBody: unknown = await grant.json().catch(() => null);

  if (grant.ok) {
    const session = grantBody as { user?: { id?: string } } | null;
    await service.rpc("record_login_attempt", {
      p_email: cmd.email,
      p_user_id: existing?.id ?? null,
      p_success: true,
    });
    await audit(service, "auth.login", existing?.id ?? null, {
      email: cmd.email,
      method: "password_grant",
    });
    return json(session, 200);
  }

  // FAILURE branch (wrong password AND unknown email land here — GoTrue
  // rejects both with 400-class errors; both map to the SAME generic body).
  const counted = await service.rpc("record_login_attempt", {
    p_email: cmd.email,
    p_user_id: existing?.id ?? null,
    p_success: false,
  });
  const failures =
    typeof counted.data === "number" ? counted.data : Number(counted.data ?? 0);

  if (failures >= LOCKOUT_THRESHOLD && existing && !existing.locked_at) {
    // Fifth strike: ban at GoTrue (effectively permanent — no timer, D-28),
    // mirror onto profiles.locked_at via the marker'd helper, then audit.
    const banned = await service.auth.admin.updateUserById(existing.id, {
      ban_duration: BAN_DURATION,
    });
    if (banned.error) {
      await audit(service, "auth.lockout_failed", existing.id, {
        email: cmd.email,
        reason: banned.error.message,
        consecutive_failures: failures,
      });
      return json(GENERIC_CREDENTIALS_ERROR, 401);
    }
    const mirrored = await service.rpc("set_locked_at", { p_user_id: existing.id });
    if (mirrored.error) {
      await audit(service, "auth.lockout_failed", existing.id, {
        email: cmd.email,
        reason: "set_locked_at_failed",
        consecutive_failures: failures,
        gotrue_ban_applied: true,
      });
      return json(GENERIC_CREDENTIALS_ERROR, 401);
    }
    await audit(service, "auth.lockout", existing.id, {
      email: cmd.email,
      ban_duration: BAN_DURATION,
      consecutive_failures: failures,
      auto_unlock: false, // D-28: restoration ONLY via audited admin unlock
    });
  }

  await audit(service, "auth.login_failed", existing?.id ?? null, {
    email: cmd.email,
    consecutive_failures: failures,
  });
  return json(GENERIC_CREDENTIALS_ERROR, 401);
}

async function resolveAdminCaller(
  service: SupabaseClient,
  token: string | null,
): Promise<{ ok: true; caller: CallerProfile } | { ok: false; status: number; code: string }> {
  if (!token) {
    return { ok: false, status: 401, code: "missing_bearer" };
  }
  // Signature/expiry verified by GoTrue itself — no local JWT parsing trust.
  const verified = await service.auth.getUser(token);
  if (verified.error || !verified.data.user) {
    return { ok: false, status: 401, code: "invalid_token" };
  }
  const profileRes = await service
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", verified.data.user.id)
    .single();
  if (profileRes.error || !profileRes.data) {
    return { ok: false, status: 403, code: "no_profile" };
  }
  const caller = profileRes.data as CallerProfile;
  if (!caller.is_active || !(caller.role === "admin" || caller.role === "super_admin")) {
    // Staff hold zero unlock power (D-28/D-29: admins only).
    return { ok: false, status: 403, code: "forbidden" };
  }
  return { ok: true, caller };
}

async function runUnlock(
  service: SupabaseClient,
  targetUserId: string,
): Promise<Response> {
  // Target must CURRENTLY be banned/locked — unlocking a free account is a
  // meaningless (and unauditable-as-unlock) no-op, refused loudly.
  const [goTrueRes, profileRes] = await Promise.all([
    service.auth.admin.getUserById(targetUserId),
    service.from("profiles").select("id, locked_at").eq("id", targetUserId).maybeSingle(),
  ]);
  const bannedUntil = (goTrueRes.data?.user as { banned_until?: string | null } | null)
    ?.banned_until ?? null;
  const lockedAt = (profileRes.data as { locked_at: string | null } | null)?.locked_at ?? null;
  if (!goTrueRes.error && !bannedUntil && !lockedAt) {
    return json({ error: { code: "not_locked" } }, 409);
  }

  // Step 1: clear the GoTrue ban entirely ("none" is GoTrue's documented
  // clear sentinel for ban_duration — the typed SDK's shape for lifting it).
  const unbanned = await service.auth.admin.updateUserById(targetUserId, {
    ban_duration: "none",
  });
  if (unbanned.error) {
    await audit(service, "auth.unlock_failed", targetUserId, {
      reason: unbanned.error.message,
      stage: "gotrue_unban",
    });
    return json({ error: { code: "unban_failed" } }, 502);
  }

  // Step 2: Plan 06's narrow exception — clears profiles.locked_at and
  // writes the profile.unlock audit entry itself. Changes NOTHING else.
  const unlocked = await service.rpc("unlock_account_profile", { p_target: targetUserId });
  if (unlocked.error) {
    await audit(service, "auth.unlock_failed", targetUserId, {
      reason: unlocked.error.message,
      stage: "profile_unlock_rpc",
      gotrue_unban_applied: true,
    });
    return json({ error: { code: "unlock_failed" } }, 502);
  }

  return json({ mode: "unlocked", user_id: targetUserId }, 200);
}

export async function handleAuthSignIn(
  req: Request,
  deps: AuthSignInDeps = {},
): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: { code: "method_not_allowed" } }, 405);
  }

  const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  const env = deps.env ?? proc.process?.env ?? {};
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return json({ error: { code: "server_misconfigured" } }, 500);
  }
  const service = deps.createServiceClient
    ? deps.createServiceClient(supabaseUrl, serviceKey)
    : supabaseCreateClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  const parsed = commandSchema.safeParse(payload);
  if (!parsed.success) {
    // Malformed/empty credentials die HERE — before ANY GoTrue activity
    // (LOCKOUT-empty-input edge resolution).
    return json({ error: { code: "invalid_payload" } }, 400);
  }

  if (parsed.data.action === "sign-in") {
    return runSignIn(req, service, parsed.data, deps, env);
  }

  const caller = await resolveAdminCaller(service, bearerToken(req));
  if (!caller.ok) {
    return json({ error: { code: caller.code } }, caller.status);
  }
  return runUnlock(service, parsed.data.target_user_id);
}

// Edge runtime entrypoint. Guarded so Node/vitest can import this module for
// handler-level tests without touching Deno globals.
const denoGlobal = globalThis as unknown as {
  Deno?: { serve: (handler: (req: Request) => Promise<Response>) => void };
};
denoGlobal.Deno?.serve((req: Request) => handleAuthSignIn(req));
