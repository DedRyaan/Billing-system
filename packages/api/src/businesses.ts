// Businesses module (BIZ-01/BIZ-02/BIZ-05, D-77): typed CRUD + archive/restore
// RPC wrappers. NO local authorization - writes are sent and RLS verdicts map
// loudly (T-3-13). Explicit businessId parameters everywhere (D-80); zero
// ambient tenancy; zero framework imports.
//
// Column guards: update patches can NEVER touch id/gstin/business_id -
// GSTIN immutability and tenant scoping stay structural (T-3-14).

import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidStateCode } from "@billing/gst";
import { asError, fromPostgrest, type Result } from "./result";
import type { DataAccessError } from "./errors";

export interface BusinessRow {
  id: string;
  legal_name: string;
  trade_name: string | null;
  /** null exactly when registration_type is "unregistered" (no GST). */
  gstin: string | null;
  number_format: string;
  prefix: string | null;
  address: Record<string, unknown> | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  registration_type: "regular" | "composition" | "unregistered" | string;
  logo_path: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface CreateBusinessInput {
  /** null for a business not registered for GST. */
  gstin: string | null;
  legal_name: string;
  trade_name?: string | null;
  address?: Record<string, unknown> | null;
  /** GST state CODE from the @billing/gst STATE_CODES universe. */
  state?: string | null;
  phone?: string | null;
  email?: string | null;
  registration_type: "regular" | "composition" | "unregistered";
  number_format: "prefix_fy_seq" | "prefix_seq" | "seq";
  prefix?: string | null;
}

export interface UpdateBusinessPatch {
  legal_name?: string;
  trade_name?: string | null;
  address?: Record<string, unknown> | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
  logo_path?: string | null;
}

type RowEnvelope = { data: BusinessRow | BusinessRow[] | null; error: unknown };

/** Validate a state code BEFORE any network call; loud union on failure. */
function stateGuard(state: string | null | undefined): DataAccessError | null {
  if (state === undefined || state === null || state === "") return null;
  if (!isValidStateCode(state)) {
    return {
      reason: "VALIDATION_FAILED",
      message: `Unknown GST state code "${state}" - must be from the STATE_CODES universe.`,
      pgCode: "CLIENT_GUARD",
    };
  }
  return null;
}

export async function listBusinesses(client: SupabaseClient): Promise<Result<BusinessRow[]>> {
  const res = (await client
    .from("businesses")
    .select("*")
    .order("legal_name", { ascending: true })) as RowEnvelope;
  return fromPostgrest<BusinessRow[]>(Promise.resolve(res) as never);
}

export async function createBusiness(
  client: SupabaseClient,
  input: CreateBusinessInput,
): Promise<Result<BusinessRow>> {
  const guard = stateGuard(input.state);
  if (guard) return { ok: false, error: guard };

  const payload = {
    gstin: input.gstin,
    legal_name: input.legal_name,
    ...(input.trade_name !== undefined ? { trade_name: input.trade_name } : {}),
    ...(input.address !== undefined ? { address: input.address } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.email !== undefined ? { email: input.email } : {}),
    registration_type: input.registration_type,
    number_format: input.number_format,
    ...(input.prefix !== undefined ? { prefix: input.prefix } : {}),
  };
  const res = (await client.from("businesses").insert(payload).select().single()) as RowEnvelope;
  return fromPostgrest<BusinessRow>(Promise.resolve(res) as never);
}

/**
 * Partial-typed patch by businessId. The builder OMITS protected columns so a
 * crafted caller cannot re-scope or rewrite identity fields client-side
 * (defense in depth under WITH CHECK policies).
 */
export async function updateBusiness(
  client: SupabaseClient,
  businessId: string,
  patch: UpdateBusinessPatch,
): Promise<Result<BusinessRow>> {
  const guard = stateGuard(patch.state);
  if (guard) return { ok: false, error: guard };

  const payload: Record<string, unknown> = {};
  const keys: Array<keyof UpdateBusinessPatch> = [
    "legal_name",
    "trade_name",
    "address",
    "state",
    "phone",
    "email",
    "logo_path",
  ];
  for (const k of keys) {
    if (patch[k] !== undefined) payload[k] = patch[k];
  }
  // Deliberately absent: id, gstin, business_id, created_at, archived_at.

  const res = (await client
    .from("businesses")
    .update(payload)
    .eq("id", businessId)
    .select()
    .single()) as RowEnvelope;
  return fromPostgrest<BusinessRow>(Promise.resolve(res) as never);
}

async function rpcWrap(client: SupabaseClient, name: string, businessId: string): Promise<Result<unknown>> {
  try {
    const res = await client.rpc(name, { p_business_id: businessId });
    return fromPostgrest<unknown>(Promise.resolve(res));
  } catch (err) {
    return { ok: false, error: asError(err) };
  }
}

export function archiveBusiness(client: SupabaseClient, businessId: string): Promise<Result<unknown>> {
  return rpcWrap(client, "archive_business", businessId);
}

export function restoreBusiness(client: SupabaseClient, businessId: string): Promise<Result<unknown>> {
  return rpcWrap(client, "restore_business", businessId);
}
