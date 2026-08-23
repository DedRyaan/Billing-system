// bootstrap-super-admin — the D-01..D-04 owner-bootstrap endpoint (Plan 08).
//
// The ONLY pre-auth entry point into the platform. Signup is disabled at the
// GoTrue level (supabase/config.toml [auth] enable_signup=false), so this
// function is the front door's single keyhole:
//
//   1. zod-validates {email, password, full_name, setup_code} — 400 before ANY
//      digest comparison for malformed payloads or codes shorter than 12
//   2. reads the stored sha256 digest via the definer getter
//      get_setup_code_digest() (service-role EXECUTE)
//   3. NULL digest = first run (D-01): the presented code BECOMES the
//      owner-chosen code and is seeded via seed_setup_code_digest()
//      (insert-only-when-absent) after a successful mint
//   4. otherwise constant-time-compares sha256(presented) against the stored
//      digest — mismatch responds 403, writes audit auth.bootstrap_failed and
//      creates NO rows of any kind
//   5. on match mints auth.users row via auth.admin.createUser with
//      email_confirm: true — MANDATORY, admin-created users without it fail
//      sign-in with email_not_confirmed regardless of dashboard settings
//      (supabase issue #29632 / RESEARCH Pitfall 1b)
//   6. inserts profiles row role='super_admin' and returns a live session to
//      the first-run screen
//
// The same handler serves D-04 emergency recovery forever after bootstrap: a
// still-valid code guards every mint identically, so a locked-out owner can
// always mint themselves back in. Rotation (D-03/D-13) happens in admin
// settings through the rotate_setup_code_digest() RPC; the new digest guards
// THIS path again immediately.
//
// Rate limiting (T-1-29, accepted residual): relies on platform rate limits +
// audited failures (every miss lands in audit_log); CAPTCHA can be layered on
// later without schema change (RESEARCH Open Question 3 accepted-risk note).
//
// Service-role key confinement: SUPABASE_SERVICE_ROLE_KEY is injected by the
// platform into the function runtime ONLY — it must never reach a client.
//
// Dual-runtime note: bare `zod` / `@supabase/supabase-js` imports resolve both
// in Deno 2 (Supabase edge runtime npm support) and under Node/vitest, where
// tests import handleBootstrap() directly. node:crypto is available in both.

import { timingSafeEqual } from "node:crypto";
import { createClient as supabaseCreateClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const MIN_SETUP_CODE_LENGTH = 12;
const MIN_PASSWORD_LENGTH = 8;

const bootstrapSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // D-05 standard policy floor; GoTrue re-checks its own minimum too.
  password: z.string().min(MIN_PASSWORD_LENGTH),
  full_name: z.string().trim().min(1).max(200),
  // BOOTSTRAP-empty-code edge resolution: short/missing code dies HERE, before
  // any hash comparison or privileged call.
  setup_code: z.string().min(MIN_SETUP_CODE_LENGTH),
});

export interface BootstrapDeps {
  env?: Record<string, string | undefined>;
  createServiceClient?: (
    url: string,
    serviceKey: string,
  ) => SupabaseClient;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Buffer.from(digest).toString("hex");
}

/** PostgREST renders bytea as a "\x<hex>" string — normalize to raw hex. */
function byteaHexToBuffer(stored: unknown): Buffer | null {
  if (typeof stored !== "string") return null;
  const hex = stored.startsWith("\\x") ? stored.slice(2) : stored;
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  return Buffer.from(hex, "hex");
}

/**
 * Constant-time digest comparison. Buffers are always equal length here (both
 * are SHA-256 outputs); the zero-fill fallback keeps the work comparable when
 * the stored value is missing/malformed so response timing stays flat.
 */
function digestsMatch(computed: Buffer, storedRaw: unknown): boolean {
  const stored = byteaHexToBuffer(storedRaw);
  const reference =
    stored && stored.length === computed.length ? stored : Buffer.alloc(computed.length);
  return stored !== null &&
    stored.length === computed.length &&
    timingSafeEqual(computed, reference);
}

export async function handleBootstrap(req: Request, deps: BootstrapDeps = {}): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: { code: "method_not_allowed" } }, 405);
  }

  const env = deps.env ?? globalThis.process?.env ?? {};
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

  const parsed = bootstrapSchema.safeParse(payload);
  if (!parsed.success) {
    return json(
      {
        error: {
          code: "invalid_payload",
          message: `setup_code must be at least ${MIN_SETUP_CODE_LENGTH} characters; email, password (min ${MIN_PASSWORD_LENGTH}) and full_name required`,
        },
      },
      400,
    );
  }
  const { email, password, full_name: fullName, setup_code: setupCode } = parsed.data;

  const digestCall = await service.rpc("get_setup_code_digest");
  if (digestCall.error) {
    await service.rpc("write_audit", {
      p_action: "auth.bootstrap_failed",
      p_target_table: "profiles",
      p_target_id: null,
      p_business_id: null,
      p_before: null,
      p_after: JSON.stringify({ reason: "digest_unreadable" }),
    });
    return json({ error: { code: "server_error" } }, 500);
  }

  const computed = Buffer.from(await sha256Hex(setupCode), "hex");
  const isFirstRun = digestCall.data == null;
  if (!isFirstRun && !digestsMatch(computed, digestCall.data)) {
    // Wrong code: 403 + audit + ZERO user/profile rows created.
    await service.rpc("write_audit", {
      p_action: "auth.bootstrap_failed",
      p_target_table: "profiles",
      p_target_id: null,
      p_business_id: null,
      p_before: null,
      p_after: JSON.stringify({ reason: "invalid_setup_code", first_run: false }),
    });
    return json({ error: { code: "invalid_setup_code" } }, 403);
  }

  // Valid code (or genuine first run): mint the super admin.
  // email_confirm: true is MANDATORY (Pitfall 1b / issue #29632).
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.error || !created.data.user) {
    await service.rpc("write_audit", {
      p_action: "auth.bootstrap_failed",
      p_target_table: "profiles",
      p_target_id: null,
      p_business_id: null,
      p_before: null,
      p_after: JSON.stringify({
        reason: "create_user_failed",
        detail: created.error?.message ?? "no user returned",
        first_run: isFirstRun,
      }),
    });
    const status = created.error?.code === "email_exists" ? 409 : 502;
    return json({ error: { code: created.error?.code ?? "mint_failed" } }, status);
  }
  const user = created.data.user;

  const profileInsert = await service.from("profiles").insert({
    id: user.id,
    email,
    full_name: fullName,
    role: "super_admin",
  });
  if (profileInsert.error) {
    // Roll the auth user back so a failed mint leaves no half-created account.
    await service.auth.admin.deleteUser(user.id);
    await service.rpc("write_audit", {
      p_action: "auth.bootstrap_failed",
      p_target_table: "profiles",
      p_target_id: user.id,
      p_business_id: null,
      p_before: null,
      p_after: JSON.stringify({ reason: "profile_insert_failed", rolled_back: true }),
    });
    return json({ error: { code: "profile_insert_failed" } }, 500);
  }

  if (isFirstRun) {
    // First run only: the presented code becomes the canonical owner code
    // (D-01 user-chosen). Insert-only-when-absent — it can never clobber an
    // existing digest, so post-bootstrap recovery always compares against the
    // real stored secret.
    const seeded = await service.rpc("seed_setup_code_digest", { p_new_code: setupCode });
    if (seeded.error) {
      await service.rpc("write_audit", {
        p_action: "auth.bootstrap_failed",
        p_target_table: "setup_code",
        p_target_id: "1",
        p_business_id: null,
        p_before: null,
        p_after: JSON.stringify({
          reason: "seed_failed",
          target_user: user.id,
          rolled_back: false,
        }),
      });
      return json({ error: { code: "seed_failed" } }, 500);
    }
  }

  await service.rpc("write_audit", {
    p_action: "auth.bootstrap_minted",
    p_target_table: "profiles",
    p_target_id: user.id,
    p_business_id: null,
    p_before: null,
    p_after: JSON.stringify({ role: "super_admin", first_run: isFirstRun }),
  });

  // Return a live session to the first-run screen. enable_signup=false does
  // not affect the password token grant, so sign-in works while public signup
  // stays closed.
  const signIn = await service.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) {
    return json(
      { user: { id: user.id, email }, session: null, warning: "sign_in_failed_after_mint" },
      200,
    );
  }

  return json(
    {
      user: { id: user.id, email },
      session: signIn.data.session,
    },
    200,
  );
}

// Edge runtime entrypoint. Guarded so Node/vitest can import this module for
// handler-level tests without touching Deno globals.
const denoGlobal = globalThis as unknown as {
  Deno?: { serve: (handler: (req: Request) => Promise<Response>) => void };
};
denoGlobal.Deno?.serve((req: Request) => handleBootstrap(req));
