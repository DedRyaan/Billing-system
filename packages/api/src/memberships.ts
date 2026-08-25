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
