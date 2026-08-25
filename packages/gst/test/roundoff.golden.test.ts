import { describe, expect, it } from 'vitest';

import { halfUpToRupee, roundOffPaise } from '../src/money';

/**
 * Total-only round-off golden matrix (D-56): the grand total is the ONLY
 * rounding event on an invoice. roundOffPaise = halfUpToRupee(total) - total,
 * signed, always within [-49, +50] paise for non-negative totals.
 */
describe('round-off — D-56 signed adjustment matrix', () => {
  it.each([
    // [caseId, rawTotalPaise, expectedAdjustment]
    ['research vector ₹8,442.79', 844279n, 21n],
    ['minimum adjustment: 49p past a rupee', 10000n + 49n, -49n],
    ['maximum adjustment: exact midpoint', 10000n + 50n, 50n],
    ['one paise into a rupee rounds down by 1p', 500n + 1n, -1n],
    ['99p into a rupee rounds up by 1p', 500n + 99n, 1n],
    ['whole rupee total needs nothing', 250000n, 0n],
    ['zero total', 0n, 0n],
  ])('%s -> %+d paise', (_id, total, expected) => {
    expect(roundOffPaise(total)).toBe(expected);
    expect(halfUpToRupee(total)).toBe(total + expected);
  });

  it('exhaustive residue sweep: every paisa residue of representative rupee totals lands in [-49, +50]', () => {
    const rupeeBases = [1n, 2n, 17n, 9999n, 8442n, 123456789n];
    for (const base of rupeeBases) {
      for (let r = 0n; r < 100n; r += 1n) {
        const total = base * 100n + r;
        const adj = roundOffPaise(total);
        expect(adj >= -49n && adj <= 50n).toBe(true);
        expect((total + adj) % 100n).toBe(0n);
        // Half-up direction check: below-midpoint residues round down,
        // at-or-above-midpoint residues round up.
        if (r <= 49n) expect(adj).toBe(-r);
        else expect(adj).toBe(100n - r);
      }
    }
  });

  it('rounding direction follows CGST s.170: <50p down, >=50p up', () => {
    expect(roundOffPaise(149n)).toBe(-49n); // 1.49 -> 1.00
    expect(roundOffPaise(150n)).toBe(50n); // 1.50 -> 2.00
    expect(roundOffPaise(151n)).toBe(49n); // 1.51 -> 2.00
  });
});
