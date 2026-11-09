// invite-user — the AUTH-02 admin invitation endpoint (Plan 09).
//
// The ONLY sanctioned account-birth path after bootstrap (D-02): every
// post-bootstrap account arrives through this function's three actions.
//
//   invite {email, full_name?, business_ids?}
//     1. auth.admin.inviteUserByEmail — native 24h-expiring link (D-06, via
//        the Email OTP Expiration setting pinned to 86400s in Plan 10)
//     2. on SMTP-class failure retry up to 4 TOTAL attempts (D-09's 3-4 rule)
//     3. still failing → FALLBACK (D-09 first-class flow):
//        auth.admin.createUser({email_confirm:true}) — MANDATORY flag or
//        sign-in fails email_not_confirmed regardless of dashboard settings
//        (RESEARCH Pitfall 1b / issue #29632) — then mint the profiles row
//        role='staff' (FK substrate for the flag + memberships; rollback =
//        deleteUser so a failed fallback leaves no half-created account),
//        rpc mark_must_change_password (forces password set before app
//        access), insert business_members rows ONLY for explicitly requested
//        business_ids (service role bypasses RLS deliberately here —
//        memberships attach ONLY at this moment; a pending invitee holds
//        ZERO data access until acceptance/grant), respond {mode:'fallback',
//        temp_password} shown ONCE by the admin UI.
//     Success path responds {mode:'invited'}. Duplicate-email collisions
//     surface the Admin API error verbatim as a failed invite (adjacency
//     edge INVITE-duplicate-email) — never a silent fallback attempt.
//
//   cancel {user_id}   pending-only deletion: refuses targets with any sign-in
//                      history (409); auth.admin.deleteUser frees the email
//                      for re-invite (D-07) and old links dead-end natively
//                      with invite_not_found (D-08). Deliberate audited action
//                      (RESEARCH anti-pattern: casual deletion is forbidden).
//
//   list               returns rpc admin_list_invites() — admins see pending
//                      invites (D-07 visibility half). Read-only: no audit
//                      entry by D-23 (read/view telemetry excluded).
//
// Caller gate: POST with Authorization: Bearer <JWT>. The token is verified
// server-side via GoTrue (auth.getUser), then the profile role resolves from
// the SERVER-CONTROLLED profiles row (never JWT metadata) and must be
// admin/super_admin AND is_active — staff receive 403 on every action.
//
// Rate limiting (T-1-36, accepted disposition per plan threat model): relies
// on platform rate limits + full audit-trail visibility of every action;
// zod rejects malformed payloads BEFORE any privileged call.
//
// Service-role key confinement: SUPABASE_SERVICE_ROLE_KEY is injected into
// the function runtime ONLY — it must never reach a client.
//
// Dual-runtime note (bootstrap precedent): bare `zod` / `@supabase/supabase-js`
// imports resolve in Deno 2 (edge runtime) and under Node/vitest, where tests
// import handleInviteUser() directly with injected deps.

import { createClient as supabaseCreateClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { z } from "zod";

const MAX_INVITE_ATTEMPTS = 4;
const MIN_PASSWORD_LENGTH = 8;

const commandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite"),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    full_name: z.string().trim().min(1).max(200).optional(),
    business_ids: z.array(z.uuid()).min(1).optional(),
  }),
  z.object({
    action: z.literal("cancel"),
    user_id: z.uuid(),
  }),
  z.object({
    action: z.literal("list"),
  }),
]);

export interface InviteUserDeps {
  env?: Record<string, string | undefined>;
  createServiceClient?: (
    url: string,
    serviceKey: string,
  ) => SupabaseClient;
}

// WR-07 (same class as bootstrap-status / auth-sign-in): Supabase does not
// inject CORS platform-side. supabase-js functions.invoke() from the Tauri
// webview (http://tauri.localhost) or browser dev sends authorization/apikey/
// content-type headers, which forces a preflight — without these headers the
// call never leaves the preflight stage.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** Cryptographically random temp password meeting the D-05 floor with margin. */
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

interface CallerProfile {
  id: string;
  role: string;
  is_active: boolean;
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
    // Staff / deactivated callers hold zero invitation power (D-07/D-17).
    return { ok: false, status: 403, code: "forbidden" };
  }
  return { ok: true, caller };
}

async function runInvite(
  service: SupabaseClient,
  cmd: { email: string; full_name?: string; business_ids?: string[] },
  env: Record<string, string | undefined>,
): Promise<Response> {
  const redirectTo = env.INVITE_REDIRECT_URL;
  let lastError: { code?: string; message: string } | null = null;

  // D-09: up to 4 total attempts on SMTP-class failure before falling back.
  for (let attempt = 1; attempt <= MAX_INVITE_ATTEMPTS; attempt++) {
    const invited = await service.auth.admin.inviteUserByEmail(
      cmd.email,
      redirectTo ? { redirectTo } : {},
    );
    if (!invited.error && invited.data) {
      await service.rpc("write_audit", {
        p_action: "auth.invite",
        p_target_table: "profiles",
        p_target_id: invited.data.user?.id ?? null,
        p_business_id: null,
        p_before: null,
        p_after: JSON.stringify({ email: cmd.email, mode: "native_link" }),
      });
      return json({ mode: "invited", user_id: invited.data.user?.id ?? null }, 200);
    }
    lastError = { code: invited.error?.code, message: invited.error?.message ?? "invite failed" };
    if (lastError.code === "email_exists") {
      // Adjacency edge INVITE-duplicate-email: collide loudly, verbatim —
      // a fallback createUser would hit the same unique constraint anyway.
      break;
    }
  }

  if (lastError?.code === "email_exists") {
    await service.rpc("write_audit", {
      p_action: "auth.invite_failed",
      p_target_table: "profiles",
      p_target_id: null,
      p_business_id: null,
      p_before: null,
      p_after: JSON.stringify({ email: cmd.email, reason: "email_exists" }),
    });
    return json({ error: { code: "email_exists", message: lastError.message } }, 409);
  }

  // ---- Fallback (D-09): admin-created account, temp password, forced change.
  const tempPassword = generateTempPassword();
  const created = await service.auth.admin.createUser({
    email: cmd.email,
    password: tempPassword,
    email_confirm: true, // MANDATORY — Pitfall 1b / issue #29632
    user_metadata: cmd.full_name ? { full_name: cmd.full_name } : undefined,
  });
  if (created.error || !created.data.user) {
    await service.rpc("write_audit", {
      p_action: "auth.invite_fallback_failed",
      p_target_table: "profiles",
      p_target_id: null,
      p_business_id: null,
      p_before: null,
      p_after: JSON.stringify({
        email: cmd.email,
        reason: "create_user_failed",
        detail: created.error?.message ?? "no user returned",
      }),
    });
    const status = created.error?.code === "email_exists" ? 409 : 502;
    return json({ error: { code: created.error?.code ?? "create_user_failed" } }, status);
  }
  const user: User = created.data.user;
  const fullName = cmd.full_name ?? cmd.email.split("@")[0];

  // Mint the profiles row (role='staff', D-10 default): FK substrate for the
  // forced-change flag and future memberships. Mirrors bootstrap mint+profile;
  // failure rolls the whole account back so nothing half-exists.
  const profileInsert = await service.from("profiles").insert({
    id: user.id,
    email: cmd.email,
    full_name: fullName,
    role: "staff",
  });
  if (profileInsert.error) {
    await service.auth.admin.deleteUser(user.id);
    await service.rpc("write_audit", {
      p_action: "auth.invite_fallback_failed",
      p_target_table: "profiles",
      p_target_id: user.id,
      p_business_id: null,
      p_before: null,
      p_after: JSON.stringify({ reason: "profile_insert_failed", rolled_back: true }),
    });
    return json({ error: { code: "profile_insert_failed" } }, 500);
  }

  const flagged = await service.rpc("mark_must_change_password", { p_target: user.id });
  if (flagged.error) {
    await service.auth.admin.deleteUser(user.id);
    await service.rpc("write_audit", {
      p_action: "auth.invite_fallback_failed",
      p_target_table: "profiles",
      p_target_id: user.id,
      p_business_id: null,
      p_before: null,
      p_after: JSON.stringify({ reason: "mark_flag_failed", rolled_back: true }),
    });
    return json({ error: { code: "mark_flag_failed" } }, 500);
  }

  // Memberships attach ONLY now, for explicitly requested businesses —
  // satisfies the pending-invitee-zero-access prohibition (T-1-34).
  if (cmd.business_ids && cmd.business_ids.length > 0) {
    const membershipInsert = await service.from("business_members").insert(
      cmd.business_ids.map((businessId) => ({ business_id: businessId, user_id: user.id })),
    );
    if (membershipInsert.error) {
      // Cascades wipe profiles + memberships: no half-created account remains.
      await service.auth.admin.deleteUser(user.id);
      await service.rpc("write_audit", {
        p_action: "auth.invite_fallback_failed",
        p_target_table: "business_members",
        p_target_id: user.id,
        p_business_id: null,
        p_before: null,
        p_after: JSON.stringify({ reason: "membership_insert_failed", rolled_back: true }),
      });
      return json({ error: { code: "membership_insert_failed" } }, 500);
    }
  }

  await service.rpc("write_audit", {
    p_action: "auth.invite_fallback",
    p_target_table: "profiles",
    p_target_id: user.id,
    p_business_id: null,
    p_before: null,
    p_after: JSON.stringify({
      email: cmd.email,
      must_change_password: true,
      business_ids: cmd.business_ids ?? [],
    }),
  });

  return json({ mode: "fallback", temp_password: tempPassword, user_id: user.id }, 201);
}

async function runCancel(service: SupabaseClient, userId: string): Promise<Response> {
  const target = await service.auth.admin.getUserById(userId);
  if (target.error || !target.data.user) {
    return json({ error: { code: "user_not_found" } }, 404);
  }
  if (target.data.user.last_sign_in_at) {
    // Pending-only cancellation: real accounts are deactivated (D-19), never
    // deleted through this path.
    await service.rpc("write_audit", {
      p_action: "auth.invite_cancel_refused",
      p_target_table: "profiles",
      p_target_id: userId,
      p_business_id: null,
      p_before: null,
      p_after: JSON.stringify({ reason: "already_signed_in" }),
    });
    return json({ error: { code: "already_signed_in" } }, 409);
  }
  const deleted = await service.auth.admin.deleteUser(userId);
  if (deleted.error) {
    await service.rpc("write_audit", {
      p_action: "auth.invite_cancel_failed",
      p_target_table: "profiles",
      p_target_id: userId,
      p_business_id: null,
      p_before: null,
      p_after: JSON.stringify({ reason: deleted.error.message }),
    });
    return json({ error: { code: "delete_failed" } }, 502);
  }
  // Deliberate audited cancellation: email freed (D-07), old links dead-end
  // natively via invite_not_found (D-08).
  await service.rpc("write_audit", {
    p_action: "auth.invite_cancelled",
    p_target_table: "profiles",
    p_target_id: userId,
    p_business_id: null,
    p_before: null,
    p_after: JSON.stringify({ email: target.data.user.email }),
  });
  return json({ mode: "cancelled", user_id: userId }, 200);
}

async function runList(service: SupabaseClient): Promise<Response> {
  const listed = await service.rpc("admin_list_invites");
  if (listed.error) {
    return json({ error: { code: "list_failed" } }, 500);
  }
  return json({ invites: listed.data ?? [] }, 200);
}

export async function handleInviteUser(req: Request, deps: InviteUserDeps = {}): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
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
    // INVITE-malformed-email edge: dies HERE, before ANY Admin API activity.
    return json({ error: { code: "invalid_payload" } }, 400);
  }

  const caller = await resolveAdminCaller(service, bearerToken(req));
  if (!caller.ok) {
    return json({ error: { code: caller.code } }, caller.status);
  }

  switch (parsed.data.action) {
    case "invite":
      return runInvite(service, parsed.data, env);
    case "cancel":
      return runCancel(service, parsed.data.user_id);
    case "list":
      return runList(service);
  }
}

// Edge runtime entrypoint. Guarded so Node/vitest can import this module for
// handler-level tests without touching Deno globals.
const denoGlobal = globalThis as unknown as {
  Deno?: { serve: (handler: (req: Request) => Promise<Response>) => void };
};
denoGlobal.Deno?.serve((req: Request) => handleInviteUser(req));
