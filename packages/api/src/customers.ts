// Customers module (MSTR-01, A7 soft-retire). Explicit businessId on every
// call (D-80); update builders NEVER re-scope business_id in the payload
// (T-3-14 defense-in-depth under WITH CHECK policies).
//
// RESERVED KEY (documented v1 convention): the customer's last successful
// GSTIN auto-fetch snapshot lives INSIDE the existing address jsonb under the
// reserved key `_gstin_lookup` - honoring the 0016 freeze with zero schema
// addition. embedGstinLookup()/readGstinLookup() are the only sanctioned
// accessors; screens must never hand-write the key.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgrest, type Result } from "./result";

export interface CustomerAddress {
  lines?: string[];
  city?: string;
  pincode?: string;
  [key: string]: unknown;
}

export const GSTIN_LOOKUP_KEY = "_gstin_lookup";

export interface CustomerRow {
  id: string;
  business_id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  address: CustomerAddress | null;
  state: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomerInput {
  name: string;
  gstin?: string | null;
  phone?: string | null;
  address?: CustomerAddress | null;
  stateCode?: string | null;
  notes?: string | null;
}

export interface UpdateCustomerPatch {
  name?: string;
  gstin?: string | null;
  phone?: string | null;
  address?: CustomerAddress | null;
  stateCode?: string | null;
  notes?: string | null;
}

export function embedGstinLookup(
  address: CustomerAddress | null,
  snapshot: Record<string, unknown>,
): CustomerAddress {
  return { ...(address ?? {}), [GSTIN_LOOKUP_KEY]: snapshot };
}

export function readGstinLookup(address: CustomerAddress | null): Record<string, unknown> | undefined {
  if (address === null || typeof address !== "object") return undefined;
  return address[GSTIN_LOOKUP_KEY] as Record<string, unknown> | undefined;
}

type RowEnvelope = { data: unknown; error: unknown };

function toCustomerRows(data: unknown): CustomerRow[] {
  return Array.isArray(data) ? (data as CustomerRow[]) : [];
}

export async function listCustomersByBusiness(
  client: SupabaseClient,
  businessId: string,
): Promise<Result<CustomerRow[]>> {
  const res = (await client
    .from("customers")
    .select("*")
    .eq("business_id", businessId)
    .order("name", { ascending: true })) as RowEnvelope;
  return fromPostgrest<CustomerRow[]>(Promise.resolve(res) as never);
}

export async function createCustomer(
  client: SupabaseClient,
  businessId: string,
  input: CreateCustomerInput,
): Promise<Result<CustomerRow>> {
  const payload = {
    business_id: businessId,
    name: input.name,
    ...(input.gstin !== undefined ? { gstin: input.gstin } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.address !== undefined ? { address: input.address } : {}),
    ...(input.stateCode !== undefined ? { state: input.stateCode } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
  const res = (await client.from("customers").insert(payload).select().single()) as RowEnvelope;
  return fromPostgrest<CustomerRow>(Promise.resolve(res) as never);
}

/**
 * Tenant-scoped patch: id + business_id filters make cross-business writes
 * structurally impossible for this path; payload never carries business_id.
 */
export async function updateCustomer(
  client: SupabaseClient,
  args: { id: string; businessId: string; patch: UpdateCustomerPatch },
): Promise<Result<CustomerRow>> {
  const payload: Record<string, unknown> = {};
  if (args.patch.name !== undefined) payload["name"] = args.patch.name;
  if (args.patch.gstin !== undefined) payload["gstin"] = args.patch.gstin;
  if (args.patch.phone !== undefined) payload["phone"] = args.patch.phone;
  if (args.patch.address !== undefined) payload["address"] = args.patch.address;
  if (args.patch.stateCode !== undefined) payload["state"] = args.patch.stateCode;
  if (args.patch.notes !== undefined) payload["notes"] = args.patch.notes;

  const res = (await client
    .from("customers")
    .update(payload)
    .eq("id", args.id)
    .eq("business_id", args.businessId)
    .select()
    .single()) as RowEnvelope;
  return fromPostgrest<CustomerRow>(Promise.resolve(res) as never);
}

/** Soft-retire (A7): no hard delete exists anywhere on this surface. */
export async function deactivateCustomer(
  client: SupabaseClient,
  args: { id: string; businessId: string },
): Promise<Result<CustomerRow>> {
  const res = (await client
    .from("customers")
    .update({ is_active: false })
    .eq("id", args.id)
    .eq("business_id", args.businessId)
    .select()
    .single()) as RowEnvelope;
  return fromPostgrest<CustomerRow>(Promise.resolve(res) as never);
}
