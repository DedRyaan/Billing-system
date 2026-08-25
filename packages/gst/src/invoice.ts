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

import { divRoundHalfUp, lineBasePaise } from './money';
import { assertCatalogRate } from './rates';

export type LineCharacter =
  | 'taxable'
  | 'exempt'
  | 'nil_rated'
  | 'non_gst'
  | 'zero_rated_taxable';

export type PricingMode = 'exclusive' | 'inclusive';

export type TaxHead = 'CGST_SGST' | 'CGST_UTGST' | 'IGST';

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
  /** Discount in basis points against the line base (10000 = free). */
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
  | { ok: false; reason: 'NOT_A_CURRENT_SLAB' };

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
 */
export function computeLine(
  line: LineInput,
  ctx: { head: TaxHead },
): LineOutcome {
  if (!isNonTaxable(line.character)) {
    const gate = assertCatalogRate(line.gstRateBps);
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
