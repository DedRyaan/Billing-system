import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CURRENT_SLABS_BPS,
  STATE_CODES,
  computeLine,
  derivePlaceOfSupply,
  divRoundHalfUp,
  roundOffPaise,
} from '../src/index';

/**
 * Property-based supplement to the golden matrices (RESEARCH Validation
 * Architecture; fast-check is a dev-only dependency — never a runtime
 * import, enforced by the hygiene suite). Bounds are fixed per the threat
 * register (T-2-13): BigInt cannot overflow and runtime callers own
 * realistic-range enforcement at zod boundaries.
 */

const ALL_CODES: readonly string[] = STATE_CODES.map((e) => e.code);

describe('property: inclusive extraction reconciles for every gross x slab (D-58)', () => {
  const grossArb = fc.bigInt({ min: 0n, max: 10_000_000n }); // Rs 0 .. Rs 1,00,000

  it('taxable + tax === gross across all seven slabs', () => {
    const prop = fc.property(
      grossArb,
      fc.constantFrom(...CURRENT_SLABS_BPS),
      (gross, rateBps) => {
        const result = computeLine(
          {
            qtyMilli: 1000n,
            unitPricePaise: gross,
            discountBps: 0n,
            pricingMode: 'inclusive',
            gstRateBps: rateBps,
            character: 'taxable',
          },
          { head: 'CGST_SGST' },
        );
        if (!result.ok) throw new Error(`unexpected rejection at rate ${rateBps}`);
        return result.taxablePaise + result.taxPaise === gross;
      },
    );
    fc.assert(prop);
  });
});

describe('property: divRoundHalfUp is the half-up division law', () => {
  const nArb = fc.bigInt({ min: 0n, max: 10n ** 18n });
  const dArb = fc.bigInt({ min: 1n, max: 10n ** 9n });

  it('result equals q+1 when remainder x2 >= divisor, else q (randomized operands)', () => {
    const prop = fc.property(nArb, dArb, (n, d) => {
      const q = n / d;
      const rem = n % d;
      const expected = rem * 2n >= d ? q + 1n : q;
      return divRoundHalfUp(n, d) === expected;
    });
    fc.assert(prop);
  });

  it('closeness: n - d < result*d <= n + d always', () => {
    const prop = fc.property(nArb, dArb, (n, d) => {
      const r = divRoundHalfUp(n, d);
      return r * d > n - d && r * d <= n + d;
    });
    fc.assert(prop);
  });

  it('exact halves ALWAYS round up (tie rule), even divisor constructed', () => {
    const prop = fc.property(
      fc.bigInt({ min: 0n, max: 10n ** 12n }),
      fc.bigInt({ min: 1n, max: 10n ** 6n }).map((d) => d * 2n),
      (q, d) => {
        // n sits exactly on the q+0.5 midpoint of divisor d.
        const n = q * d + d / 2n;
        return divRoundHalfUp(n, d) === q + 1n;
      },
    );
    fc.assert(prop);
  });
});

describe('property: signed round-off stays within [-49, +50] paise (D-56)', () => {
  it('across random raw totals up to Rs 10 crore scale', () => {
    const prop = fc.property(fc.bigInt({ min: 0n, max: 10n ** 10n }), (totalPaise) => {
      const off = roundOffPaise(totalPaise);
      return off >= -49n && off <= 50n;
    });
    fc.assert(prop);
  });
});

describe('property: derivePlaceOfSupply totality under random pairs incl. SEZ flips', () => {
  it('every random supplier x POS x sez combination returns a lawful result', () => {
    const prop = fc.property(
      fc.constantFrom(...ALL_CODES),
      fc.constantFrom(...ALL_CODES),
      fc.boolean(),
      // goods_movement: ship-to is the governing slot, so the pair oracle
      // below holds for every pairing. Services resolve via their own chain
      // (perf-location -> bill-to -> registered -> supplier) and are covered
      // by their targeted goldens.
      (supplier, pos, sez) => {
        const result = derivePlaceOfSupply({
          supplierStateCode: supplier,
          kind: 'goods_movement',
          shipToStateCode: pos,
          sez,
        });
        if (!result.ok) return false;
        if (supplier === pos && !sez) {
          if (result.supplyType !== 'intra_state') return false;
          if (result.head === 'IGST') return false;
          // Independent naming oracle (deliberate duplication of the A2
          // split, incl. legacy UT '25'): non-legislature UTs + OT -> UTGST.
          const utgstCodes = new Set(['04', '25', '26', '31', '35', '38', '97']);
          const expectedSecond = utgstCodes.has(pos) ? 'UTGST' : 'SGST';
          return result.secondHeadName === expectedSecond;
        }
        return result.supplyType === 'inter_state' && result.head === 'IGST';
      },
    );
    fc.assert(prop);
  });
});
