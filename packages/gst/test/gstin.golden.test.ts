import { describe, expect, it } from 'vitest';

import * as gstin from '../src/gstin';
import { GSTIN_REGEX, validateGstin } from '../src/gstin';

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

describe('GSTIN_REGEX exported structural constant', () => {
  it('matches the canonical 15-char shape and rejects shorter/longer text', () => {
    expect(GSTIN_REGEX.test('27AAPFU0939F1ZV')).toBe(true);
    expect(GSTIN_REGEX.test('27AAPFU0939F1Z')).toBe(false);
    expect(GSTIN_REGEX.test('27aAPFU0939F1ZV')).toBe(false);
  });
});

describe('exported surface — unions only, never boolean predicates', () => {
  it('exports exactly the regex constant and the union-returning validator', () => {
    expect(Object.keys(gstin).sort()).toEqual(['GSTIN_REGEX', 'validateGstin']);
    const result = validateGstin('27AAPFU0939F1ZV');
    expect(typeof result).toBe('object');
    expect(result).toHaveProperty('ok');
  });
});
