import { describe, expect, it } from 'vitest';

import {
  CURRENT_SLABS_BPS,
  SLAB_EFFECTIVE_FROM,
  bpsToPercentString,
  isLegalSlabRate,
  percentStringToBps,
} from '../src/rates';

/**
 * Legal-slab gate golden matrix (D-50 amended / D-52 / D-53).
 *
 * Current law set per CBIC Notfn 9/2025-IT(Rate), effective 2025-09-22:
 * nil/exempt · 0.25% · 1.5% · 3% · 5% · 18% · 40% — expressed in basis
 * points {0, 25, 150, 300, 500, 1800, 4000}. The abolished 12%/28% slabs
 * reject despite having been legal before the amendment: the engine carries
 * NO historical bands (D-53) — snapshots are frozen data.
 */
describe('isLegalSlabRate — current slab set passes', () => {
  it.each([
    ['nil/exempt', 0n],
    ['0.25%', 25n],
    ['1.5%', 150n],
    ['3%', 300n],
    ['5%', 500n],
    ['18%', 1800n],
    ['40%', 4000n],
  ])('%s (%s bps) is a legal catalog rate', (_label, bps) => {
    expect(isLegalSlabRate(bps)).toEqual({ ok: true });
  });
});

describe('abolished and never-a-slab values reject with NOT_A_CURRENT_SLAB', () => {
  it.each([
    ['12% — abolished 22-Sep-2025', 1200n],
    ['28% — abolished 22-Sep-2025', 2800n],
    ['1.8% — D-52 own example, never a slab', 180n],
    ['24 bps — below the 0.25% slab', 24n],
    ['26 bps — above the 0.25% slab', 26n],
  ])('%s rejects', (_label, bps) => {
    expect(isLegalSlabRate(bps)).toEqual({ ok: false, reason: 'NOT_A_CURRENT_SLAB' });
  });
});

describe('slab table shape — dated typed constant, stateless about history (D-53)', () => {
  it('holds exactly seven members with the exact current-law values', () => {
    expect(CURRENT_SLABS_BPS).toHaveLength(7);
    expect([...CURRENT_SLABS_BPS]).toEqual([0n, 25n, 150n, 300n, 500n, 1800n, 4000n]);
  });

  it('exposes the effective-from date as a typed constant', () => {
    expect(SLAB_EFFECTIVE_FROM).toBe('2025-09-22');
  });
});

describe('percentStringToBps — exact string math, money.ts parse discipline', () => {
  it.each([
    ['zero percent', '0', 0n],
    ['0.25%', '0.25', 25n],
    ['1.5%', '1.5', 150n],
    ['3%', '3', 300n],
    ['5%', '5', 500n],
    ['18%', '18', 1800n],
    ['40%', '40', 4000n],
    ['two-decimal non-slab shape parses fine (gate rejects later)', '12.34', 1234n],
    ['single fractional digit', '1.5', 150n],
  ])('%s: %s -> %p bps', (_label, input, expected) => {
    expect(percentStringToBps(input)).toEqual({ ok: true, bps: expected });
  });

  it.each([
    ['empty string', '', 'EMPTY'],
    ['three fractional places — DB column numeric(5,2)', '1.234', 'TOO_MANY_DECIMAL_PLACES'],
    ['plus sign', '+5', 'SIGN_NOT_ALLOWED'],
    ['minus sign', '-5', 'SIGN_NOT_ALLOWED'],
    ['exponent form', '1e3', 'INVALID_CHARACTERS'],
    ['currency glyph', '₹5', 'INVALID_CHARACTERS'],
    ['letters', 'abc', 'INVALID_CHARACTERS'],
    ['dangling leading dot', '.5', 'INVALID_CHARACTERS'],
    ['dangling trailing dot', '5.', 'INVALID_CHARACTERS'],
    ['bare dot', '.', 'INVALID_CHARACTERS'],
  ])('%s -> %s', (_label, input, reason) => {
    const result = percentStringToBps(input);
    // Narrow for the assertion: every rejection carries its exact reason variant.
    if (result.ok) throw new Error(`expected rejection, got ${result.bps}`);
    expect(result.reason).toBe(reason);
  });
});

describe('bpsToPercentString — canonical plain decimal text', () => {
  it.each([
    [0n, '0'],
    [25n, '0.25'],
    [150n, '1.5'],
    [300n, '3'],
    [500n, '5'],
    [1800n, '18'],
    [4000n, '40'],
    [5n, '0.05'],
    [10n, '0.1'],
    [1234n, '12.34'],
  ])('%p bps renders as %s', (bps, expected) => {
    expect(bpsToPercentString(bps)).toBe(expected);
  });
});

describe('converters round-trip across the whole current slab set', () => {
  it.each([
    ['0', 0n],
    ['0.25', 25n],
    ['1.5', 150n],
    ['3', 300n],
    ['5', 500n],
    ['18', 1800n],
    ['40', 4000n],
  ])("'%s' survives parse->render->parse identically", (text, bps) => {
    const parsed = percentStringToBps(text);
    if (!parsed.ok) throw new Error(`unexpected rejection: ${parsed.reason}`);
    expect(bpsToPercentString(parsed.bps)).toBe(text);
    expect(percentStringToBps(bpsToPercentString(bps))).toEqual({ ok: true, bps });
  });
});
