/**
 * Invoice composition layer — line computation, zero-rate taxonomy,
 * classification, and totals (D-54/D-55/D-56/D-57/D-58/D-60/D-61/D-62/D-65).
 *
 * This module is the engine's composition point: it consumes money.ts
 * primitives, the rates slab gate, and place-of-supply heads. Everything is
 * pure and total; rejections are data (discriminated unions), never
 * exceptions.
 *
 * Odd-paisa split contract (RESEARCH Pitfall 5 mandate): the FULL per-line
 * tax is computed first; the intra-state halves use floor division and ANY
 * remainder paisa is assigned to the CGST member. Phase 4's server-side
 * finalize compare consumes THIS exact policy — do not change it without a
 * new golden matrix.
 */

import { divRoundHalfUp, lineBasePaise, roundOffPaise } from './money';
import { isLegalSlabRate } from './rates';
import type { TaxHead } from './place-of-supply';

export type { TaxHead } from './place-of-supply';

export type LineCharacter =
  | 'taxable'
  | 'exempt'
  | 'nil_rated'
  | 'non_gst'
  | 'zero_rated_taxable';

export type PricingMode = 'exclusive' | 'inclusive';

export type RegistrationType = 'regular' | 'composition';

/** D-60: all four no-tax flavors modeled distinctly from taxable@0%. */
const NON_TAXABLE_CHARACTERS: readonly LineCharacter[] = [
  'exempt',
  'nil_rated',
  'non_gst',
  'zero_rated_taxable',
];

function isNonTaxable(character: LineCharacter): boolean {
  return NON_TAXABLE_CHARACTERS.includes(character);
}

export interface LineInput {
  /** Quantity in milli-units (<=3 decimals, pre-scaled x1000). */
  qtyMilli: bigint;
  unitPricePaise: bigint;
  /** Discount in basis points against the line base (10000 = free). Must lie in [0, 10000]; out-of-range values reject typed. */
  discountBps: bigint;
  pricingMode: PricingMode;
  gstRateBps: bigint;
  character: LineCharacter;
  /** Reverse-charge flag rides through untouched (D-54). */
  rcm?: boolean;
}

export interface LineResult {
  // Echoed inputs.
  qtyMilli: bigint;
  unitPricePaise: bigint;
  discountBps: bigint;
  pricingMode: PricingMode;
  gstRateBps: bigint;
  character: LineCharacter;
  rcm: boolean;
  head: TaxHead;

  // Computed amounts (paise).
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstOrUtgstPaise: bigint;
  igstPaise: bigint;
  taxPaise: bigint;
}

export type LineOutcome =
  | ({ ok: true } & LineResult)
  | { ok: false; reason: 'NOT_A_CURRENT_SLAB' }
  | { ok: false; reason: 'NEGATIVE_AMOUNT' }
  | { ok: false; reason: 'DISCOUNT_OUT_OF_RANGE' }
  | { ok: false; reason: 'NEGATIVE_RATE' };

/**
 * Compute one invoice line under the given tax head.
 *
 * Exclusive mode (D-58 standard B2B):
 *   base = half-up(qtyMilli x price / 1000); discount = half-up(base x bps / 10000)
 *   taxable = base - discount; fullTax = half-up(taxable x rateBps / 10000)
 *
 * Inclusive mode (D-58 MRP-inclusive): the discounted gross ALREADY contains
 * tax, so extraction back-calculates:
 *   taxable = half-up(gross x 10000 / (10000 + rateBps)); fullTax = gross - taxable
 * The residual method guarantees taxable + tax === gross for every input.
 *
 * Non-taxable characters short-circuit to zero tax regardless of the rate
 * field (D-60); the slab gate only fires for character 'taxable'.
 *
 * Boundary domain gate: qtyMilli and unitPricePaise must be >= 0n and
 * discountBps in [0, 10000]; gstRateBps must be >= 0n for EVERY character —
 * non-taxable lines skip the slab gate but still divide by (10000 + rateBps)
 * in inclusive mode, so a negative rate is either a BigInt RangeError
 * (rate = -10000n) or silent taxable inflation (T-2-R1). `divRoundHalfUp`'s
 * half-up direction is only defined for non-negative operands, so
 * out-of-contract numerics (a classic upstream data-entry/zod-gap bug class)
 * reject as TYPED DATA before any math runs — the engine never executes
 * undefined rounding semantics on negative taxable values, and rejections
 * are data, never exceptions.
 */
export function computeLine(
  line: LineInput,
  ctx: { head: TaxHead },
): LineOutcome {
  // Domain ranges before anything else — sign/range violations are more
  // fundamental than rate legality and must not reach any arithmetic.
  if (line.qtyMilli < 0n || line.unitPricePaise < 0n) {
    return { ok: false, reason: 'NEGATIVE_AMOUNT' };
  }
  if (line.discountBps < 0n || line.discountBps > 10000n) {
    return { ok: false, reason: 'DISCOUNT_OUT_OF_RANGE' };
  }
  if (line.gstRateBps < 0n) {
    return { ok: false, reason: 'NEGATIVE_RATE' };
  }

  if (!isNonTaxable(line.character)) {
    const gate = isLegalSlabRate(line.gstRateBps);
    if (!gate.ok) return { ok: false, reason: gate.reason };
  }

  const rcm = line.rcm === true;
  const base = lineBasePaise(line.qtyMilli, line.unitPricePaise);
  const discountPaise = divRoundHalfUp(base * line.discountBps, 10000n);

  let taxable: bigint;
  let fullTax: bigint;

  if (line.pricingMode === 'inclusive') {
    const gross = base - discountPaise;
    taxable = divRoundHalfUp(gross * 10000n, 10000n + line.gstRateBps);
    fullTax = gross - taxable; // residual: columns always reconcile to gross
  } else {
    taxable = base - discountPaise;
    fullTax = divRoundHalfUp(taxable * line.gstRateBps, 10000n);
  }

  let cgst = 0n;
  let sgstOrUtgst = 0n;
  let igst = 0n;
  if (!isNonTaxable(line.character) && fullTax > 0n) {
    if (ctx.head === 'IGST') {
      igst = fullTax;
    } else {
      // Pitfall 5 pinning: floor both halves, remainder paisa -> CGST member.
      const halfFloor = fullTax / 2n;
      cgst = halfFloor + (fullTax % 2n);
      sgstOrUtgst = halfFloor;
    }
  }

  return {
    ok: true,
    qtyMilli: line.qtyMilli,
    unitPricePaise: line.unitPricePaise,
    discountBps: line.discountBps,
    pricingMode: line.pricingMode,
    gstRateBps: line.gstRateBps,
    character: line.character,
    rcm,
    head: ctx.head,
    taxablePaise: taxable,
    cgstPaise: cgst,
    sgstOrUtgstPaise: sgstOrUtgst,
    igstPaise: igst,
    taxPaise: cgst + sgstOrUtgst + igst,
  };
}

// ---------------------------------------------------------------------------
// Classification (D-60/D-61/D-62)
// ---------------------------------------------------------------------------

export type DocClass = 'TAX_INVOICE' | 'BILL_OF_SUPPLY';

export type DraftClassification =
  | { ok: true; character: LineCharacter | null }
  | {
      ok: false;
      reason: 'HETEROGENEOUS_TAX_CHARACTER';
      /** 0-based array indexes of the offending lines — NOT human-facing 1-based positions. */
      offendingLineIndexes: number[];
    };

/**
 * Invoice-level character uniformity (D-61): a draft may not mix taxable
 * and non-taxable lines. The first line's character is the reference; every
 * later position whose character differs is reported in
 * `offendingLineIndexes` (data, not exceptions) as 0-based array indexes
 * matching `lines[i]` directly — consumers must add 1 before showing them
 * to users. An empty draft is vacuously uniform at `character: null`.
 * Zero-amount lines do NOT offend — mixing is a character question, not an
 * amount question (D-65).
 */
export function classifyDraft(
  lines: ReadonlyArray<{ readonly character: LineCharacter }>,
): DraftClassification {
  const reference = lines[0]?.character ?? null;
  if (reference === null) return { ok: true, character: null };

  const offending: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const character = lines[i]?.character;
    if (character !== undefined && character !== reference) {
      offending.push(i);
    }
  }

  if (offending.length > 0) {
    return {
      ok: false,
      reason: 'HETEROGENEOUS_TAX_CHARACTER',
      offendingLineIndexes: offending,
    };
  }
  return { ok: true, character: reference };
}

/**
 * Document class from registration type + the (already uniform) draft
 * character (D-62): composition dealers always issue a Bill of Supply;
 * regular dealers issue Tax Invoices for taxable characters (including
 * zero-rated-taxable) and Bills of Supply for genuinely non-taxable ones.
 */
export function classifyDocument(config: {
  registrationType: RegistrationType;
  character: LineCharacter | null;
}): DocClass {
  if (config.registrationType === 'composition') return 'BILL_OF_SUPPLY';
  if (config.character === 'taxable' || config.character === 'zero_rated_taxable') {
    return 'TAX_INVOICE';
  }
  return 'BILL_OF_SUPPLY';
}

export type Gstr1Flavor =
  | 'B2B'
  | 'B2CS'
  | 'B2_UNRESOLVED'
  | 'GSTR1_TABLE8_EXEMPT'
  | 'GSTR1_TABLE8_NIL_RATED'
  | 'GSTR1_TABLE8_NON_GST'
  | 'GSTR1_TABLE14_ZERO_RATED';

/**
 * GSTR-1 mapping surface (D-60): each of the four no-tax flavors maps to a
 * DISTINCT table hint; taxable lines hint B2B/B2C by supply type. This is a
 * routing hint only — full aggregation and buyer-registration-based B2B/B2C
 * refinement belong to Phase 8.
 */
export function gstr1FlavorFor(
  character: LineCharacter,
  supplyType?: 'intra_state' | 'inter_state',
): Gstr1Flavor {
  switch (character) {
    case 'exempt':
      return 'GSTR1_TABLE8_EXEMPT';
    case 'nil_rated':
      return 'GSTR1_TABLE8_NIL_RATED';
    case 'non_gst':
      return 'GSTR1_TABLE8_NON_GST';
    case 'zero_rated_taxable':
      return 'GSTR1_TABLE14_ZERO_RATED';
    case 'taxable':
      if (supplyType === 'inter_state') return 'B2B';
      if (supplyType === 'intra_state') return 'B2CS';
      return 'B2_UNRESOLVED';
  }
}

// ---------------------------------------------------------------------------
// Invoice totals — the single rounding event lives here (D-56)
// ---------------------------------------------------------------------------

export interface InvoiceTotals {
  lines: LineResult[];
  subtotalPaise: bigint;
  taxPaise: bigint;
  roundOffPaise: bigint;
  grandTotalPaise: bigint;
  docClass: DocClass;
  gstr1Flavor: Gstr1Flavor;
  character: LineCharacter | null;
  reverseCharge: boolean;
}

export type InvoiceTotalsOutcome =
  | ({ ok: true } & InvoiceTotals)
  | { ok: false; reason: 'EMPTY_DRAFT' }
  | {
      ok: false;
      reason: 'HETEROGENEOUS_TAX_CHARACTER';
      /** 0-based array indexes of the offending lines — NOT human-facing positions. */
      offendingLineIndexes: number[];
    }
  | { ok: false; reason: 'NOT_A_CURRENT_SLAB'; linePosition: number }
  | { ok: false; reason: 'NEGATIVE_AMOUNT'; linePosition: number }
  | { ok: false; reason: 'DISCOUNT_OUT_OF_RANGE'; linePosition: number }
  | { ok: false; reason: 'NEGATIVE_RATE'; linePosition: number };

/**
 * Total an invoice draft: an empty draft rejects typed ('EMPTY_DRAFT' — a
 * zero-line document is almost certainly an upstream bug worth surfacing,
 * not an issuable Bill of Supply), uniform-character check propagates
 * (D-61), every line computes under the POS-derived head, each column sums
 * EXACTLY, and the ONLY half-up rounding event in the pipeline applies to
 * the raw grand total as the signed Round Off figure (D-56). Classification
 * and GSTR-1 flavor ride along (D-62/D-60); the reverse-charge flag echoes
 * untouched (D-54).
 */
export function totalInvoice(
  lines: ReadonlyArray<LineInput>,
  ctx: {
    head: TaxHead;
    registrationType: RegistrationType;
    reverseCharge: boolean;
  },
): InvoiceTotalsOutcome {
  if (lines.length === 0) return { ok: false, reason: 'EMPTY_DRAFT' };

  const classification = classifyDraft(lines);
  if (!classification.ok) return classification;

  const computed: LineResult[] = [];
  for (const [position, line] of lines.entries()) {
    const result = computeLine(line, { head: ctx.head });
    if (!result.ok) return { ok: false, reason: result.reason, linePosition: position };
    computed.push(result);
  }

  let subtotal = 0n;
  let taxTotal = 0n;
  for (const line of computed) {
    subtotal += line.taxablePaise;
    taxTotal += line.taxPaise;
  }
  const rawGrandTotal = subtotal + taxTotal;
  const roundOff = roundOffPaise(rawGrandTotal);

  const supplyType = ctx.head === 'IGST' ? 'inter_state' : 'intra_state';
  return {
    ok: true,
    lines: computed,
    subtotalPaise: subtotal,
    taxPaise: taxTotal,
    roundOffPaise: roundOff,
    grandTotalPaise: rawGrandTotal + roundOff,
    docClass: classifyDocument({
      registrationType: ctx.registrationType,
      character: classification.character,
    }),
    gstr1Flavor:
      classification.character === null
        ? 'B2_UNRESOLVED'
        : gstr1FlavorFor(classification.character, supplyType),
    character: classification.character,
    reverseCharge: ctx.reverseCharge === true,
  };
}
