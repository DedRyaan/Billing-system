// Bootstrap lifecycle proofs (Plan 08): mint, emergency recovery, rotation
// discipline, signup closure (D-01..D-04).
//
// TWO LAYERS, honestly separated:
//
// 1. HANDLER TESTS (mocked supabase-js service client, injected through
//    BootstrapDeps) — run ANYWHERE, no local stack required. They prove the
//    endpoint contract: zod pre-gate ordering, constant-time-guarded compare
//    outcomes, zero-row failure semantics, first-run seeding, D-04 repeat
//    mints, rotation digest swap effects, and the config-level signup closure.
//
// 2. LIVE-STACK WIRE TESTS (skipped unless SUPABASE_LOCAL_URL +
//    SUPABASE_LOCAL_SERVICE_KEY are set) — drive POST /functions/v1/
//    bootstrap-super-admin against `pnpm exec supabase functions serve
//    bootstrap-super-admin --no-verify-api` on a freshly `db reset`-ed stack,
//    asserting real row-count deltas and the DB-side rotation authorization
//    pair (super_admin positive / non-super denial). These require Docker;
//    until they first run green their evidence is tracked in
//    .planning/WINDOWS.md.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleBootstrap, type BootstrapDeps } from "../supabase/functions/bootstrap-super-admin/index.ts";

const OWNER_CODE = "owner-master-key-2026";
const WRONG_CODE = "not-the-owner-code";
const ROTATED_CODE = "rotated-master-key-99";

function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

interface AuditCall {
  p_action: string;
  p_target_table: string | null;
  p_target_id: string | null;
}

/** Scriptable stand-in for the service-role supabase-js client. */
function makeFakeServiceClient(store: { storedHex: string | null }) {
  const calls = {
    getDigest: 0,
    seeds: [] as string[],
    createdUsers: [] as { email: string; attrs: Record<string, unknown> }[],
    deletedUsers: [] as string[],
    profileInserts: [] as Record<string, unknown>[],
    signIns: [] as string[],
    audit: [] as AuditCall[],
  };
  let nextUserId = 0;

  const client = {
    __calls: calls,
    rpc(name: string, args?: Record<string, unknown>) {
      if (name === "get_setup_code_digest") {
        calls.getDigest += 1;
        return Promise.resolve({ data: store.storedHex, error: null });
      }
      if (name === "seed_setup_code_digest") {
        const code = args?.p_new_code as string;
        if (!code || code.length < 12) {
          return Promise.resolve({ data: null, error: { message: "too short" } });
        }
        if (store.storedHex === null) {
          store.storedHex = `\\x${sha256hex(code)}`;
          calls.seeds.push(code);
        }
        return Promise.resolve({ data: store.storedHex !== null, error: null });
      }
      if (name === "write_audit") {
        calls.audit.push({
          p_action: args?.p_action as string,
          p_target_table: (args?.p_target_table as string) ?? null,
          p_target_id: (args?.p_target_id as string) ?? null,
        });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    },
    auth: {
      admin: {
        createUser(attrs: { email: string } & Record<string, unknown>) {
          if (calls.createdUsers.some((u) => u.email === attrs.email)) {
            return Promise.resolve({
              data: { user: null },
              error: { code: "email_exists", message: "already registered" },
            });
          }
          const id = `00000000-0000-4000-8000-${String(++nextUserId).padStart(12, "0")}`;
          calls.createdUsers.push({ email: attrs.email, attrs });
          return Promise.resolve({
            data: { user: { id, email: attrs.email } },
            error: null,
          });
        },
        deleteUser(id: string) {
          calls.deletedUsers.push(id);
          return Promise.resolve({ data: null, error: null });
        },
      },
      signInWithPassword(args: { email: string }) {
        calls.signIns.push(args.email);
        return Promise.resolve({
          data: {
            session: { access_token: `session-for-${args.email}`, token_type: "bearer" },
            user: null,
          },
          error: null,
        });
      },
    },
    from(_table: string) {
      return {
        insert(row: Record<string, unknown>) {
          calls.profileInserts.push(row);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return client as unknown as SupabaseClient & { __calls: typeof calls };
}

function depsWith(client: ReturnType<typeof makeFakeServiceClient>, env: Record<string, string | undefined>): BootstrapDeps {
  return { env, createServiceClient: () => client };
}

const BASE_ENV = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "service-key" };

function post(body: unknown): Request {
  return new Request("http://127.0.0.1:54321/functions/v1/bootstrap-super-admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("bootstrap-super-admin handler (mocked service client)", () => {
  it("rejects malformed payloads with 400 BEFORE any digest read or comparison", async () => {
    const store = { storedHex: null };
    const client = makeFakeServiceClient(store);

    const res = await handleBootstrap(post({}), depsWith(client, BASE_ENV));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_payload");
    // BOOTSTRAP-empty-code edge: nothing privileged was consulted.
    expect(client.__calls.getDigest).toBe(0);
    expect(client.__calls.createdUsers).toHaveLength(0);
    expect(client.__calls.profileInserts).toHaveLength(0);
  });

  it("rejects a setup_code shorter than 12 characters with 400", async () => {
    const store = { storedHex: null };
    const client = makeFakeServiceClient(store);

    const res = await handleBootstrap(
      post({ email: "owner@example.com", password: "correct-horse-battery", full_name: "Owner", setup_code: "short" }),
      depsWith(client, BASE_ENV),
    );

    expect(res.status).toBe(400);
    expect(client.__calls.createdUsers).toHaveLength(0);
    expect(client.__calls.audit).toHaveLength(0); // died in zod, never an attempt
  });

  it("first run: presented code becomes the owner code, super_admin minted with email_confirm:true, session returned", async () => {
    const store = { storedHex: null }; // no singleton row yet -> genuine first run
    const client = makeFakeServiceClient(store);

    const res = await handleBootstrap(
      post({ email: "owner@example.com", password: "correct-horse-battery", full_name: "Owner", setup_code: OWNER_CODE }),
      depsWith(client, BASE_ENV),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).not.toBeNull();

    // Pitfall 1b / issue #29632: email_confirm MUST be true on admin creation.
    expect(client.__calls.createdUsers).toHaveLength(1);
    expect(client.__calls.createdUsers[0].attrs.email_confirm).toBe(true);

    // profiles row minted at owner level (D-10 top tier).
    expect(client.__calls.profileInserts).toHaveLength(1);
    expect(client.__calls.profileInserts[0]).toMatchObject({ role: "super_admin", email: "owner@example.com" });

    // First-run seeding stored exactly the presented code's digest.
    expect(store.storedHex).toBe(`\\x${sha256hex(OWNER_CODE)}`);

    // Audited mint (D-23 permission event).
    expect(client.__calls.audit.map((a) => a.p_action)).toContain("auth.bootstrap_minted");
  });

  it("wrong code after bootstrap: 403 + audited failure + ZERO user/profile rows created", async () => {
    const store = { storedHex: `\\x${sha256hex(OWNER_CODE)}` };
    const client = makeFakeServiceClient(store);

    const res = await handleBootstrap(
      post({ email: "attacker@example.com", password: "correct-horse-battery", full_name: "Attacker", setup_code: WRONG_CODE }),
      depsWith(client, BASE_ENV),
    );

    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error.code).toBe("invalid_setup_code");

    // No partial state, ever: no auth user, no profile row, no rollback trail.
    expect(client.__calls.createdUsers).toHaveLength(0);
    expect(client.__calls.profileInserts).toHaveLength(0);
    expect(client.__calls.deletedUsers).toHaveLength(0);

    // Failed attempts land in the audit trail (T-1-29 visibility mitigation).
    expect(
      client.__calls.audit.some((a) => a.p_action === "auth.bootstrap_failed"),
    ).toBe(true);
  });

  it("SECOND valid mint after bootstrap still yields super_admin (D-04 emergency recovery)", async () => {
    const store = { storedHex: `\\x${sha256hex(OWNER_CODE)}` };

    // First mint (the original owner).
    const firstClient = makeFakeServiceClient(store);
    await handleBootstrap(
      post({ email: "owner@example.com", password: "correct-horse-battery", full_name: "Owner", setup_code: OWNER_CODE }),
      depsWith(firstClient, BASE_ENV),
    );
    const usersAfterFirst = [...firstClient.__calls.createdUsers];

    // Recovery mint through the IDENTICAL handler + still-valid digest.
    const secondClient = makeFakeServiceClient(store);
    const res = await handleBootstrap(
      post({ email: "rescued@example.com", password: "correct-horse-battery", full_name: "Rescued Owner", setup_code: OWNER_CODE }),
      depsWith(secondClient, BASE_ENV),
    );

    expect(res.status).toBe(200);
    expect(secondClient.__calls.createdUsers).toHaveLength(1);
    expect(secondClient.__calls.createdUsers[0].email).toBe("rescued@example.com");
    expect(secondClient.__calls.profileInserts[0].role).toBe("super_admin");
    // Recovery did NOT reseed or alter the canonical digest.
    expect(store.storedHex).toBe(`\\x${sha256hex(OWNER_CODE)}`);
    expect(secondClient.__calls.seeds).toHaveLength(0);
    expect(usersAfterFirst).toHaveLength(1);
  });

  it("rotation invalidates the old code immediately; the new code passes (D-03)", async () => {
    const store = { storedHex: `\\x${sha256hex(OWNER_CODE)}` };

    // Old code still works pre-rotation.
    const preClient = makeFakeServiceClient(store);
    const pre = await handleBootstrap(
      post({ email: "pre@example.com", password: "correct-horse-battery", full_name: "Pre", setup_code: OWNER_CODE }),
      depsWith(preClient, BASE_ENV),
    );
    expect(pre.status).toBe(200);

    // Simulate rotate_setup_code_digest() having committed: singleton digest
    // replaced, no history retained (DB-side authorization is proven in the
    // SQL tier / live block below).
    store.storedHex = `\\x${sha256hex(ROTATED_CODE)}`;

    const oldCodeClient = makeFakeServiceClient(store);
    const oldRes = await handleBootstrap(
      post({ email: "stale@example.com", password: "correct-horse-battery", full_name: "Stale", setup_code: OWNER_CODE }),
      depsWith(oldCodeClient, BASE_ENV),
    );
    expect(oldRes.status).toBe(403);
    expect(oldCodeClient.__calls.createdUsers).toHaveLength(0);

    const newCodeClient = makeFakeServiceClient(store);
    const newRes = await handleBootstrap(
      post({ email: "post@example.com", password: "correct-horse-battery", full_name: "Post", setup_code: ROTATED_CODE }),
      depsWith(newCodeClient, BASE_ENV),
    );
    expect(newRes.status).toBe(200);
    expect(newCodeClient.__calls.profileInserts[0].role).toBe("super_admin");
  });

  it("non-POST requests are refused with 405", async () => {
    const client = makeFakeServiceClient({ storedHex: null });
    const res = await handleBootstrap(
      new Request("http://127.0.0.1:54321/functions/v1/bootstrap-super-admin", { method: "GET" }),
      depsWith(client, BASE_ENV),
    );
    expect(res.status).toBe(405);
    expect(client.__calls.createdUsers).toHaveLength(0);
  });
});

describe("signup closure in local config (D-02, assumption A5 backstop)", () => {
  let configToml: string;
  beforeAll(() => {
    configToml = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  });

  function section(text: string, header: string): string {
    const start = text.indexOf(header);
    expect(start, `missing ${header} section`).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start);
    const nextHeader = rest.slice(1).search(/^\[/m);
    return nextHeader === -1 ? rest : rest.slice(0, nextHeader + 1);
  }

  it("[auth] enable_signup is false", () => {
    expect(section(configToml, "[auth]")).toMatch(/^enable_signup = false$/m);
  });

  it("[auth.email] enable_signup is false", () => {
    expect(section(configToml, "[auth.email]")).toMatch(/^enable_signup = false$/m);
  });
});

// ---------------------------------------------------------------------------
// LIVE WIRE PROOFS — need Docker (`supabase start` + `functions serve`) plus a
// fresh `supabase db reset`. Skipped automatically elsewhere; first green run
// retires the matching .planning/WINDOWS.md entries.
// ---------------------------------------------------------------------------

const liveUrl = process.env.SUPABASE_LOCAL_URL;
const liveServiceKey = process.env.SUPABASE_LOCAL_SERVICE_KEY;

describe.skipIf(!liveUrl || !liveServiceKey)("bootstrap-super-admin wire flow (live local stack)", () => {
  const fnUrl = `${liveUrl}/functions/v1/bootstrap-super-admin`;

  async function postLive(body: unknown): Promise<Response> {
    return fetch(fnUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function profilesCount(): Promise<number> {
    const res = await fetch(`${liveUrl}/rest/v1/profiles?select=id`, {
      headers: {
        apikey: liveServiceKey!,
        Authorization: `Bearer ${liveServiceKey!}`,
        Prefer: "count=exact",
        Range: "0=-1",
      },
    });
    const range = res.headers.get("content-range"); // e.g. "*/7"
    return Number(range?.split("/")[1] ?? "-1");
  }

  it("empty payload -> 400; wrong code -> 403 with ZERO row delta; valid code -> super_admin session", async () => {
    expect((await postLive({})).status).toBe(400);

    const before = await profilesCount();
    const bad = await postLive({
      email: "intruder@example.com",
      password: "correct-horse-battery",
      full_name: "Intruder",
      setup_code: WRONG_CODE,
    });
    expect(bad.status).toBe(403);
    expect(await profilesCount()).toBe(before); // zero-row delta

    const good = await postLive({
      email: "wire-owner@example.com",
      password: "correct-horse-battery",
      full_name: "Wire Owner",
      setup_code: OWNER_CODE,
    });
    expect(good.status).toBe(200);
    const body = await good.json();
    expect(body.session).not.toBeNull();
    expect(await profilesCount()).toBe(before + 1);
  });

  it("second valid mint post-bootstrap retains role super_admin (D-04)", async () => {
    const rescue = await postLive({
      email: "wire-rescue@example.com",
      password: "correct-horse-battery",
      full_name: "Wire Rescue",
      setup_code: OWNER_CODE,
    });
    expect(rescue.status).toBe(200);
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(liveUrl!, liveServiceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await admin
      .from("profiles")
      .select("role")
      .eq("email", "wire-rescue@example.com")
      .single();
    expect((data as { role: string }).role).toBe("super_admin");
  });

  it("rotation by the minted super_admin flips acceptance; non-super callers are denied (D-03/D-13)", async () => {
    const { createClient } = await import("@supabase/supabase-js");

    // Sign in as the wire-minted super admin and rotate.
    const superClient = createClient(liveUrl!, process.env.SUPABASE_LOCAL_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await superClient.auth.signInWithPassword({
      email: "wire-owner@example.com",
      password: "correct-horse-battery",
    });
    expect(signInError, JSON.stringify(signInError)).toBeNull();

    const { error: rotateError } = await superClient.rpc("rotate_setup_code_digest", {
      p_new_code: ROTATED_CODE,
    });
    expect(rotateError, JSON.stringify(rotateError)).toBeNull();

    // Old code dead immediately.
    expect(
      (
        await postLive({
          email: "late@example.com",
          password: "correct-horse-battery",
          full_name: "Late",
          setup_code: OWNER_CODE,
        })
      ).status,
    ).toBe(403);
    // New code passes.
    expect(
      (
        await postLive({
          email: "post-rotation@example.com",
          password: "correct-horse-battery",
          full_name: "Post Rotation",
          setup_code: ROTATED_CODE,
        })
      ).status,
    ).toBe(200);

    // Non-super denial: a caller with NO effective role (anon JWT context)
    // must hit the definer's 42501. Admin-tier denial rides the same
    // current_user_role() predicate and is additionally covered at the SQL
    // tier once the pgTAP suite extends to 0009.
    const anonClient = createClient(liveUrl!, process.env.SUPABASE_LOCAL_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await expect(anonClient.rpc("rotate_setup_code_digest", { p_new_code: ROTATED_CODE })).rejects.toThrow();
  });
});
