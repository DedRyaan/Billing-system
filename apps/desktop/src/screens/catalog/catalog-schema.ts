// Catalog form schema (plan 03-09 Task 1, MSTR-04/A9/Risk 7).
//
// SLAB LAW: the rate option list derives EXCLUSIVELY from the engine's
// CURRENT_SLABS_BPS - a hand-typed list may never exist here. Future slab
// amendments land engine-side and this UI inherits them free. The save gate
// re-checks isLegalSlabRate so an abolished 12%/28% cannot survive either
// layer (T-3-34).
//
// HARD vs SOFT: price/MRP parse, stock >= 0 integer and slab law BLOCK save;
// HSN/SAC structural failures are WARNINGS that never block (spec posture).
import { UNIT_OPTIONS as UNIT_LIST } from "../../lib/constants/units";
import {
  CURRENT_SLABS_BPS,
  bpsToPercentString,
  isLegalSlabRate,
  parseDecimalToPaise,
  validateHsnSac,
} from "@billing/gst";

export type ItemKind = "goods" | "services";

export interface CatalogFormValues {
  name: string;
  kind: ItemKind;
  hsn_sac: string;
  /** Percent-string selected from slab-derived options ('5' etc.). */
  gst_rate_percent: string;
  unit: string;
  price: string;
  mrp: string;
  stock_qty: string;
}

export type CatalogFormField = keyof CatalogFormValues;
export type CatalogFormErrors = Partial<Record<CatalogFormField, string>>;
export type CatalogFormWarnings = Partial<Record<CatalogFormField, string>>;

/**
 * Rate options derived from the ENGINE constant ONLY (Risk 7/A9). Rendered
 * labels pin to ['0%','0.25%','1.5%','3%','5%','18%','40%'] by test; the
 * abolished 12%/28% can never appear because no such constant exists
 * upstream anymore.
 */
export function slabRateOptions(): ReadonlyArray<{ value: string; label: string }> {
  return CURRENT_SLABS_BPS.map((bps) => ({
    value: bpsToPercentString(bps),
    label: `${bpsToPercentString(bps)}%`,
  }));
}

export interface NormalizedCatalogItem {
  name: string;
  kind: ItemKind;
  hsnSac: string | null;
  hsnSacWarning: string | null;
  gstRateBps: bigint;
  unit: string;
  pricePaise: bigint;
  mrpPaise: bigint | null;
  stockQty: number;
}

export function validateCatalogForm(values: CatalogFormValues): {
  errors: CatalogFormErrors;
  warnings: CatalogFormWarnings;
  normalized: NormalizedCatalogItem | null;
} {
  const errors: CatalogFormErrors = {};
  const warnings: CatalogFormWarnings = {};

  const nameTrimmed = values.name.trim();
  if (nameTrimmed.length === 0) errors["name"] = "Name is required.";
  else if (nameTrimmed.length > 200) errors["name"] = "Name must be 200 characters or fewer.";

  if (values.kind !== "goods" && values.kind !== "services") {
    errors["kind"] = "Pick goods or services.";
  }

  // HSN/SAC: soft validation - specific reason caption as a WARNING.
  const code = values.hsn_sac.trim();
  if (code.length > 0) {
    const verdict = validateHsnSac(code, { kind: values.kind === "services" ? "sac" : "hsn" });
    if (!verdict.ok) warnings["hsn_sac"] = hsnSacWarningLocal(verdict.reason);
  }

  // GST rate: value must be one of the slab-derived options AND satisfy the
  // engine's legal-slab gate (belt + suspenders against hand-typed input).
  const rateVerdict = percentStringToBpsSafe(values.gst_rate_percent);
  if (rateVerdict === null) {
    errors["gst_rate_percent"] = "Pick a GST rate.";
  } else if (!isLegalSlabRate(rateVerdict).ok) {
    errors["gst_rate_percent"] = "That rate is not a current GST slab.";
  }

  if (!UNIT_LIST.includes(values.unit as (typeof UNIT_LIST)[number])) {
    errors["unit"] = "Pick a unit.";
  }

  const price = parseDecimalToPaise(values.price.trim());
  if (!price.ok) errors["price"] = "Enter a valid rupee amount (e.g. 149.50).";

  let mrpPaise: bigint | null = null;
  if (values.mrp.trim().length > 0) {
    const mrp = parseDecimalToPaise(values.mrp.trim());
    if (!mrp.ok) errors["mrp"] = "Enter a valid rupee amount (e.g. 149.50).";
    else mrpPaise = mrp.paise;
  }

  const stockRaw = values.stock_qty.trim();
  let stockQty = 0;
  if (stockRaw.length > 0 && !/^\d+$/.test(stockRaw)) {
    errors["stock_qty"] = "Stock must be a whole number of 0 or more.";
  } else if (stockRaw.length > 0) {
    stockQty = Number.parseInt(stockRaw, 10);
  }

  if (Object.keys(errors).length > 0) return { errors, warnings, normalized: null };

  return {
    errors,
    warnings,
    normalized: {
      name: nameTrimmed,
      kind: values.kind,
      hsnSac: code.length > 0 ? code : null,
      hsnSacWarning:
        warnings["hsn_sac"] !== undefined ? (warnings["hsn_sac"] as string) : null,
      gstRateBps: rateVerdict as bigint,
      unit: values.unit,
      pricePaise: (price as { ok: true; paise: bigint }).paise,
      mrpPaise,
      stockQty,
    },
  };
}

function percentStringToBpsSafe(percent: string): bigint | null {
  const trimmed = percent.trim();
  if (trimmed.length === 0) return null;
  // Only accept exact slab-derived renderings; anything else fails the gate.
  const match = CURRENT_SLABS_BPS.find((bps) => bpsToPercentString(bps) === trimmed);
  if (match === undefined) return null;
  const known = CURRENT_SLABS_BPS as readonly bigint[];
  return known.includes(match) ? match : null;
}

function hsnSacWarningLocal(reason: string): string {
  const specific: Record<string, string> = {
    EMPTY: "HSN/SAC is empty.",
    NON_DIGIT_CHARS: "HSN/SAC must contain digits only.",
    BAD_HSN_LENGTH: "HSN codes are usually 4, 6 or 8 digits.",
    BAD_SAC_LENGTH: "SAC codes are 6 digits.",
    SAC_PREFIX_INVALID: "SAC codes start with 99.",
  };
  return `${specific[reason] ?? "This code looks unusual."} You can still save.`;
}
