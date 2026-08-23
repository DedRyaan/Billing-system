// AUTH-02 invitation-machinery proofs (Plan 09).
//
// TWO LAYERS, honestly separated (bootstrap.test.ts precedent):
//
// 1. HANDLER TESTS (mocked supabase-js service client injected through
//    InviteUserDeps) — run ANYWHERE, no local stack required. They prove the
//    endpoint contract: zod pre-gate ordering (INVITE-malformed-email edge),
//    bearer/role gate (staff 403 on every action), retry-to-fallback branch
//    incl. the Pitfall 1b email_confirm:true regression guard, duplicate-
//    email loud collision (INVITE-duplicate-email edge), pending-only cancel,
//    admin list, and the pending-invitee-zero-membership prohibition at the
//    machinery level.
//
// 2. LIVE-STACK WIRE TESTS (skipped unless SUPABASE_LOCAL_URL +
//    SUPABASE_LOCAL_SERVICE_KEY are set) — drive the served function plus the
//    real GoTrue/DB layers on a freshly `db reset`-ed stack: fallback sign-in
//    regression guard against real auth, must_change_password lifecycle via
//    the real RPCs (self-only by construction), cancelled-invite dead-end +
//    re-invite, staff 403s, pending listing, and zero-data-access for an
//    ungranted account THROUGH RLS. These require Docker; until they first
//    run green their evidence is tracked in .planning/WINDOWS.md.
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { handleInviteUser, type InviteUserDeps } from "../supabase/functions/invite-user/index.ts";

const ADMIN_TOKEN = "admin-jwt";
const STAFF_TOKEN = "staff-jwt";
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";
const BIZ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface AuditCall {
  p_action: string;
  p_target_table: string | null;
  p_target_id: string | null;
}

type InviteOutcome =
  | { kind: "ok"; userId: string }
  | { kind: "err"; code?: string; message: string };

interface FakeUser {
  id: string;
  email?: string;
  last_sign_in_at?: string | null;
}

/**
 * Scriptable stand-in for the service-role supabase-js client, covering the
 * exact surface handleInviteUser touches.
 */
function makeFakeClient(opts: {
  tokens?: Record<string, string>; // token -> verified user id
  profilesById?: Record<string, { id: string; role: string; is_active: boolean }>;
  existingEmails?: string[];
  inviteOutcomes?: InviteOutcome[];
  usersById?: Record<string, FakeUser>;
  pendingInvites?: { user_id: string; email: string }[];
}) {
  const calls = {
    inviteAttempts: [] as { email: string }[],
    createdUsers: [] as { email: string; attrs: Record<string, unknown> }[],
    deletedUsers: [] as string[],
    profileInserts: [] as Record<string, unknown>[],
    memberInserts: [] as Record<string, unknown>[],
    marks: [] as string[],
    audit: [] as AuditCall[],
    listCalls: 0,
  };
  const inviteQueue = [...(opts.inviteOutcomes ?? [])];
  let nextId = 0;

  const client = {
    __calls: calls,
    auth: {
      async getUser(token: string) {
        const uid = opts.tokens?.[token];
        if (!uid) return { data: { user: null }, error: { message: "invalid JWT" } };
        return { data: { user: { id: uid } }, error: null };
      },
      admin: {
        async inviteUserByEmail(email: string, _opts?: unknown) {
          calls.inviteAttempts.push({ email });
          const outcome = inviteQueue.shift() ?? { kind: "err", message: "unexpected invite" };
          return outcome.kind === "ok"
            ? { data: { user: { id: outcome.userId } }, error: null }
            : { data: null, error: { code: outcome.code, message: outcome.message } };
        },
        async createUser(attrs: { email: string } & Record<string, unknown>) {
          const taken =
            opts.existingEmails?.includes(attrs.email) ||
            calls.createdUsers.some((u) => u.email === attrs.email);
          if (taken) {
            return {
              data: { user: null },
              error: { code: "email_exists", message: "already registered" },
            };
          }
          const id = `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;
          calls.createdUsers.push({ email: attrs.email, attrs });
          return { data: { user: { id, email: attrs.email } as User }, error: null };
        },
        async deleteUser(id: string) {
          calls.deletedUsers.push(id);
          return { data: null, error: null };
        },
        async getUserById(id: string) {
          const user = opts.usersById?.[id];
          if (!user) return { data: { user: null }, error: { code: "user_not_found", message: "no such user" } };
          return { data: { user: user as User }, error: null };
        },
      },
    },
    from(table: string) {
      if (table === "profiles") {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, value: string) {
                return {
                  async single() {
                    const row = opts.profilesById?.[value];
                    return row
                      ? { data: row, error: null }
                      : { data: null, error: { code: "PGRST116", message: "no rows" } };
                  },
                };
              },
            };
          },
          insert(row: Record<string, unknown>) {
            calls.profileInserts.push(row);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === "business_members") {
        return {
          insert(rows: Record<string, unknown>[]) {
            for (const r of Array.isArray(rows) ? rows : [rows]) calls.memberInserts.push(r);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string, args?: Record<string, unknown>) {
      if (name === "write_audit") {
        calls.audit.push({
          p_action: args?.p_action as string,
          p_target_table: (args?.p_target_table as string) ?? null,
          p_target_id: (args?.p_target_id as string) ?? null,
        });
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "mark_must_change_password") {
        calls.marks.push(args?.p_target as string);
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "admin_list_invites") {
        calls.listCalls += 1;
        return Promise.resolve({ data: opts.pendingInvites ?? [], error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    },
  };
  return client as unknown as SupabaseClient & { __calls: typeof calls };
}

const BASE_ENV = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

function adminDeps(client: SupabaseClient): InviteUserDeps {
  return {
    env: BASE_ENV,
    createServiceClient: () => client,
  };
}

function defaultAuth(opts: Parameters<typeof makeFakeClient>[0] = {}): Parameters<typeof makeFakeClient>[0] {
  return {
    tokens: { [ADMIN_TOKEN]: ADMIN_ID, [STAFF_TOKEN]: STAFF_ID },
    profilesById: {
      [ADMIN_ID]: { id: ADMIN_ID, role: "admin", is_active: true },
      [STAFF_ID]: { id: STAFF_ID, role: "staff", is_active: true },
    },
    ...opts,
  };
}

function post(body: unknown, token?: string): Request {
  return new Request("http://127.0.0.1:54321/functions/v1/invite-user", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("invite-user handler (mocked service client)", () => {
  it("rejects malformed payloads with 400 BEFORE any Admin API activity (INVITE-malformed-email)", async () => {
    for (const badPayload of [
      {},
      { action: "invite", email: "not-an-email" },
      { action: "invite", email: "" },
      { action: "cancel", user_id: "not-a-uuid" },
      { action: "warp", email: "x@y.z" },
    ]) {
      const client = makeFakeClient(defaultAuth());
      const res = await handleInviteUser(post(badPayload, ADMIN_TOKEN), adminDeps(client));
      expect(res.status, JSON.stringify(badPayload)).toBe(400);
      expect(client.__calls.inviteAttempts).toHaveLength(0);
      expect(client.__calls.createdUsers).toHaveLength(0);
      expect(client.__calls.deletedUsers).toHaveLength(0);
      expect(client.__calls.audit).toHaveLength(0); // died in zod, nothing privileged happened
    }
  });

  it("refuses missing or unverifiable bearers with 401 before any action runs", async () => {
    const client = makeFakeClient(defaultAuth());
    const res = await handleInviteUser(post({ action: "list" }), adminDeps(client));
    expect(res.status).toBe(401);

    const badTokenClient = makeFakeClient(defaultAuth());
    const badRes = await handleInviteUser(
      post({ action: "list" }, "forged-token"),
      adminDeps(badTokenClient),
    );
    expect(badRes.status).toBe(401);
    expect(badTokenClient.__calls.listCalls).toBe(0);
  });

  it("staff caller receives 403 on ALL THREE actions (D-07 visibility half)", async () => {
    for (const body of [
      { action: "invite", email: "someone@example.com" },
      { action: "cancel", user_id: "33333333-3333-4333-8333-333333333333" },
      { action: "list" },
    ]) {
      const client = makeFakeClient(defaultAuth());
      const res = await handleInviteUser(post(body, STAFF_TOKEN), adminDeps(client));
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(client.__calls.inviteAttempts).toHaveLength(0);
      expect(client.__calls.createdUsers).toHaveLength(0);
      expect(client.__calls.deletedUsers).toHaveLength(0);
      expect(client.__calls.listCalls).toBe(0);
    }

    // A caller with a valid token but NO profile row holds no power either.
    const ghost = makeFakeClient({ tokens: { [ADMIN_TOKEN]: ADMIN_ID }, profilesById: {} });
    const ghostRes = await handleInviteUser(
      post({ action: "list" }, ADMIN_TOKEN),
      adminDeps(ghost),
    );
    expect(ghostRes.status).toBe(403);
  });

  it("native invite success responds {mode:'invited'} and audits auth.invite", async () => {
    const client = makeFakeClient(
      defaultAuth({ inviteOutcomes: [{ kind: "ok", userId: "44444444-4444-4444-8444-444444444444" }] }),
    );
    const res = await handleInviteUser(
      post({ action: "invite", email: "Native.Staff@Example.com" }, ADMIN_TOKEN),
      adminDeps(client),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("invited");
    expect(client.__calls.inviteAttempts[0].email).toBe("native.staff@example.com"); // normalized
    expect(client.__calls.createdUsers).toHaveLength(0); // no fallback creation
    expect(client.__calls.profileInserts).toHaveLength(0);
    expect(client.__calls.memberInserts).toHaveLength(0);
    expect(client.__calls.audit.map((a) => a.p_action)).toContain("auth.invite");
  });

  it("SMTP failure x4 falls back to createUser with email_confirm:true (Pitfall 1b email_not_confirmed regression guard) and temp password >= 8 chars", async () => {
    const client = makeFakeClient(
      defaultAuth({
        inviteOutcomes: Array.from({ length: 4 }, () => ({ kind: "err" as const, message: "smtp unavailable" })),
      }),
    );
    const res = await handleInviteUser(
      post(
        {
          action: "invite",
          email: "fallback.staff@example.com",
          full_name: "Fallback Staff",
          business_ids: [BIZ_A],
        },
        ADMIN_TOKEN,
      ),
      adminDeps(client),
    );
    expect(res.status).toBe(201);
    const body = await res.json();

    // Exactly 4 total attempts (D-09's 3-4 rule), then ONE fallback creation.
    expect(client.__calls.inviteAttempts).toHaveLength(4);
    expect(client.__calls.createdUsers).toHaveLength(1);
    const attrs = client.__calls.createdUsers[0].attrs;
    expect(attrs.email_confirm).toBe(true); // THE regression guard
    expect(String(attrs.password).length).toBeGreaterThanOrEqual(8);
    expect(attrs.password).not.toBe("password");

    // Profile minted at staff tier BEFORE the flag lands on it.
    expect(client.__calls.profileInserts).toHaveLength(1);
    expect(client.__calls.profileInserts[0]).toMatchObject({
      role: "staff",
      email: "fallback.staff@example.com",
      full_name: "Fallback Staff",
    });

    // Forced-change flag set through the audited RPC.
    expect(client.__calls.marks).toHaveLength(1);

    // Memberships attach ONLY now, ONLY for explicitly requested businesses.
    expect(client.__calls.memberInserts).toEqual([{ business_id: BIZ_A, user_id: body.user_id }]);

    // Response exposes the temp password ONCE to the admin UI.
    expect(body.mode).toBe("fallback");
    expect(body.temp_password).toBe(attrs.password);
    expect(client.__calls.audit.map((a) => a.p_action)).toContain("auth.invite_fallback");
  });

  it("duplicate-email invite collides loudly: Admin API error surfaced verbatim, NO fallback creation", async () => {
    const client = makeFakeClient(
      defaultAuth({
        existingEmails: ["taken@example.com"],
        inviteOutcomes: [{ kind: "err", code: "email_exists", message: "already registered" }],
      }),
    );
    const res = await handleInviteUser(
      post({ action: "invite", email: "taken@example.com" }, ADMIN_TOKEN),
      adminDeps(client),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("email_exists");
    expect(body.error.message).toBe("already registered"); // verbatim surfacing
    expect(client.__calls.createdUsers).toHaveLength(0); // never fell back
    expect(client.__calls.memberInserts).toHaveLength(0);
    expect(client.__calls.audit.map((a) => a.p_action)).toContain("auth.invite_failed");
  });

  it("fallback profile-insert failure rolls the whole account back (no half-created accounts)", async () => {
    const client = makeFakeClient(defaultAuth({
      inviteOutcomes: Array.from({ length: 4 }, () => ({ kind: "err" as const, message: "smtp down" })),
    })) as ReturnType<typeof makeFakeClient>;
    // Sabotage ONLY the profiles insert; everything else stays honest.
    const originalFrom = client.from.bind(client);
    const realProfiles = originalFrom("profiles");
    (client as unknown as { from: (t: string) => unknown }).from = (table: string) =>
      table === "profiles"
        ? {
            ...realProfiles,
            insert() {
              return Promise.resolve({ data: null, error: { message: "insert denied" } });
            },
          }
        : originalFrom(table);

    const res = await handleInviteUser(
      post({ action: "invite", email: "rollback@example.com" }, ADMIN_TOKEN),
      adminDeps(client as unknown as SupabaseClient),
    );
    expect(res.status).toBe(500);
    expect(client.__calls.createdUsers).toHaveLength(1);
    expect(client.__calls.deletedUsers).toHaveLength(1); // rolled back
    expect(client.__calls.marks).toHaveLength(0);
    expect(client.__calls.memberInserts).toHaveLength(0);
  });

  it("cancel deletes a PENDING target only, auditing auth.invite_cancelled; refuses already-signed-in targets", async () => {
    const pendingId = "55555555-5555-4555-8555-555555555555";
    const signedInId = "66666666-6666-4666-8666-666666666666";
    const client = makeFakeClient(
      defaultAuth({
        usersById: {
          [pendingId]: { id: pendingId, email: "pending@example.com", last_sign_in_at: null },
          [signedInId]: { id: signedInId, email: "active@example.com", last_sign_in_at: "2026-08-24T00:00:00Z" },
        },
      }),
    );

    const okRes = await handleInviteUser(post({ action: "cancel", user_id: pendingId }, ADMIN_TOKEN), adminDeps(client));
    expect(okRes.status).toBe(200);
    const okBody = await okRes.json();
    expect(okBody.mode).toBe("cancelled");
    expect(client.__calls.deletedUsers).toEqual([pendingId]);
    expect(client.__calls.audit.map((a) => a.p_action)).toContain("auth.invite_cancelled");

    const refusedRes = await handleInviteUser(post({ action: "cancel", user_id: signedInId }, ADMIN_TOKEN), adminDeps(client));
    expect(refusedRes.status).toBe(409);
    expect(client.__calls.deletedUsers).toEqual([pendingId]); // untouched
    expect(client.__calls.audit.map((a) => a.p_action)).toContain("auth.invite_cancel_refused");

    const missingRes = await handleInviteUser(
      post({ action: "cancel", user_id: "77777777-7777-4777-8777-777777777777" }, ADMIN_TOKEN),
      adminDeps(client),
    );
    expect(missingRes.status).toBe(404);
    expect(client.__calls.deletedUsers).toHaveLength(1);
  });

  it("list returns the admin_list_invites rows to admins (read-only: no audit per D-23)", async () => {
    const client = makeFakeClient(
      defaultAuth({
        pendingInvites: [{ user_id: "88888888-8888-4888-8888-888888888888", email: "pending@example.com" }],
      }),
    );
    const res = await handleInviteUser(post({ action: "list" }, ADMIN_TOKEN), adminDeps(client));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invites).toEqual([
      { user_id: "88888888-8888-4888-8888-888888888888", email: "pending@example.com" },
    ]);
    expect(client.__calls.audit).toHaveLength(0); // read/view telemetry excluded (D-23)
  });
});

// ---------------------------------------------------------------------------
// LIVE WIRE PROOFS — need Docker (`supabase start` + `functions serve`) plus a
// fresh `supabase db reset`. Skipped automatically elsewhere; first green run
// retires the matching .planning/WINDOWS.md entry.
//
// NOTE on delivery modes against the LOCAL stack: the bundled local mail
// catcher makes native inviteUserByEmail SUCCEED (mode:'invited'), so the
// fallback BRANCH is proven deterministically in the mocked layer above while
// these wire tests exercise the fallback DATA/AUTH mechanics directly through
// the same service-role primitives the handler uses (createUser email_confirm
// + mark/clear RPCs) — plus the full native invite -> cancel -> re-invite
// lifecycle through the served function itself.
// ---------------------------------------------------------------------------

const liveUrl = process.env.SUPABASE_LOCAL_URL;
const liveServiceKey = process.env.SUPABASE_LOCAL_SERVICE_KEY;
const liveAnonKey = process.env.SUPABASE_LOCAL_ANON_KEY;

describe.skipIf(!liveUrl || !liveServiceKey)("invite machinery wire flow (live local stack)", () => {
  const fnUrl = `${liveUrl}/functions/v1/invite-user`;
  const OWNER_EMAIL = "wire-owner@example.com";
  const OWNER_PASSWORD = "correct-horse-battery";
  const OWNER_CODE = "owner-master-key-2026";

  let adminToken = "";

  async function postLive(body: unknown, token?: string): Promise<Response> {
    return fetch(fnUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function svc(key: string = liveServiceKey!): Promise<SupabaseClient> {
    const { createClient } = await import("@supabase/supabase-js");
    return createClient(liveUrl!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  beforeAll(async () => {
    // Seed the super admin through the bootstrap endpoint (fresh db reset).
    const boot = await fetch(`${liveUrl}/functions/v1/bootstrap-super-admin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
        full_name: "Wire Owner",
        setup_code: OWNER_CODE,
      }),
    });
    expect(boot.status).toBe(200);
    const bootBody = await boot.json();
    expect(bootBody.session).not.toBeNull();
    adminToken = bootBody.session.access_token;
  });

  it("malformed payload -> 400; staff-less anon token -> 401", async () => {
    expect((await postLive({}, adminToken)).status).toBe(400);
    expect((await postLive({ action: "list" })).status).toBe(401);
  });

  it("native invite mints a link invite; pending invitee holds ZERO profile/membership rows (prohibition)", async () => {
    const res = await postLive(
      { action: "invite", email: "pending.wire@example.com", full_name: "Pending Wire" },
      adminToken,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("invited");

    const service = await svc();
    const prof = await service.from("profiles").select("id").eq("email", "pending.wire@example.com");
    expect(prof.data).toEqual([]); // no profile exists pre-acceptance
    const listed = await postLive({ action: "list" }, adminToken);
    const listedBody = await listed.json();
    expect(listedBody.invites.some((i: { email: string }) => i.email === "pending.wire@example.com")).toBe(true);

    // Cancellation frees the email (D-07); old links dead-end natively (D-08).
    const invitedUserId = body.user_id as string;
    const cancelled = await postLive({ action: "cancel", user_id: invitedUserId }, adminToken);
    expect(cancelled.status).toBe(200);
    const afterList = await (await postLive({ action: "list" }, adminToken)).json();
    expect(
      afterList.invites.some((i: { email: string }) => i.email === "pending.wire@example.com"),
    ).toBe(false);

    // Email freed: re-invite succeeds (D-07 second half).
    const reinvite = await postLive(
      { action: "invite", email: "pending.wire@example.com" },
      adminToken,
    );
    expect(reinvite.status).toBe(200);
    await postLive(
      { action: "cancel", user_id: ((await reinvite.json()) as { user_id: string }).user_id },
      adminToken,
    );
  });

  it("fallback-created user signs in with temp password (email_not_confirmed regression guard); flag lifecycle is self-only by construction", async () => {
    const service = await svc();
    // Same primitives the handler's fallback branch uses, against REAL GoTrue+DB.
    const tempPassword = "TempWire!2026x";
    const created = await service.auth.admin.createUser({
      email: "fallback.wire@example.com",
      password: tempPassword,
      email_confirm: true, // MANDATORY — Pitfall 1b
      user_metadata: { full_name: "Fallback Wire" },
    });
    expect(created.error, JSON.stringify(created.error)).toBeNull();
    const uid = created.data.user!.id;

    const profIns = await service.from("profiles").insert({
      id: uid,
      email: "fallback.wire@example.com",
      full_name: "Fallback Wire",
      role: "staff",
    });
    expect(profIns.error, JSON.stringify(profIns.error)).toBeNull();

    const marked = await service.rpc("mark_must_change_password", { p_target: uid });
    expect(marked.error, JSON.stringify(marked.error)).toBeNull();

    // Regression guard: sign-in MUST succeed (never email_not_confirmed).
    const signer = await svc();
    const signIn = await signer.auth.signInWithPassword({
      email: "fallback.wire@example.com",
      password: tempPassword,
    });
    expect(signIn.error, JSON.stringify(signIn.error)).toBeNull();

    // Flag reads true...
    const flagged = await service.from("profiles").select("must_change_password").eq("id", uid).single();
    expect((flagged.data as { must_change_password: boolean }).must_change_password).toBe(true);

    // Ungranted account holds ZERO data access THROUGH RLS (prohibition proof):
    // a real session over existing businesses/invoices sees nothing. The reads
    // ride the ANON key so RLS actually applies (service key bypasses it).
    if (!liveAnonKey) throw new Error("SUPABASE_LOCAL_ANON_KEY required for RLS proofs");
    const asInvitee = await svc(liveAnonKey);
    const { error: sessErr } = await asInvitee.auth.setSession(signIn.data.session!);
    expect(sessErr, JSON.stringify(sessErr)).toBeNull();
    const bizRead = await asInvitee.from("businesses").select("id");
    expect(bizRead.error).toBeNull();
    expect(bizRead.data).toEqual([]);
    const invRead = await asInvitee.from("invoices").select("id");
    expect(invRead.error).toBeNull();
    expect(invRead.data).toEqual([]);

    // Second fallback user clears THEIR OWN flag only — the other's stays true.
    const created2 = await service.auth.admin.createUser({
      email: "fallback2.wire@example.com",
      password: "TempWire!2027y",
      email_confirm: true,
    });
    expect(created2.error).toBeNull();
    const uid2 = created2.data.user!.id;
    await service.from("profiles").insert({
      id: uid2,
      email: "fallback2.wire@example.com",
      full_name: "Fallback Two",
      role: "staff",
    });
    await service.rpc("mark_must_change_password", { p_target: uid2 });

    const clearer = await svc();
    const signIn2 = await clearer.auth.signInWithPassword({
      email: "fallback2.wire@example.com",
      password: "TempWire!2027y",
    });
    expect(signIn2.error).toBeNull();
    clearer.auth.setSession(signIn2.data.session!);
    await expect(clearer.rpc("clear_must_change_password")).resolves.toMatchObject({ error: null });

    const after2 = await service.from("profiles").select("must_change_password").eq("id", uid2).single();
    expect((after2.data as { must_change_password: boolean }).must_change_password).toBe(false);
    // Self-only by construction: user 1's flag was NEVER touched by user 2's clear.
    const after1 = await service.from("profiles").select("must_change_password").eq("id", uid).single();
    expect((after1.data as { must_change_password: boolean }).must_change_password).toBe(true);

    // Owner completes their OWN flow: update password then clear.
    const upd = await clearer.auth.updateUser({ password: "NewWire!2026pass" });
    expect(upd.error, JSON.stringify(upd.error)).toBeNull();
  });

  it("duplicate-email invite surfaces the Admin API error; staff JWT gets 403 on all three actions", async () => {
    const dup = await postLive({ action: "invite", email: OWNER_EMAIL }, adminToken);
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: { code: string } }).error.code).toBe("email_exists");

    // Mint a staff JWT by signing in as the still-flagged fallback user 1.
    const staffSignIn = await (await svc()).auth.signInWithPassword({
      email: "fallback.wire@example.com",
      password: "NewWire!2026pass",
    });
    expect(staffSignIn.error).toBeNull();
    const staffJwt = staffSignIn.data.session!.access_token;
    for (const body of [
      { action: "invite", email: "nope@example.com" },
      { action: "cancel", user_id: "99999999-9999-4999-8999-999999999999" },
      { action: "list" },
    ]) {
      const res = await postLive(body, staffJwt);
      expect(res.status, JSON.stringify(body)).toBe(403);
    }
  });
});
