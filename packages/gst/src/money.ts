/**
 * Integer-paise money core (D-55/D-56/D-57).
 *
 * Every monetary value in the engine is an integer number of paise carried in
 * a BigInt. Quantities with up to 3 decimals arrive pre-scaled to milli-units
 * (1.250 -> 1250n). The ONLY rounding operation permitted anywhere in the
 * engine is `divRoundHalfUp` below — one half-up integer division helper.
 * No float ever enters this module: callers pass integers or exact decimal
 * strings parsed via `parseDecimalToPaise` (RESEARCH § Pattern 1, Pitfall 1).
 */

/**
 * Half-up division of non-negative BigInts — the engine's single rounding
 * authority (D-55).
 *
 * Contract: both operands MUST be non-negative (`n >= 0n && d > 0n`). The
 * result is floor((2n + d) / 2d): exact when d divides n, otherwise the
 * smallest integer >= n/d whenever the remainder is at least half the
 * divisor. Negative operands are a caller bug and are NOT supported — the
 * formula's half-up direction is only defined for non-negative operands.
 */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (d * 2n);
}

/**
 * Line base amount in paise from a milli-unit quantity and a paise unit
 * price (D-57). Exact whenever qtyMilli is a multiple of 1000; sub-paisa
 * residue from true fractional quantities resolves by the one half-up rule.
 */
export function lineBasePaise(qtyMilli: bigint, pricePaise: bigint): bigint {
  return divRoundHalfUp(qtyMilli * pricePaise, 1000n);
}

/** Exact sum of paise values. */
export function sumPaise(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/**
 * Total rounded to whole rupees, half-up (CGST s.170 convention).
 * Always a multiple of 100 paise.
 */
export function halfUpToRupee(totalPaise: bigint): bigint {
  return divRoundHalfUp(totalPaise, 100n) * 100n;
}

/**
 * Signed round-off adjustment for the invoice grand total (D-56):
 * rounded rupee total minus raw paise total. Range -49..+50 for any
 * non-negative raw total. This is the ONLY rounding event on an invoice —
 * line taxable values and per-line taxes stay exact.
 */
export function roundOffPaise(totalPaise: bigint): bigint {
  return halfUpToRupee(totalPaise) - totalPaise;
}

export type ParseFailReason =
  | 'EMPTY'
  | 'INVALID_CHARACTERS'
  | 'TOO_MANY_DECIMAL_PLACES'
  | 'SIGN_NOT_ALLOWED';

export type ParseResult =
  | { ok: true; paise: bigint }
  | { ok: false; reason: ParseFailReason };

/**
 * Shared strict decimal-string scanner behind BOTH boundary parsers — paise
 * here, basis points in rates.ts. A rupee amount and a percent with at most
 * two fractional places are the same textual shape, so one accept/reject
 * policy serves both and parser-policy changes can never desync the boundary
 * contracts.
 *
 * Accepts ONLY plain digit strings with an optional single dot and at most
 * two fractional places ('0', '19.9', '19.99'). No sign, no exponent form,
 * no whitespace, no currency glyphs — anything else is rejected with a typed
 * reason so callers never smuggle float-typed or malformed values into the
 * exact core (RESEARCH Pitfall 1). String math only; the binary-float
 * parsing builtin named in that pitfall appears nowhere in src.
 *
 * Returns the value scaled to integer HUNDREDTHS ('19.99' -> 1999n):
 * paise are hundredths of a rupee and basis points are hundredths of a
 * percent, so each consumer maps the result directly with no further scaling.
 */
export function parseDecimalHundredths(
  s: string,
): { ok: true; hundredths: bigint } | { ok: false; reason: ParseFailReason } {
  if (s.length === 0) return { ok: false, reason: 'EMPTY' };

  // Sign characters anywhere are refused outright — money crosses the
  // boundary as unsigned magnitude strings (negative adjustments are
  // computed inside the engine, not typed by users).
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
  return { ok: true, hundredths: BigInt(intPart) * 100n + hundredths };
}

/**
 * Strict decimal-string -> paise parser at the engine boundary. Delegates to
 * the shared scanner (`parseDecimalHundredths`); paise ARE the hundredths.
 */
export function parseDecimalToPaise(s: string): ParseResult {
  const parsed = parseDecimalHundredths(s);
  return parsed.ok ? { ok: true, paise: parsed.hundredths } : parsed;
}

function isAllDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (const ch of s) {
    if (ch < '0' || ch > '9') return false;
  }
  return true;
}

/**
 * Canonical plain-decimal text rendering of paise for NUMERIC(14,2) column
 * payloads: '-12.34', '0.00', '19.99'. Inverse of `parseDecimalToPaise` —
 * parse(serialize(p)) === p for every bigint p.
 */
export function serializePaise(paise: bigint): string {
  const sign = paise < 0n ? '-' : '';
  const abs = paise < 0n ? -paise : paise;
  const rupees = abs / 100n;
  const paisa = abs % 100n;
  const paisaText = paisa.toString().padStart(2, '0');
  return `${sign}${rupees}.${paisaText}`;
}
