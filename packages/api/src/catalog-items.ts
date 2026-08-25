// Catalog-items module (MSTR-04, D-75/A7). Admin-keyed writes stay RLS's
// decision - this layer only formats money/rates through @billing/gst helpers
// and maps denials loudly. Slab law lives upstream (A9): callers pass bps that
// must satisfy isLegalSlabRate BEFORE calling; storage converts via
// bpsToPercentString ONLY - never hand-divide.
import { bpsToPercentString } from "@billing/gst";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromPostgrest, type Result } from "./result";

/** App vocabulary for units (A10 master-data scale); UI Select consumes it. */
export const UNIT_OPTIONS = ["nos", "pcs", "kg", "g", "l", "ml", "m", "box", "set"] as const;
export type UnitOption = (typeof UNIT_OPTIONS)[number];

export interface CatalogItemRow {
  id: string;
  business_id: string;
  name: string;
  hsn_sac: string | null;
  gst_rate: number | string;
  unit: string;
  price: number | string;
  mrp: number | string | null;
  stock_qty: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** 'goods' -> HSN, 'services' -> SAC; one column carries either. */
export type ItemKind = "goods" | "services";

export interface CreateCatalogItemInput {
  name: string;
  kind: ItemKind;
  /** Required for goods; services may omit. */
  hsnSac?: string;
  gstRateBps: bigint;
  unit: UnitOption | string;
  pricePaise: bigint;
  mrpPaise?: bigint | null;
  stockQty?: number;
  isActive?: boolean;
}

export interface UpdateCatalogItemPatch {
  name?: string;
  hsnSac?: string | null;
  gstRateBps?: bigint;
  unit?: string;
  pricePaise?: bigint;
  mrpPaise?: bigint | null;
  stockQty?: number;
  isActive?: boolean;
}

type RowEnvelope = { data: unknown; error: unknown };

function paiseToNumeric(paise: bigint): string {
  // numeric(14,2) wire format: sign + whole.frac(2), no currency symbol.
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}`;
}

function buildPayload(
  base: Record<string, unknown>,
  rest: {
    gstRateBps?: bigint | undefined;
    pricePaise?: bigint | undefined;
    mrpPaise?: bigint | null | undefined;
    hsnSac?: string | null | undefined;
  },
): void {
  if (rest.gstRateBps !== undefined) base["gst_rate"] = bpsToPercentString(rest.gstRateBps);
  if (rest.pricePaise !== undefined) base["price"] = paiseToNumeric(rest.pricePaise);
  if (rest.mrpPaise !== undefined) {
    base["mrp"] = rest.mrpPaise === null ? null : paiseToNumeric(rest.mrpPaise);
  }
  if (rest.hsnSac !== undefined) base["hsn_sac"] = rest.hsnSac;
}

export async function listCatalogItems(
  client: SupabaseClient,
  businessId: string,
): Promise<Result<CatalogItemRow[]>> {
  const res = (await client
    .from("catalog_items")
    .select("*")
    .eq("business_id", businessId)
    .order("name", { ascending: true })) as RowEnvelope;
  const out = fromPostgrest<CatalogItemRow[]>(Promise.resolve(res) as never);
  return out;
}

export async function createCatalogItem(
  client: SupabaseClient,
  businessId: string,
  input: CreateCatalogItemInput,
): Promise<Result<CatalogItemRow>> {
  const payload: Record<string, unknown> = {
    business_id: businessId,
    name: input.name,
    unit: input.unit,
    stock_qty: input.stockQty ?? 0,
    is_active: input.isActive ?? true,
  };
  buildPayload(payload, {
    gstRateBps: input.gstRateBps,
    pricePaise: input.pricePaise,
    mrpPaise: input.mrpPaise ?? null,
    hsnSac: input.hsnSac ?? null,
  });
  const res = (await client.from("catalog_items").insert(payload).select().single()) as RowEnvelope;
  return fromPostgrest<CatalogItemRow>(Promise.resolve(res) as never);
}

export async function updateCatalogItem(
  client: SupabaseClient,
  args: { id: string; businessId: string; patch: UpdateCatalogItemPatch },
): Promise<Result<CatalogItemRow>> {
  const payload: Record<string, unknown> = {};
  if (args.patch.name !== undefined) payload["name"] = args.patch.name;
  if (args.patch.unit !== undefined) payload["unit"] = args.patch.unit;
  if (args.patch.stockQty !== undefined) payload["stock_qty"] = args.patch.stockQty;
  if (args.patch.isActive !== undefined) payload["is_active"] = args.patch.isActive;
  buildPayload(payload, {
    gstRateBps: args.patch.gstRateBps,
    pricePaise: args.patch.pricePaise,
    mrpPaise: args.patch.mrpPaise,
    hsnSac: args.patch.hsnSac,
  });

  const res = (await client
    .from("catalog_items")
    .update(payload)
    .eq("id", args.id)
    .eq("business_id", args.businessId)
    .select()
    .single()) as RowEnvelope;
  return fromPostgrest<CatalogItemRow>(Promise.resolve(res) as never);
}

/** A7: retire, never delete. Staff-visible history stays intact. */
export async function deactivateItem(
  client: SupabaseClient,
  args: { id: string; businessId: string },
): Promise<Result<CatalogItemRow>> {
  return updateCatalogItem(client, { ...args, patch: { isActive: false } });
}
