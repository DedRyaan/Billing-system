/**
 * HSN/SAC structure validation + soft turnover digit-depth warning (D-63).
 *
 * The hard validator is STRICTLY structural: digit sets and legal lengths
 * (HSN 4/6/8; SAC 6-digit with the '99' services prefix). Semantic
 * code-master membership is deliberately out of scope — the code master
 * changes via CBIC notifications and GSTN/IRP validates semantics
 * downstream (RESEARCH Don't-Hand-Roll row 3).
 *
 * The turnover rule is a SOFT warning fed by business config: its output
 * feeds UI hints ONLY. Nothing exported from this module can hard-reject a
 * line on digit depth — the moving-threshold problem D-63 fences against.
 */

export type HsnSacKind = 'hsn' | 'sac';

export type HsnSacFailReason =
  | 'EMPTY'
  | 'NON_DIGIT_CHARS'
  | 'BAD_HSN_LENGTH'
  | 'BAD_SAC_LENGTH'
  | 'SAC_PREFIX_INVALID';

export type HsnSacResult =
  | { ok: true; kind: HsnSacKind; length: number }
  | { ok: false; reason: HsnSacFailReason };

const HSN_LEGAL_LENGTHS: readonly number[] = [4, 6, 8];

function isAllDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (const ch of s) {
    if (ch < '0' || ch > '9') return false;
  }
  return true;
}

function validateAsHsn(code: string): HsnSacResult {
  if (!isAllDigits(code)) return { ok: false, reason: 'NON_DIGIT_CHARS' };
  if (!HSN_LEGAL_LENGTHS.includes(code.length)) {
    return { ok: false, reason: 'BAD_HSN_LENGTH' };
  }
  return { ok: true, kind: 'hsn', length: code.length };
}

function validateAsSac(code: string): HsnSacResult {
  if (!isAllDigits(code)) return { ok: false, reason: 'NON_DIGIT_CHARS' };
  if (code.length !== 6) return { ok: false, reason: 'BAD_SAC_LENGTH' };
  if (!code.startsWith('99')) return { ok: false, reason: 'SAC_PREFIX_INVALID' };
  return { ok: true, kind: 'sac', length: 6 };
}

/**
 * Validate an item code structurally.
 *
 * kind:'auto' infers the branch: exactly six digits starting '99' are
 * SAC-shaped; everything else runs the HSN rules — and the ok result always
 * reports which branch decided. An explicit kind overrides inference in
 * either direction.
 */
export function validateHsnSac(
  code: string,
  opts?: { kind?: 'hsn' | 'sac' | 'auto' },
): HsnSacResult {
  if (code.length === 0) return { ok: false, reason: 'EMPTY' };
  const kind = opts?.kind ?? 'auto';
  if (kind === 'sac') return validateAsSac(code);
  const sacShaped =
    kind === 'auto' && code.length === 6 && code.startsWith('99') && isAllDigits(code);
  if (sacShaped) return validateAsSac(code);
  return validateAsHsn(code);
}

/**
 * AATO disclosure threshold in whole rupees: Rs 5 crore
 * (= Notfn 78/2020-CT Table-12 mapping in RESEARCH State of the Art).
 * At or below -> 4-digit HSN sufficient; above -> 6-digit; export lines
 * expect 8-digit regardless.
 */
export const TURNOVER_DIGIT_THRESHOLD_RUPEES = 50_000_000n;

export interface TurnoverDigitConfig {
  /** Annual aggregate turnover in whole RUPEES (not paise). */
  aatoRupees: bigint;
  /** True when the line is an export of services/goods outside India. */
  isExportLine?: boolean;
}

export type TurnoverDigitWarning =
  | { level: 'ok'; requiredDigits: 4; message: string }
  | { level: 'warn'; requiredDigits: 6 | 8; message: string };

/**
 * Advisory digit-depth requirement for UI hints ONLY (D-63 soft fence).
 *
 * level 'warn' means the config triggers elevated disclosure requirements
 * (potential shortfall territory for shallow codes); 'ok' is the baseline.
 * The result never gates anything: callers render `message`, and the hard
 * validator above stays purely structural.
 */
export function turnoverDigitWarning(config: TurnoverDigitConfig): TurnoverDigitWarning {
  if (config.isExportLine === true) {
    return {
      level: 'warn',
      requiredDigits: 8,
      message: 'Export lines require 8-digit HSN classification (Table-12, Notfn 78/2020-CT).',
    };
  }
  if (config.aatoRupees > TURNOVER_DIGIT_THRESHOLD_RUPEES) {
    return {
      level: 'warn',
      requiredDigits: 6,
      message: 'AATO above Rs 5 crore: 6-digit HSN disclosure required.',
    };
  }
  return {
    level: 'ok',
    requiredDigits: 4,
    message: 'AATO up to Rs 5 crore: 4-digit HSN sufficient.',
  };
}
