// invite-user — handler tests for the desktop Add staff (`create`) and admin
// password reset (`reset_password`) actions. Deps injected; zero network.
import { describe, expect, it, vi } from "vitest";
import { handleInviteUser } from "./index";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const OTHER_ADMIN = "33333333-3333-4333-8333-333333333333";
const OWNER = "44444444-4444-4444-8444-444444444444";
const BIZ = "55555555-5555-4555-8555-555555555555";

const ENV = { SUPABASE_URL: "http://localhost", SUPABASE_SERVICE_ROLE_KEY: "svc" };

function mockService(opts: { callerId: string; profiles: Record<string, { id: string; role: string; is_active: boolean; email?: string }> }) {
  const inserts: Array<{ table: string; rows: unknown }> = [];
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const service = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: opts.callerId } }, error: null })),
      admin: {
        createUser: vi.fn(async (args: { email: string }) => ({ data: { user: { id: "new-user", email: args.email } }, error: null })),
        updateUserById: vi.fn(async () => ({ data: { user: {} }, error: null })),
        deleteUser: vi.fn(async () => ({ data: {}, error: null })),
      },
    },
    from: (table: string) => {
      let id: string | undefined;
      const b = {
        select: () => b,
        eq: (_c: string, v: string) => { id = v; return b; },
        single: async () => {
          const row = table === "profiles" && id !== undefined ? opts.profiles[id] : undefined;
          return row ? { data: row, error: null } : { data: null, error: { message: "not found" } };
        },
        insert: async (rows: unknown) => { inserts.push({ table, rows }); return { data: null, error: null }; },
      };
      return b;
    },
    rpc,
  };
  return { service, inserts, rpc };
}

const PROFILES = {
  [ADMIN]: { id: ADMIN, role: "admin", is_active: true },
  [STAFF]: { id: STAFF, role: "staff", is_active: true, email: "staff@example.com" },
  [OTHER_ADMIN]: { id: OTHER_ADMIN, role: "admin", is_active: true },
  [OWNER]: { id: OWNER, role: "super_admin", is_active: true },
};

function post(body: unknown): Request {
  return new Request("http://localhost/invite-user", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("invite-user create (desktop Add staff)", () => {
  it("creates a staff account with a one-time temp password, forced change and memberships", async () => {
    const m = mockService({ callerId: ADMIN, profiles: PROFILES });
    const res = await handleInviteUser(
      post({ action: "create", email: "New.Staff@Example.com", full_name: "New Staff", business_ids: [BIZ] }),
      { env: ENV, createServiceClient: () => m.service as never },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { mode: string; temp_password: string; user_id: string };
    expect(body.mode).toBe("fallback");
    expect(body.temp_password.length).toBeGreaterThanOrEqual(12);
    expect(m.service.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new.staff@example.com", email_confirm: true, password: body.temp_password }),
    );
    expect(m.inserts).toContainEqual({ table: "profiles", rows: expect.objectContaining({ role: "staff", full_name: "New Staff" }) });
    expect(m.inserts).toContainEqual({ table: "business_members", rows: [{ business_id: BIZ, user_id: "new-user" }] });
    expect(m.rpc).toHaveBeenCalledWith("mark_must_change_password", { p_target: "new-user" });
  });

  it("rejects staff callers", async () => {
    const m = mockService({ callerId: STAFF, profiles: PROFILES });
    const res = await handleInviteUser(
      post({ action: "create", email: "x@example.com", full_name: "X" }),
      { env: ENV, createServiceClient: () => m.service as never },
    );
    expect(res.status).toBe(403);
    expect(m.service.auth.admin.createUser).not.toHaveBeenCalled();
  });
});

describe("invite-user reset_password", () => {
  it("admin resets a staff password: new temp password + forced change", async () => {
    const m = mockService({ callerId: ADMIN, profiles: PROFILES });
    const res = await handleInviteUser(post({ action: "reset_password", user_id: STAFF }), {
      env: ENV,
      createServiceClient: () => m.service as never,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { temp_password: string };
    expect(m.service.auth.admin.updateUserById).toHaveBeenCalledWith(STAFF, { password: body.temp_password });
    expect(m.rpc).toHaveBeenCalledWith("mark_must_change_password", { p_target: STAFF });
  });

  it("a regular admin cannot reset another admin; the owner can", async () => {
    const asAdmin = mockService({ callerId: ADMIN, profiles: PROFILES });
    const denied = await handleInviteUser(post({ action: "reset_password", user_id: OTHER_ADMIN }), {
      env: ENV,
      createServiceClient: () => asAdmin.service as never,
    });
    expect(denied.status).toBe(403);
    expect(asAdmin.service.auth.admin.updateUserById).not.toHaveBeenCalled();

    const asOwner = mockService({ callerId: OWNER, profiles: PROFILES });
    const allowed = await handleInviteUser(post({ action: "reset_password", user_id: OTHER_ADMIN }), {
      env: ENV,
      createServiceClient: () => asOwner.service as never,
    });
    expect(allowed.status).toBe(200);
  });

  it("nobody resets the owner or their own password", async () => {
    const m = mockService({ callerId: OWNER, profiles: PROFILES });
    const self = await handleInviteUser(post({ action: "reset_password", user_id: OWNER }), {
      env: ENV,
      createServiceClient: () => m.service as never,
    });
    expect(self.status).toBe(409);
    const asAdmin = mockService({ callerId: ADMIN, profiles: PROFILES });
    const owner = await handleInviteUser(post({ action: "reset_password", user_id: OWNER }), {
      env: ENV,
      createServiceClient: () => asAdmin.service as never,
    });
    expect(owner.status).toBe(403);
  });
});
