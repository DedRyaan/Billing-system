/**
 * GSTIN structural + mod-36 checksum validation (MSTR-02).
 *
 * Format AND state-code membership AND checksum are enforced with
 * independent reason codes (RESEARCH Pitfall 7 — regex-only validation lets
 * checksum-dead identifiers survive to filing). Check order makes each
 * class independently reachable:
 *   length -> charset -> state code -> PAN shape -> fixed-Z -> entity char -> checksum
 *
 * Checksum algorithm (RESEARCH § Pattern 4, hand-verified against two real
 * vectors this phase): charset '0123456789A…Z' -> 0–35; over the first 14
 * chars products use alternating factors ×1,×2 starting ×1 at the leftmost;
 * each product contributes its base-36 digit sum; check value is
 * (36 − (sum % 36)) % 36 mapped back through the charset against position 15.
 *
 * Input contract: strict uppercase GSTIN text — NO normalization or
 * lowercasing happens here (a lowercase letter is a rejection reason,
 * not something to silently repair). Results are discriminated unions;
 * the module exports no boolean-returning alias.
 */

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type GstinFailReason =
  | 'WRONG_LENGTH'
  | 'INVALID_CHARACTERS'
  | 'UNKNOWN_STATE_CODE'
  | 'BAD_PAN_SHAPE'
  | 'ENTITY_CHAR_INVALID'
  | 'DEFAULT_Z_MISSING'
  | 'CHECKSUM_FAILED';

export type GstinResult =
  | { ok: true; stateCode: string; pan: string }
  | { ok: false; reason: GstinFailReason };

/**
 * State/UT code universe: '01'..'38' plus '97' (Other Territory) per
 * RESEARCH Assumption A1. Membership predicate embedded locally to avoid a
 * cross-plan file dependency on state-codes.ts — the full named table with
 * legislature metadata lands in plan 02-03 and owns naming/names; this
 * module only needs the membership fact for MSTR-02 gating.
 */
function isValidStateCode(code: string): boolean {
  if (!/^[0-9]{2}$/.test(code)) return false;
  const n = Number(code); // exact integer conversion of exactly two digits
  return (n >= 1 && n <= 38) || n === 97;
}

function charsetValue(ch: string): number {
  return CHARSET.indexOf(ch);
}

function isUpperLetter(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}

function isDigitChar(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/** Base-36 digit sum of one product without float builtins: q + r where p = 36q + r. */
function base36DigitSum(product: number): number {
  const remainder = product % 36;
  return (product - remainder) / 36 + remainder;
}

function computeCheckChar(firstFourteen: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = charsetValue(firstFourteen.charAt(i));
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += base36DigitSum(product);
  }
  const checkValue = (36 - (sum % 36)) % 36;
  return CHARSET.charAt(checkValue);
}

export function validateGstin(input: string): GstinResult {
  if (input.length !== 15) return { ok: false, reason: 'WRONG_LENGTH' };

  // Generic charset scan: every position must be an uppercase alphanumeric
  // EXCEPT the entity char (position 12), which has its own reason class so
  // entity-level corruption stays distinguishable from generic garbage.
  for (let i = 0; i < input.length; i++) {
    if (i === 12) continue;
    if (charsetValue(input.charAt(i)) < 0) {
      return { ok: false, reason: 'INVALID_CHARACTERS' };
    }
  }

  const stateCode = input.slice(0, 2);
  if (!isValidStateCode(stateCode)) {
    return { ok: false, reason: 'UNKNOWN_STATE_CODE' };
  }

  // PAN block positions 2..11: five letters, four digits, holder-type letter.
  // Violations beyond the generic charset rule (right case, wrong class) get
  // their own reason.
  for (let i = 2; i <= 6; i++) {
    if (!isUpperLetter(input.charAt(i))) return { ok: false, reason: 'BAD_PAN_SHAPE' };
  }
  for (let i = 7; i <= 10; i++) {
    if (!isDigitChar(input.charAt(i))) return { ok: false, reason: 'BAD_PAN_SHAPE' };
  }
  if (!isUpperLetter(input.charAt(11))) return { ok: false, reason: 'BAD_PAN_SHAPE' };

  if (input.charAt(13) !== 'Z') return { ok: false, reason: 'DEFAULT_Z_MISSING' };
  if (charsetValue(input.charAt(12)) < 0) {
    return { ok: false, reason: 'ENTITY_CHAR_INVALID' };
  }

  const expected = computeCheckChar(input.slice(0, 14));
  if (input.charAt(14) !== expected) {
    return { ok: false, reason: 'CHECKSUM_FAILED' };
  }

  return { ok: true, stateCode, pan: input.slice(2, 12) };
}
