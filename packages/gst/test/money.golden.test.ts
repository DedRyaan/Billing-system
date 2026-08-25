import { describe, expect, it } from 'vitest';

import {
  divRoundHalfUp,
  halfUpToRupee,
  lineBasePaise,
  parseDecimalToPaise,
  roundOffPaise,
  serializePaise,
  sumPaise,
} from '../src/money';

/**
 * Seed golden rows (RESEARCH § Code Examples) — the thinnest proof that
 * scaffold, source and golden harness cooperate. Task 2 expands the matrix.
 */
describe('money core — seed golden rows', () => {
  it('lineBasePaise: qty 2.500 @ ₹199.99 -> ₹499.98 exact', () => {
    // 2500 milli-units x 19999 paise = 49_997_500; /1000 = 49_997.5 -> half-up.
    expect(lineBasePaise(2500n, 19999n)).toBe(49998n);
  });

  it('roundOffPaise: raw total ₹8,442.79 -> +21p signed adjustment', () => {
    expect(roundOffPaise(844279n)).toBe(21n);
    expect(halfUpToRupee(844279n)).toBe(844300n);
  });

  it('parse round-trip: \'19.99\' -> 1999 paise exact', () => {
    const parsed = parseDecimalToPaise('19.99');
    expect(parsed).toEqual({ ok: true, paise: 1999n });
  });

  it('serialize renders canonical NUMERIC(14,2) text', () => {
    expect(serializePaise(1999n)).toBe('19.99');
    expect(serializePaise(-1234n)).toBe('-12.34');
    expect(serializePaise(5n)).toBe('0.05');
    expect(serializePaise(0n)).toBe('0.00');
  });

  it('sumPaise adds exactly', () => {
    expect(sumPaise([100n, 250n, 25n])).toBe(375n);
    expect(sumPaise([])).toBe(0n);
  });

  it('divRoundHalfUp: exact division is untouched', () => {
    expect(divRoundHalfUp(500n, 100n)).toBe(5n);
  });
});
