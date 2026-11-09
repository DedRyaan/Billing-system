// Memberships module (AUTH-04/D-78): admin roster visibility is RLS's truth
// (0013 policies - admins see managed staff + self, super_admin sees all);
// assignment toggles write business_members rows; staff deactivation wraps the
// audited Phase 1 RPCs verbatim.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgrest, type Result } from "./result";

export interface ProfileSummary {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  locked_at: string | null;
}

export interface BusinessMembershipRow {
  business_id: string;
  user_id: string;
  business?: { id: string; legal_name: string; archived_at: string | null };
}

type RowEnvelope = { data: unknown; error: unknown };

export async function listRosterForAdmin(client: SupabaseClient): Promise<Result<ProfileSummary[]>> {
  const res = (await client
    .from("profiles")
    .select("id,email,full_name,role,is_active,locked_at")
    .order("full_name", { ascending: true })) as RowEnvelope;
  return fromPostgrest<ProfileSummary[]>(Promise.resolve(res) as never);
}

export async function assignmentsOf(
  client: SupabaseClient,
  userId: string,
): Promise<Result<BusinessMembershipRow[]>> {
  const res = (await client
    .from("business_members")
    .select("business_id,user_id,businesses(id,legal_name,archived_at)")
    .eq("user_id", userId)) as RowEnvelope;
  const mapped = fromPostgrest<BusinessMembershipRow[]>(Promise.resolve(res) as never);
  // Normalize joined shape into `business` for consumers.
  const out = await mapped;
  if (!out.ok) return out;
  return {
    ok: true,
    data: out.data.map((row) => {
      const r = row as unknown as { businesses?: BusinessMembershipRow["business"] };
      return r.businesses !== undefined
        ? { business_id: row.business_id, user_id: row.user_id, business: r.businesses }
        : row;
    }),
  };
}

export async function setMembership(
  client: SupabaseClient,
  args: { userId: string; businessId: string; assigned: boolean },
): Promise<Result<unknown>> {
  if (args.assigned) {
    const res = (await client
      .from("business_members")
      .insert({ user_id: args.userId, business_id: args.businessId })
      .select()
      .single()) as RowEnvelope;
    return fromPostgrest<unknown>(Promise.resolve(res) as never);
  }
  const res = await client
    .from("business_members")
    .delete()
    .eq("user_id", args.userId)
    .eq("business_id", args.businessId);
  return fromPostgrest<unknown>(Promise.resolve({ data: res.data ?? null, error: res.error }));
}

async function staffRpc(client: SupabaseClient, name: string, targetUserId: string): Promise<Result<unknown>> {
  const res = await client.rpc(name, { p_target: targetUserId });
  return fromPostgrest<unknown>(Promise.resolve(res));
}

export function deactivateStaff(client: SupabaseClient, targetUserId: string): Promise<Result<unknown>> {
  return staffRpc(client, "deactivate_staff_account", targetUserId);
}

export function reactivateStaff(client: SupabaseClient, targetUserId: string): Promise<Result<unknown>> {
  return staffRpc(client, "reactivate_staff_account", targetUserId);
}

// ---------------------------------------------------------------------------
// Staff accounts (invite-user Edge Function): direct creation + admin reset.
// Both return a one-time temporary password the admin shares; the account is
// flagged must_change_password so the person sets their own at first sign-in.
// ---------------------------------------------------------------------------

const STAFF_ERROR_MESSAGES: Record<string, string> = {
  email_exists: "An account with this email already exists.",
  forbidden: "You don't have permission to do that.",
  cannot_reset_self: "Change your own password from the sign-in screen instead.",
  user_not_found: "That account no longer exists.",
  invalid_payload: "Check the name and email and try again.",
};

interface FunctionsHttpLike {
  context?: { json?: () => Promise<unknown> };
  message?: string;
}

async function staffFunctionError(error: unknown): Promise<Result<never>> {
  let code: string | undefined;
  const ctx = (error as FunctionsHttpLike | null)?.context;
  if (ctx?.json) {
    try {
      const body = (await ctx.json()) as { error?: { code?: unknown } } | null;
      if (typeof body?.error?.code === "string") code = body.error.code;
    } catch {
      // unreadable body: fall through to the generic message
    }
  }
  const message =
    (code !== undefined ? STAFF_ERROR_MESSAGES[code] : undefined) ??
    "Something went wrong. Check your connection and try again.";
  if (code === "forbidden") {
    return { ok: false, error: { reason: "PERMISSION_DENIED", message, pgCode: "403" } };
  }
  if (code !== undefined && code in STAFF_ERROR_MESSAGES) {
    return { ok: false, error: { reason: "VALIDATION_FAILED", message, pgCode: code } };
  }
  return { ok: false, error: { reason: "UNKNOWN", message, ...(code !== undefined ? { code } : {}) } };
}

export interface TempCredential {
  userId: string;
  tempPassword: string;
}

export async function createStaffAccount(
  client: SupabaseClient,
  input: { email: string; fullName: string; businessIds: string[] },
): Promise<Result<TempCredential>> {
  try {
    const { data, error } = await client.functions.invoke("invite-user", {
      body: {
        action: "create",
        email: input.email,
        full_name: input.fullName,
        ...(input.businessIds.length > 0 ? { business_ids: input.businessIds } : {}),
      },
    });
    if (error) return staffFunctionError(error);
    const d = data as { user_id?: string; temp_password?: string } | null;
    if (!d?.user_id || !d.temp_password) return staffFunctionError(null);
    return { ok: true, data: { userId: d.user_id, tempPassword: d.temp_password } };
  } catch (err) {
    return staffFunctionError(err);
  }
}

export async function resetStaffPassword(
  client: SupabaseClient,
  userId: string,
): Promise<Result<TempCredential>> {
  try {
    const { data, error } = await client.functions.invoke("invite-user", {
      body: { action: "reset_password", user_id: userId },
    });
    if (error) return staffFunctionError(error);
    const d = data as { temp_password?: string } | null;
    if (!d?.temp_password) return staffFunctionError(null);
    return { ok: true, data: { userId, tempPassword: d.temp_password } };
  } catch (err) {
    return staffFunctionError(err);
  }
}

/** Signed-in user sets their own password and clears the forced-change flag. */
export async function setOwnPassword(
  client: SupabaseClient,
  newPassword: string,
): Promise<Result<void>> {
  const updated = await client.auth.updateUser({ password: newPassword });
  if (updated.error) {
    const msg = updated.error.message ?? "";
    const message = /different from the old|same_password/i.test(msg + (updated.error as { code?: string }).code)
      ? "Choose a password different from the temporary one."
      : /weak|pwned|leaked/i.test(msg)
        ? "That password is too easy to guess. Pick a stronger one."
        : "Couldn't update your password. Try again.";
    return { ok: false, error: { reason: "VALIDATION_FAILED", message, pgCode: "auth" } };
  }
  const cleared = await client.rpc("clear_must_change_password");
  return fromPostgrest<void>(Promise.resolve({ data: undefined, error: cleared.error }));
}
