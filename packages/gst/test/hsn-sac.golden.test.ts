import { describe, expect, it } from 'vitest';

import * as hsnSac from '../src/hsn-sac';
import {
  TURNOVER_DIGIT_THRESHOLD_RUPEES,
  turnoverDigitWarning,
  validateHsnSac,
} from '../src/hsn-sac';

/**
 * HSN/SAC structure validation + soft turnover warning (D-63).
 *
 * The hard validator is strictly structural — digit sets and legal lengths
 * only. Semantic code-master membership is out of scope (RESEARCH
 * Don't-Hand-Roll row 3). Turnover digit depth is advisory ONLY: nothing in
 * this module can hard-reject a line for digit depth.
 */
describe('validateHsnSac — HSN structure accepts', () => {
  it.each([
    ['4-digit', '0101'],
    ['6-digit', '010121'],
    ['8-digit', '85423190'],
    ['another 8-digit', '01012100'],
  ])('%s code %s -> ok as hsn', (_label, code) => {
    expect(validateHsnSac(code)).toEqual({ ok: true, kind: 'hsn', length: code.length });
  });
});

describe('validateHsnSac — HSN rejection reasons', () => {
  it.each([
    ['empty string', '', 'EMPTY'],
    ['non-digit characters', '85A0', 'NON_DIGIT_CHARS'],
    ['3 digits (too short)', '101', 'BAD_HSN_LENGTH'],
    ['5 digits (illegal depth)', '01012', 'BAD_HSN_LENGTH'],
    ['7 digits (illegal depth)', '0101210', 'BAD_HSN_LENGTH'],
    ['9 digits (too long)', '854231900', 'BAD_HSN_LENGTH'],
  ])('%s -> %s', (_label, code, reason) => {
    const result = validateHsnSac(code);
    if (result.ok) throw new Error(`expected ${reason}, got kind=${result.kind}`);
    expect(result.reason).toBe(reason);
  });
});

describe('validateHsnSac — SAC rules', () => {
  it('accepts 6-digit codes with the 99 services prefix', () => {
    expect(validateHsnSac('998311')).toEqual({ ok: true, kind: 'sac', length: 6 });
    expect(validateHsnSac('998311', { kind: 'sac' })).toEqual({
      ok: true,
      kind: 'sac',
      length: 6,
    });
  });

  it.each([
    ['wrong length', '99831', 'BAD_SAC_LENGTH'],
    ['7-digit 99-prefixed', '9983110', 'BAD_SAC_LENGTH'],
    ['wrong prefix', '123456', 'SAC_PREFIX_INVALID'],
    ['non-digit characters', '99A311', 'NON_DIGIT_CHARS'],
  ])('%s -> %s under explicit sac kind', (_label, code, reason) => {
    const result = validateHsnSac(code, { kind: 'sac' });
    if (result.ok) throw new Error(`expected ${reason}, got kind=${result.kind}`);
    expect(result.reason).toBe(reason);
  });

  it('explicit kind overrides auto inference both ways', () => {
    // 6 digits starting 99 would infer SAC in auto; explicit 'hsn' forces the
    // HSN branch where 6 digits are legal HSN depth.
    expect(validateHsnSac('998311', { kind: 'hsn' })).toEqual({
      ok: true,
      kind: 'hsn',
      length: 6,
    });
    // Non-99 6-digit code infers hsn in auto; explicit 'sac' rejects prefix.
    const forced = validateHsnSac('010121', { kind: 'sac' });
    if (forced.ok) throw new Error('expected SAC_PREFIX_INVALID');
    expect(forced.reason).toBe('SAC_PREFIX_INVALID');
  });
});

describe("validateHsnSac — kind:'auto' inference reports which branch decided", () => {
  it.each([
    ['services-prefix 6-digit infers SAC', '998311', 'sac'],
    ['goods-shaped 8-digit infers HSN', '85423190', 'hsn'],
    ['non-99 6-digit infers HSN', '010121', 'hsn'],
    ['4-digit infers HSN', '0101', 'hsn'],
  ])('%s', (_label, code, kind) => {
    const result = validateHsnSac(code, { kind: 'auto' });
    if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
    expect(result.kind).toBe(kind);
  });
});

describe('turnoverDigitWarning — Rs5cr boundary and exports (Notfn 78/2020-CT)', () => {
  it('exposes the threshold constant at exactly 50_000_000 rupees', () => {
    expect(TURNOVER_DIGIT_THRESHOLD_RUPEES).toBe(50_000_000n);
  });

  it.each([
    ['AATO at boundary stays 4-digit / ok', 50_000_000n, false, 'ok', 4],
    ['zero AATO is baseline ok', 0n, false, 'ok', 4],
    ['AATO one rupee above boundary needs 6 / warn', 50_000_001n, false, 'warn', 6],
    ['far above boundary keeps warning level', 250_000_000n, false, 'warn', 6],
  ])('%s', (_label, aatoRupees, isExportLine, level, requiredDigits) => {
    const result = turnoverDigitWarning({ aatoRupees, isExportLine });
    expect(result.level).toBe(level);
    expect(result.requiredDigits).toBe(requiredDigits);
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('export lines expect 8 digits regardless of AATO', () => {
    const small = turnoverDigitWarning({ aatoRupees: 0n, isExportLine: true });
    expect(small).toMatchObject({ level: 'warn', requiredDigits: 8 });
    const large = turnoverDigitWarning({ aatoRupees: 100_000_000n, isExportLine: true });
    expect(large).toMatchObject({ level: 'warn', requiredDigits: 8 });
  });
});

describe('D-63 soft-rule fence — warnings can never hard-reject', () => {
  it('a digit-depth "shortfall" config warns while the validator still accepts the shallow code', () => {
    // Business above Rs5cr should disclose 6 digits; '0101' is only 4. The
    // warning fires — but validateHsnSac remains purely structural and
    // returns ok. Nothing exported from this module can block the line.
    const warning = turnoverDigitWarning({ aatoRupees: 60_000_000n });
    expect(warning.level).toBe('warn');
    expect(validateHsnSac('0101')).toEqual({ ok: true, kind: 'hsn', length: 4 });
  });

  it('exports no API beyond the validator, the advisory fn, and the constant', () => {
    expect(Object.keys(hsnSac).sort()).toEqual([
      'TURNOVER_DIGIT_THRESHOLD_RUPEES',
      'turnoverDigitWarning',
      'validateHsnSac',
    ]);
  });
});
