/**
 * Current-law GST slab constants + legal-slab gate (D-50 amended / D-52 / D-53).
 *
 * The engine is the single source of "which rates are legal" (D-52): slabs
 * are typed in-engine constants, NOT admin-editable config, and the table
 * carries NO historical bands (D-53) — invoice snapshots are frozen data,
 * so the abolished 12% / 28% slabs reject here even though they were legal
 * before the amendment.
 *
 * Current set per CBIC Notfn 9/2025-IT(Rate), effective 2025-09-22:
 * nil/exempt · 0.25% · 1.5% · 3% · 5% · 18% · 40% — the post-"GST 2.0"
 * goods schedule (40% = demerit rate). Compensation cess machinery is
 * intentionally absent from this module (D-51 STRIPPED amendment).
 *
 * Purity: no clock parameter exists anywhere in this module's signatures.
 * The effective-from constant documents provenance; lookups are stateless.
 */

/**
 * Current-law slab set in basis points (1% = 100 bps).
 *
 * Exactly seven members: {0, 25, 150, 300, 500, 1800, 4000}.
 * The abolished twelve-percent / twenty-eight-percent values appear ONLY in
 * rejection tests — never as accepted constants.
 */
export const CURRENT_SLABS_BPS = [
  0n, 25n, 150n, 300n, 500n, 1800n, 4000n,
] as const;

/** Effective date of the current schedule ('2025-09-22', Notfn 9/2025-IT(Rate)). */
export const SLAB_EFFECTIVE_FROM = '2025-09-22';

export type SlabGateResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_A_CURRENT_SLAB' };

/**
 * Legal-slab check over basis points. Returns a discriminated union, never
 * a boolean and never an exception — callers MUST inspect the union and can
 * render the exact rejection reason (MSTR-style ergonomics per RESEARCH
 * Pattern 5). This is also THE entry-time catalog-rate gate: Phase 3 catalog
 * screens call it when an item's GST rate is saved, so the union contract is
 * the single honest shape (no assert-flavored alias exists to invite skipping
 * the result check).
 */
export function isLegalSlabRate(rateBps: bigint): SlabGateResult {
  const known = CURRENT_SLABS_BPS as readonly bigint[];
  return known.includes(rateBps)
    ? { ok: true }
    : { ok: false, reason: 'NOT_A_CURRENT_SLAB' };
}

export type PercentFailReason =
  | 'EMPTY'
  | 'INVALID_CHARACTERS'
  | 'TOO_MANY_DECIMAL_PLACES'
  | 'SIGN_NOT_ALLOWED';

export type PercentToBpsResult =
  | { ok: true; bps: bigint }
  | { ok: false; reason: PercentFailReason };

function isAllDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (const ch of s) {
    if (ch < '0' || ch > '9') return false;
  }
  return true;
}

/**
 * Exact percent-string -> basis-points conversion by pure string math.
 *
 * A percent with at most two fractional places IS an integer count of
 * hundredths of a percent, and one hundredth of one percent is exactly one
 * basis point — so the parsed hundredths value equals bps with no rounding
 * anywhere: '0.25' -> 25n, '1.5' -> 150n, '40' -> 4000n.
 *
 * Mirrors money.ts parse discipline: plain digit strings only, no sign,
 * no exponent form, no whitespace or currency glyphs; more than two
 * fractional places rejects because the DB column is numeric(5,2)
 * (migration 0005_ledger_masterdata.sql gst_rate numeric(5,2)).
 */
export function percentStringToBps(s: string): PercentToBpsResult {
  if (s.length === 0) return { ok: false, reason: 'EMPTY' };
  if (s.includes('+') || s.includes('-')) {
    return { ok: false, reason: 'SIGN_NOT_ALLOWED' };
  }

  const parts = s.split('.');
  if (parts.length > 2) return { ok: false, reason: 'INVALID_CHARACTERS' };
  const intPart = parts[0] ?? '';
  const fracPart = parts.length === 2 ? (parts[1] ?? '') : '';

  if (!isAllDigits(intPart) || (parts.length === 2 && !isAllDigits(fracPart))) {
    return { ok: false, reason: 'INVALID_CHARACTERS' };
  }
  if (intPart.length === 0 || (parts.length === 2 && fracPart.length === 0)) {
    // '.', '5.', '.5' — a bare dot or dangling side is not a digit string.
    return { ok: false, reason: 'INVALID_CHARACTERS' };
  }
  if (fracPart.length > 2) {
    return { ok: false, reason: 'TOO_MANY_DECIMAL_PLACES' };
  }

  const hundredths =
    fracPart.length === 1 ? BigInt(fracPart) * 10n : BigInt(fracPart);
  // Hundredths of a percent == basis points, exactly.
  return { ok: true, bps: BigInt(intPart) * 100n + hundredths };
}

/**
 * Canonical plain-decimal rendering of basis points as percent text
 * ('25' -> '0.25', '4000' -> '40'). Inverse of `percentStringToBps` on its
 * accept set: parse(render(b)) === b. Contract mirrors divRoundHalfUp:
 * non-negative inputs only — rates never enter the engine negative
 * (negative adjustments are computed inside consumers, not typed here).
 */
export function bpsToPercentString(bps: bigint): string {
  const whole = bps / 100n;
  const frac = bps % 100n;
  if (frac === 0n) return whole.toString();
  let fracText = frac.toString().padStart(2, '0');
  while (fracText.endsWith('0') && fracText.length > 1) {
    fracText = fracText.slice(0, -1);
  }
  return `${whole}.${fracText}`;
}
