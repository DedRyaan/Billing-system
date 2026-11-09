// Staff account helpers over the invite-user Edge Function + own-password set.
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createStaffAccount, resetStaffPassword, setOwnPassword } from "../src/memberships";

function httpError(body: unknown): Error {
  const err = new Error("Edge Function returned a non-2xx status code");
  (err as unknown as { context: Response }).context = Response.json(body, { status: 409 });
  return err;
}

function client(invokeResult: { data: unknown; error: unknown }) {
  const invoke = vi.fn(async () => invokeResult);
  const updateUser = vi.fn(async () => ({ data: {}, error: null as unknown }));
  const rpc = vi.fn(async () => ({ data: null, error: null as unknown }));
  return { c: { functions: { invoke }, auth: { updateUser }, rpc } as unknown as SupabaseClient, invoke, updateUser, rpc };
}

describe("createStaffAccount", () => {
  it("sends the create action and returns the one-time password", async () => {
    const { c, invoke } = client({ data: { mode: "fallback", user_id: "u9", temp_password: "Tmp-123456789" }, error: null });
    const res = await createStaffAccount(c, { email: "a@b.co", fullName: "A B", businessIds: ["b1"] });
    expect(invoke).toHaveBeenCalledWith("invite-user", {
      body: { action: "create", email: "a@b.co", full_name: "A B", business_ids: ["b1"] },
    });
    expect(res).toEqual({ ok: true, data: { userId: "u9", tempPassword: "Tmp-123456789" } });
  });

  it("omits business_ids when none are picked and maps email_exists to a readable message", async () => {
    const { c, invoke } = client({ data: null, error: httpError({ error: { code: "email_exists" } }) });
    const res = await createStaffAccount(c, { email: "a@b.co", fullName: "A", businessIds: [] });
    expect(invoke).toHaveBeenCalledWith("invite-user", { body: { action: "create", email: "a@b.co", full_name: "A" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toBe("An account with this email already exists.");
  });
});

describe("resetStaffPassword", () => {
  it("sends reset_password and maps forbidden to PERMISSION_DENIED", async () => {
    const ok = client({ data: { temp_password: "New-Temp-99" }, error: null });
    expect(await resetStaffPassword(ok.c, "u1")).toEqual({ ok: true, data: { userId: "u1", tempPassword: "New-Temp-99" } });
    expect(ok.invoke).toHaveBeenCalledWith("invite-user", { body: { action: "reset_password", user_id: "u1" } });

    const denied = client({ data: null, error: httpError({ error: { code: "forbidden" } }) });
    const res = await resetStaffPassword(denied.c, "u1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.reason).toBe("PERMISSION_DENIED");
  });
});

describe("setOwnPassword", () => {
  it("updates the password then clears the forced-change flag", async () => {
    const { c, updateUser, rpc } = client({ data: null, error: null });
    const res = await setOwnPassword(c, "a-new-secret");
    expect(updateUser).toHaveBeenCalledWith({ password: "a-new-secret" });
    expect(rpc).toHaveBeenCalledWith("clear_must_change_password");
    expect(res.ok).toBe(true);
  });

  it("does not clear the flag when the password update fails", async () => {
    const { c, updateUser, rpc } = client({ data: null, error: null });
    updateUser.mockResolvedValueOnce({ data: {}, error: { message: "New password should be different from the old password.", code: "same_password" } });
    const res = await setOwnPassword(c, "same");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toBe("Choose a password different from the temporary one.");
    expect(rpc).not.toHaveBeenCalled();
  });
});
