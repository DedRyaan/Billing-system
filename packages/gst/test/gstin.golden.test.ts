import { describe, expect, it } from 'vitest';

import * as gstin from '../src/gstin';
import { validateGstin } from '../src/gstin';

/**
 * Canonical structural shape as a TEST FIXTURE (not a src export): the
 * validator deliberately performs manual char-class checks so every
 * corruption class gets its own reason code, and regex-only validation lets
 * checksum-dead identifiers survive (RESEARCH Pitfall 7). This independent
 * encoding of the documented shape stays aligned with actual acceptance via
 * the rows below — not by sharing runtime code with the validator.
 */
const CANONICAL_GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/**
 * GSTIN structural + mod-36 checksum golden matrix (MSTR-02).
 *
 * Real-vector provenance: '27AAPFU0939F1ZV' (sum 221 -> charset[31] = 'V')
 * and '33AAACC1206D1ZN' (sum 157 -> charset[23] = 'N') were hand-computed
 * during research (RESEARCH § Pattern 4) against published real-GSTIN
 * vectors; the alternating-factor scheme (×1,×2,… starting ×1 at the
 * leftmost) is the one that reproduces both.
 *
 * One corrupted row per rejection class — each reason fires from a dedicated
 * row so no class is masked by an earlier check.
 */

describe('validateGstin — real research-verified vectors pass', () => {
  it.each([
    ['Maharashtra vector', '27AAPFU0939F1ZV', '27', 'AAPFU0939F'],
    ['Karnataka/Puducherry-region vector', '33AAACC1206D1ZN', '33', 'AAACC1206D'],
  ])('%s accepts with extracted state + PAN', (_label, input, stateCode, pan) => {
    expect(validateGstin(input)).toEqual({ ok: true, stateCode, pan });
  });

  it('checksum recomputation reproduces the published final characters V and N', () => {
    // validateGstin returning ok proves the recomputed check character equals
    // position 15 ('V' / 'N') — the algorithm below would CHECKSUM_FAILED on
    // any other final char for these first-14 prefixes.
    expect(validateGstin('27AAPFU0939F1ZV')).toMatchObject({ ok: true });
    expect(validateGstin('33AAACC1206D1ZN')).toMatchObject({ ok: true });
  });

  it('Other Territory code 97 is inside the valid state universe', () => {
    // 97 = Other Territory (A1). Final char recomputed for this prefix:
    // replacing '2' with '9' shifts sum 221 -> 228 -> charset[24] = 'O'.
    expect(validateGstin('97AAPFU0939F1ZO')).toEqual({
      ok: true,
      stateCode: '97',
      pan: 'AAPFU0939F',
    });
  });
});

describe('validateGstin — one corrupted row per rejection class', () => {
  it.each([
    ['14 chars (dropped final char)', '27AAPFU0939F1Z', 'WRONG_LENGTH'],
    ['16 chars (appended digit)', '27AAPFU0939F1ZVX', 'WRONG_LENGTH'],
    ['lowercase letter in PAN block', '27aAPFU0939F1ZV', 'INVALID_CHARACTERS'],
    ['symbol in state digits', '27$APFU0939F1ZV', 'INVALID_CHARACTERS'],
    ['state code 00 outside universe', '00AAPFU0939F1ZV', 'UNKNOWN_STATE_CODE'],
    ['state code 39 outside universe', '39AAPFU0939F1ZO', 'UNKNOWN_STATE_CODE'],
    ['digit where PAN letter expected (pos 2)', '271APFU0939F1ZV', 'BAD_PAN_SHAPE'],
    ['letter where PAN digit expected (pos 7)', '27AAPFUA939F1ZV', 'BAD_PAN_SHAPE'],
    ['digit where PAN 4th-check letter expected (pos 11)', '27AAPFU093951ZV', 'BAD_PAN_SHAPE'],
    ['position 14 is not the fixed literal Z', '27AAPFU0939F1AV', 'DEFAULT_Z_MISSING'],
    ['entity char is a symbol', '27AAPFU0939F#ZV', 'ENTITY_CHAR_INVALID'],
    ['entity char is lowercase', '27AAPFU0939FgZV', 'ENTITY_CHAR_INVALID'],
    ['valid shape, dead checksum (V->W)', '27AAPFU0939F1ZW', 'CHECKSUM_FAILED'],
    ['valid shape, dead checksum (N->M)', '33AAACC1206D1ZM', 'CHECKSUM_FAILED'],
  ])('%s -> %s', (_label, input, reason) => {
    const result = validateGstin(input);
    if (result.ok) throw new Error(`expected ${reason}, got ok with pan ${result.pan}`);
    expect(result.reason).toBe(reason);
  });

  it('charset runs before state-code membership (ordering sanity)', () => {
    // Lowercase state digits are a charset failure even though 'a7' is also
    // not a member of the universe — length -> charset -> state -> ...
    const result = validateGstin('a7AAPFU0939F1ZV');
    if (result.ok) throw new Error('expected rejection');
    expect(result.reason).toBe('INVALID_CHARACTERS');
  });
});

describe('canonical GSTIN shape fixture — documents the accepted structure', () => {
  it('fixture matches exactly the inputs the validator accepts', () => {
    expect(CANONICAL_GSTIN_SHAPE.test('27AAPFU0939F1ZV')).toBe(true);
    expect(CANONICAL_GSTIN_SHAPE.test('33AAACC1206D1ZN')).toBe(true);
    expect(CANONICAL_GSTIN_SHAPE.test('97AAPFU0939F1ZO')).toBe(true);
    expect(CANONICAL_GSTIN_SHAPE.test('27AAPFU0939F1Z')).toBe(false); // short
    expect(CANONICAL_GSTIN_SHAPE.test('27aAPFU0939F1ZV')).toBe(false); // lowercase
  });

  it('shape-valid text can still be law-dead — why regex-only validation is rejected (Pitfall 7)', () => {
    // '00AAPFU0939F1ZV' matches the canonical shape but carries a state code
    // outside the universe; the validator's fine-grained checks catch it.
    expect(CANONICAL_GSTIN_SHAPE.test('00AAPFU0939F1ZV')).toBe(true);
    expect(validateGstin('00AAPFU0939F1ZV')).toEqual({
      ok: false,
      reason: 'UNKNOWN_STATE_CODE',
    });
  });
});

describe('exported surface — unions only, never boolean predicates', () => {
  it('exports exactly the union-returning validator', () => {
    expect(Object.keys(gstin).sort()).toEqual(['validateGstin']);
    const result = validateGstin('27AAPFU0939F1ZV');
    expect(typeof result).toBe('object');
    expect(result).toHaveProperty('ok');
  });
});
