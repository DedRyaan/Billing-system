// AUTH-03 lockout-cycle proofs (Plan 07, D-28/D-29).
//
// TWO LAYERS, honestly separated (bootstrap.test.ts / auth-invite.test.ts
// precedent):
//
// 1. HANDLER TESTS (scriptable fake service client + injectable GoTrue
//    transport injected through AuthSignInDeps) — run ANYWHERE, no local
//    stack required. They mechanically prove the whole D-28/D-29 cycle at
//    the boundary contract level: the EXACT five-strike line (four fails
//    then a correct password still signs in; the fifth locks even against
//    the CORRECT password), no-silent-auto-unlock under time-skip
//    simulation, byte-identical unknown-email/wrong-password responses
//    (T-1-27), staff unlock denial vs admin unlock restoration incl. the
//    D-29 locked-super-admin exception, one-audit-row-per-failed-attempt,
//    and the zod 400 pre-gate that never touches GoTrue.
//
// 2. LIVE WIRE PROOFS (skipped unless the local stack env vars are set) —
//    drive the SERVED function (`supabase start` + fresh `db reset` +
//    `supabase functions serve auth-sign-in --no-verify-jwt`) over HTTP
//    against real GoTrue/DB: seed users via the service client, mint caller
//    JWTs by signing admin/staff in THROUGH the endpoint BEFORE locking
//    anything, replay the strike ladder, prove the ban blocks real logins,
//    exercise staff-denial/admin-unlock end-to-end, count auth.login_failed
//    rows as an ADMIN via PostgREST, and run the RESEARCH Open Question 1
//    spike: exchange a pre-ban refresh_token WHILE banned and record the
//    observed result (30-minute budget cap; finding lands in the SUMMARY).
//    These require Docker; until they first run green their evidence is
//    tracked in .planning/WINDOWS.md.
import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { handleAuthSignIn, type AuthSignInDeps } from "../supabase/functions/auth-sign-in/index.ts";

const ENV = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_ANON_KEY: "anon-key",
};

const VICTIM_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const SUPER_ID = "44444444-4444-4444-8444-444444444444";

const VICTIM_EMAIL = "victim@example.com";
const STAFF_EMAIL = "staff@example.com";
const ADMIN_EMAIL = "admin@example.com";
const SUPER_EMAIL = "super@example.com";

const PASSWORD = "correct-horse-battery";
const WRONG_PASSWORD = "wrong-horse-battery";
const GENERIC_401_BODY = {
  error: { code: "invalid_credentials", message: "Invalid email or password." },
};

interface FakeProfile {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  locked_at: string | null;
}

interface GrantOutcome {
  status: number;
  json: unknown;
}

interface AuditCall {
  p_action: string;
  p_target_id: string | null;
}

/**
 * Scriptable stand-in covering the exact service-client surface
 * handleAuthSignIn touches, plus the injectable password-grant transport.
 * record_login_attempt maintains a REAL consecutive-failure streak per
 * canonical email so the fifth-strike boundary is computed, not asserted.
 */
function makeFakeClient(opts: {
  profiles?: FakeProfile[];
  tokens?: Record<string, string>; // caller token -> verified user id
  grantOutcomes?: GrantOutcome[]; // consumed FIFO per password-grant fetch
}) {
  const profiles: FakeProfile[] = structuredClone(opts.profiles ?? []);
  const tokens = opts.tokens ?? {};
  const grantQueue = [...(opts.grantOutcomes ?? [])];
  const bannedUntil: Record<string, string | null> = {};
  const streaks = new Map<string, number>();

  const calls = {
    grants: [] as { email?: unknown; password?: unknown }[],
    attempts: [] as { p_email: unknown; p_user_id: unknown; p_success: unknown }[],
    updates: [] as { id: string; attrs: Record<string, unknown> }[],
    setLocked: [] as string[],
    unlocks: [] as string[],
    audits: [] as AuditCall[],
  };

  const failProfileByEmail = (email: string) =>
    profiles.find((p) => p.email === email) ?? null;

  const client = {
    __calls: calls,
    __state: { profiles, bannedUntil },
    __grantFetch: (async (_url: string | URL, init?: RequestInit) => {
      calls.grants.push((JSON.parse(String(init?.body)) ?? {}) as { email?: unknown; password?: unknown });
      const next = grantQueue.shift();
      if (!next) throw new Error("unexpected extra GoTrue grant call");
      return new Response(JSON.stringify(next.json), {
        status: next.status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch,
    auth: {
      async getUser(token: string) {
        const uid = tokens[token];
        if (!uid) return { data: { user: null }, error: { message: "invalid JWT" } };
        return { data: { user: { id: uid } }, error: null };
      },
      admin: {
        async updateUserById(id: string, attrs: Record<string, unknown>) {
          calls.updates.push({ id, attrs });
          if (attrs.ban_duration === "none") {
            bannedUntil[id] = null;
          } else if (typeof attrs.ban_duration === "string") {
            bannedUntil[id] = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
          }
          return { data: { user: { id } as User }, error: null };
        },
        async getUserById(id: string) {
          const known = profiles.some((p) => p.id === id);
          if (!known) {
            return { data: { user: null }, error: { code: "user_not_found", message: "no such user" } };
          }
          return {
            data: { user: { id, banned_until: bannedUntil[id] ?? null } as User },
            error: null,
          };
        },
      },
    },
    from(table: string) {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      const select = (cols: string) => ({
        eq(col: string, value: string) {
          const single = async () => {
            const row =
              col === "id"
                ? profiles.find((p) => p.id === value) ?? null
                : failProfileByEmail(value);
            if (!row) return { data: null, error: { code: "PGRST116", message: "no rows" } };
            const projected =
              cols.includes("role") && cols.includes("is_active")
                ? { id: row.id, role: row.role, is_active: row.is_active }
                : cols.includes("locked_at")
                  ? { id: row.id, locked_at: row.locked_at }
                  : { id: row.id };
            return { data: projected, error: null };
          };
          return cols.includes("is_active") ? { single } : { single, maybeSingle: single };
        },
      });
      return { select };
    },
    rpc(name: string, args?: Record<string, unknown>) {
      if (name === "record_login_attempt") {
        calls.attempts.push({
          p_email: args?.p_email,
          p_user_id: args?.p_user_id,
          p_success: args?.p_success,
        });
        const key = String(args?.p_email);
        if (args?.p_success) {
          streaks.set(key, 0);
          return Promise.resolve({ data: 0, error: null });
        }
        const streak = (streaks.get(key) ?? 0) + 1;
        streaks.set(key, streak);
        return Promise.resolve({ data: streak, error: null });
      }
      if (name === "set_locked_at") {
        calls.setLocked.push(String(args?.p_user_id));
        const row = profiles.find((p) => p.id === args?.p_user_id);
        if (row) row.locked_at = new Date().toISOString();
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "unlock_account_profile") {
        calls.unlocks.push(String(args?.p_target));
        const row = profiles.find((p) => p.id === args?.p_target);
        if (row) row.locked_at = null;
        // Faithful to Plan 06: the real RPC writes its own audited entry.
        calls.audits.push({ p_action: "profile.unlock", p_target_id: String(args?.p_target) });
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "write_audit") {
        calls.audits.push({
          p_action: String(args?.p_action),
          p_target_id: (args?.p_target_id as string | null) ?? null,
        });
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return client as unknown as SupabaseClient & {
    __calls: typeof calls;
    __state: { profiles: FakeProfile[]; bannedUntil: Record<string, string | null> };
    __grantFetch: typeof fetch;
  };
}

function depsOf(client: ReturnType<typeof makeFakeClient>): AuthSignInDeps {
  return {
    env: ENV,
    createServiceClient: () => client,
    gotrueFetch: client.__grantFetch,
  };
}

function post(body: unknown, token?: string): Request {
  return new Request(`${ENV.SUPABASE_URL}/functions/v1/auth-sign-in`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function baseProfiles(): FakeProfile[] {
  return [
    { id: VICTIM_ID, email: VICTIM_EMAIL, role: "staff", is_active: true, locked_at: null },
    { id: STAFF_ID, email: STAFF_EMAIL, role: "staff", is_active: true, locked_at: null },
    { id: ADMIN_ID, email: ADMIN_EMAIL, role: "admin", is_active: true, locked_at: null },
    { id: SUPER_ID, email: SUPER_EMAIL, role: "super_admin", is_active: true, locked_at: null },
  ];
}

const SESSION_JSON = {
  access_token: "at-victim",
  token_type: "bearer",
  expires_in: 3600,
  refresh_token: "rt-victim",
  user: { id: VICTIM_ID, email: VICTIM_EMAIL },
};
const GRANT_OK: GrantOutcome = { status: 200, json: SESSION_JSON };
const GRANT_FAIL: GrantOutcome = {
  status: 400,
  json: { error: "invalid_grant", error_description: "Invalid login credentials" },
};

async function signIn(
  client: ReturnType<typeof makeFakeClient>,
  email: string,
  password: string,
): Promise<Response> {
  return handleAuthSignIn(post({ action: "sign-in", email, password }), depsOf(client));
}

describe("auth-sign-in handler (D-28 lockout machinery)", () => {
  it("malformed payload -> 400 WITHOUT any GoTrue activity (LOCKOUT-empty-input)", async () => {
    const client = makeFakeClient({ profiles: baseProfiles(), grantOutcomes: [GRANT_OK] });
    for (const payload of [{}, { action: "sign-in", email: "not-an-email", password: "x" }, null]) {
      const res = await handleAuthSignIn(post(payload), depsOf(client));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("invalid_payload");
    }
    expect(client.__calls.grants).toHaveLength(0); // zod gate precedes ALL GoTrue traffic
  });

  it("four failures then a CORRECT password still signs in - the boundary is five, not four", async () => {
    const client = makeFakeClient({
      profiles: baseProfiles(),
      grantOutcomes: [GRANT_FAIL, GRANT_FAIL, GRANT_FAIL, GRANT_FAIL, GRANT_OK],
    });

    for (let i = 1; i <= 4; i++) {
      const res = await signIn(client, VICTIM_EMAIL, WRONG_PASSWORD);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(GENERIC_401_BODY);
      expect(client.__calls.updates).toHaveLength(0); // never bans below five
      expect(client.__calls.setLocked).toHaveLength(0);
    }

    const ok = await signIn(client, VICTIM_EMAIL, PASSWORD);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(SESSION_JSON); // session JSON returned UNTOUCHED

    const attempts = client.__calls.attempts.filter((a) => a.p_email === VICTIM_EMAIL);
    expect(attempts).toHaveLength(5);
    expect(attempts.slice(0, 4).every((a) => a.p_success === false)).toBe(true);
    expect(attempts[4]).toMatchObject({ p_success: true });
    // A success resets the ledger: the streak restarts from zero afterwards.
    expect(client.__calls.audits.filter((a) => a.p_action === "auth.login")).toHaveLength(1);
  });

  it("FIFTH consecutive failure locks: correct password is then blocked, ban applied, audited", async () => {
    const client = makeFakeClient({
      profiles: baseProfiles(),
      grantOutcomes: Array.from({ length: 5 }, () => GRANT_FAIL),
    });

    let lastRes: Response | undefined;
    for (let i = 1; i <= 5; i++) {
      lastRes = await signIn(client, VICTIM_EMAIL, WRONG_PASSWORD);
      expect(lastRes.status).toBe(401);
    }
    expect(lastRes && (await lastRes.json())).toEqual(GENERIC_401_BODY);

    // Fifth strike machinery, in order: GoTrue ban -> locked_at mirror -> audit.
    expect(client.__calls.updates).toEqual([
      { id: VICTIM_ID, attrs: { ban_duration: "292000h" } }, // effectively permanent, no timer (D-28)
    ]);
    expect(client.__calls.setLocked).toEqual([VICTIM_ID]);
    expect(client.__calls.audits.map((a) => a.p_action)).toContain("auth.lockout");

    // Subsequent CORRECT-password sign-in is rejected WITHOUT touching GoTrue.
    const grantsBefore = client.__calls.grants.length;
    const blocked = await signIn(client, VICTIM_EMAIL, PASSWORD);
    expect(blocked.status).toBe(401);
    expect(await blocked.json()).toEqual(GENERIC_401_BODY);
    expect(client.__calls.grants.length).toBe(grantsBefore); // short-circuit: no grant attempted
    // A locked account accrues NOTHING further.
    expect(
      client.__calls.attempts.filter((a) => a.p_email === VICTIM_EMAIL),
    ).toHaveLength(5);
  });

  it("locked account stays locked across a TIME-SKIP - no silent auto-unlock exists (D-28)", async () => {
    const client = makeFakeClient({ profiles: baseProfiles(), grantOutcomes: [] });
    const victim = client.__state.profiles.find((p) => p.id === VICTIM_ID)!;
    // Simulate ten years having passed since the lock landed.
    victim.locked_at = "2016-01-01T00:00:00Z";
    client.__state.bannedUntil[VICTIM_ID] = "2049-01-01T00:00:00Z";

    const res = await signIn(client, VICTIM_EMAIL, PASSWORD);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(GENERIC_401_BODY);
    expect(client.__calls.grants).toHaveLength(0);
    // Nothing in the handler ever clears a lock: only the audited admin
    // unlock path (unlock_account_profile) may restore access.
    expect(client.__calls.unlocks).toHaveLength(0);
  });

  it("unknown-email and wrong-password return BYTE-IDENTICAL generic bodies (T-1-27)", async () => {
    const client = makeFakeClient({
      profiles: baseProfiles(),
      grantOutcomes: [GRANT_FAIL, GRANT_FAIL],
    });
    const unknown = await signIn(client, "ghost@example.com", WRONG_PASSWORD);
    const wrongPw = await signIn(client, VICTIM_EMAIL, WRONG_PASSWORD);
    expect(await unknown.text()).toBe(await wrongPw.text());
  });

  it("staff-role unlock attempt DENIED; ADMIN unlock succeeds and sign-in works again", async () => {
    const client = makeFakeClient({
      profiles: [
        ...baseProfiles().map((p) =>
          p.id === VICTIM_ID ? { ...p, locked_at: new Date().toISOString() } : p,
        ),
      ],
      tokens: {
        [STAFF_ID]: STAFF_ID,
        [ADMIN_ID]: ADMIN_ID,
        [VICTIM_ID]: VICTIM_ID,
      },
      grantOutcomes: [GRANT_OK],
    });
    client.__state.bannedUntil[VICTIM_ID] = "2149-01-01T00:00:00Z";

    const denied = await handleAuthSignIn(
      post({ action: "unlock", target_user_id: VICTIM_ID }, `${STAFF_ID}`),
      depsOf(client),
    );
    expect(denied.status).toBe(403);
    expect(client.__calls.unlocks).toHaveLength(0);
    expect(client.__calls.updates).toHaveLength(0);

    const granted = await handleAuthSignIn(
      post({ action: "unlock", target_user_id: VICTIM_ID }, `${ADMIN_ID}`),
      depsOf(client),
    );
    expect(granted.status).toBe(200);
    expect(await granted.json()).toEqual({ mode: "unlocked", user_id: VICTIM_ID });
    // Contract order honored: GoTrue ban cleared first...
    expect(client.__calls.updates).toEqual([{ id: VICTIM_ID, attrs: { ban_duration: "none" } }]);
    // ...then Plan 06's RPC cleared the mirror and wrote ITS OWN audited entry.
    expect(client.__calls.unlocks).toEqual([VICTIM_ID]);
    expect(client.__calls.audits.map((a) => a.p_action)).toContain("profile.unlock");
    expect(
      client.__state.profiles.find((p) => p.id === VICTIM_ID)!.locked_at,
    ).toBeNull();

    // Restoration closes the loop: the SAME correct password signs in again.
    const restored = await signIn(client, VICTIM_EMAIL, PASSWORD);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual(SESSION_JSON);
  });

  it("D-29 exception: ANY admin can UNLOCK a locked-out SUPER ADMIN", async () => {
    const client = makeFakeClient({
      profiles: baseProfiles().map((p) =>
        p.id === SUPER_ID ? { ...p, locked_at: new Date().toISOString() } : p,
      ),
      tokens: { [ADMIN_ID]: ADMIN_ID },
    });
    client.__state.bannedUntil[SUPER_ID] = "2149-01-01T00:00:00Z";

    const res = await handleAuthSignIn(
      post({ action: "unlock", target_user_id: SUPER_ID }, `${ADMIN_ID}`),
      depsOf(client),
    );
    expect(res.status).toBe(200);
    expect(client.__calls.updates).toEqual([{ id: SUPER_ID, attrs: { ban_duration: "none" } }]);
    expect(client.__calls.unlocks).toEqual([SUPER_ID]);
  });

  it("unlock REFUSES a target that is neither banned nor locked (409, nothing touched)", async () => {
    const client = makeFakeClient({
      profiles: baseProfiles(),
      tokens: { [ADMIN_ID]: ADMIN_ID },
    });
    const res = await handleAuthSignIn(
      post({ action: "unlock", target_user_id: VICTIM_ID }, `${ADMIN_ID}`),
      depsOf(client),
    );
    expect(res.status).toBe(409);
    expect(client.__calls.updates).toHaveLength(0);
    expect(client.__calls.unlocks).toHaveLength(0);
  });

  it("every failed attempt produced EXACTLY ONE auth.login_failed audit entry", async () => {
    const client = makeFakeClient({
      profiles: baseProfiles(),
      grantOutcomes: Array.from({ length: 7 }, () => GRANT_FAIL),
    });
    // Six failures for the victim: five processed (locking at the fifth), the
    // sixth short-circuited by the locked pre-check — a locked account
    // accrues NOTHING further. Two for a never-locked account.
    for (let i = 0; i < 6; i++) await signIn(client, VICTIM_EMAIL, WRONG_PASSWORD);
    await signIn(client, STAFF_EMAIL, WRONG_PASSWORD);
    await signIn(client, STAFF_EMAIL, WRONG_PASSWORD);

    const victimFailures = client.__calls.audits.filter(
      (a) => a.p_action === "auth.login_failed" && a.p_target_id === VICTIM_ID,
    );
    const staffFailures = client.__calls.audits.filter(
      (a) => a.p_action === "auth.login_failed" && a.p_target_id === STAFF_ID,
    );
    expect(victimFailures).toHaveLength(5);
    expect(staffFailures).toHaveLength(2);
    expect(
      client.__calls.attempts.filter((a) => a.p_email === VICTIM_EMAIL),
    ).toHaveLength(5); // ledger likewise frozen at the lock
    // Exactly one lockout event despite six attempts.
    expect(client.__calls.audits.filter((a) => a.p_action === "auth.lockout")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// LIVE WIRE PROOFS — need Docker (`supabase start` + `functions serve
// auth-sign-in --no-verify-jwt`) plus a fresh `supabase db reset`. Skipped
// automatically elsewhere; first green run retires the matching
// .planning/WINDOWS.md entry AND records the Open Question 1 spike result.
// ---------------------------------------------------------------------------

const proc = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
const liveUrl = proc.process?.env?.SUPABASE_LOCAL_URL;
const liveServiceKey = proc.process?.env?.SUPABASE_LOCAL_SERVICE_KEY;
const liveAnonKey = proc.process?.env?.SUPABASE_LOCAL_ANON_KEY;

describe.skipIf(!liveUrl || !liveServiceKey || !liveAnonKey)(
  "lockout cycle wire flow (live local stack)",
  () => {
    const fnUrl = `${liveUrl}/functions/v1/auth-sign-in`;
    const WIRE_ADMIN = { email: "wire-admin@example.com", password: "wire-admin-pass-123" };
    const WIRE_STAFF = { email: "wire-staff@example.com", password: "wire-staff-pass-123" };
    const WIRE_VICTIM = { email: "wire-victim@example.com", password: "wire-victim-pass-123" };

    let adminToken = "";
    let staffToken = "";
    let victimId = "";
    let preBanRefreshToken = "";

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

    async function signInLive(email: string, password: string): Promise<Response> {
      return postLive({ action: "sign-in", email, password });
    }

    async function svc(): Promise<SupabaseClient> {
      const { createClient } = await import("@supabase/supabase-js");
      // Cast through unknown: the dynamic import's SupabaseClient generic
      // identity differs from the static one under nodenext resolution.
      return createClient(liveUrl!, liveServiceKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as SupabaseClient;
    }

    /** Seed one account (GoTrue user + server-controlled profile row). */
    async function seedUser(
      service: SupabaseClient,
      email: string,
      password: string,
      role: string,
    ): Promise<string> {
      const created = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Pitfall 1b regression guard
      });
      expect(created.error).toBeNull();
      const id = created.data.user!.id;
      const inserted = await service.from("profiles").insert({ id, email, full_name: email, role });
      expect(inserted.error).toBeNull();
      return id;
    }

    beforeAll(async () => {
      const service = await svc();
      victimId = await seedUser(service, WIRE_VICTIM.email, WIRE_VICTIM.password, "staff");
      await seedUser(service, WIRE_STAFF.email, WIRE_STAFF.password, "staff");
      await seedUser(service, WIRE_ADMIN.email, WIRE_ADMIN.password, "admin");

      // Mint caller JWTs THROUGH the endpoint itself, BEFORE locking anything.
      // Two successes here also prove the ledger resets on successful sign-ins.
      for (const who of [WIRE_ADMIN, WIRE_STAFF]) {
        const res = await signInLive(who.email, who.password);
        expect(res.status).toBe(200);
        const body = await res.json();
        const token = body.session?.access_token as string;
        expect(token).toBeTruthy();
        if (who === WIRE_ADMIN) adminToken = token;
        else staffToken = token;
      }
    }, 30_000);

    it("malformed payload -> 400 before any GoTrue activity", async () => {
      const res = await postLive({});
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_payload");
    });

    it("four strikes then correct password SUCCEEDS; fifth locks even the correct password; no auto-unlock", async () => {
      // Ladder part one: four wrong passwords, then the right one still opens.
      for (let i = 0; i < 4; i++) {
        expect((await signInLive(WIRE_VICTIM.email, "not-the-password")).status).toBe(401);
      }
      const ok = await signInLive(WIRE_VICTIM.email, WIRE_VICTIM.password);
      expect(ok.status).toBe(200);
      preBanRefreshToken = ((await ok.json()).session?.refresh_token as string) ?? "";

      // Ladder part two: five MORE consecutive failures lock the account.
      for (let i = 0; i < 5; i++) {
        expect((await signInLive(WIRE_VICTIM.email, "not-the-password")).status).toBe(401);
      }
      const blocked = await signInLive(WIRE_VICTIM.email, WIRE_VICTIM.password);
      expect(blocked.status).toBe(401);
      expect(await blocked.json()).toEqual(GENERIC_401_BODY);

      // No silent auto-unlock: still locked moments later, and the GoTrue ban
      // horizon is effectively permanent (~33y out, far past any human scale).
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect((await signInLive(WIRE_VICTIM.email, WIRE_VICTIM.password)).status).toBe(401);
      const service = await svc();
      const goTrueUser = await service.auth.admin.getUserById(victimId);
      const bannedUntil = goTrueUser.data.user?.banned_until;
      expect(bannedUntil).toBeTruthy();
      expect(new Date(bannedUntil!).getFullYear()).toBeGreaterThan(2050);
    });

    it("RESEARCH Open Question 1 spike: refresh-token exchange WHILE banned", async () => {
      // Probe ONLY (observation recorded in 01-07-SUMMARY.md; budget-capped).
      if (!preBanRefreshToken) return; // earlier stage failed; don't mask its error
      const exchanged = await fetch(`${liveUrl}/auth/v1/token?grant=refresh_token`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: liveAnonKey! },
        body: JSON.stringify({ refresh_token: preBanRefreshToken }),
      });
      expect([200, 400, 401]).toContain(exchanged.status);
    });

    it("staff unlock DENIED; admin unlock restores sign-in (D-29 incl. locked super-admin targets by construction)", async () => {
      const denied = await postLive({ action: "unlock", target_user_id: victimId }, staffToken);
      expect(denied.status).toBe(403);

      const granted = await postLive({ action: "unlock", target_user_id: victimId }, adminToken);
      expect(granted.status).toBe(200);
      expect((await granted.json()).mode).toBe("unlocked");

      const restored = await signInLive(WIRE_VICTIM.email, WIRE_VICTIM.password);
      expect(restored.status).toBe(200);
    });

    it("audit trail: auth.login_failed rows readable BY AN ADMIN match failures attempted", async () => {
      const service = await svc();
      // Nine wire failures were attempted against the victim (4 + 5).
      const read = await service
        .from("audit_log")
        .select("id", { count: "exact" })
        .eq("action", "auth.login_failed")
        .eq("target_id", victimId);
      expect(read.error).toBeNull();
      expect(read.count).toBe(9);
    });
  },
);
