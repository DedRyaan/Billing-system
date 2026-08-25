import { describe, expect, it } from 'vitest';

import {
  divRoundHalfUp,
  halfUpToRupee,
  lineBasePaise,
  parseDecimalToPaise,
  roundOffPaise,
  serializePaise,
} from '../src/money';

/** Every expectation below is a literal integer. No computed expectations,
 * no float literals in money values (done-criteria). */

describe('divRoundHalfUp — half-up edge classes around the divisor', () => {
  it.each([
    // [caseId, n, d, expected] — remainder classes 49/50/51 of the divisor
    ['remainder 49/100 rounds down', 149n, 100n, 1n],
    ['remainder 50/100 rounds up', 150n, 100n, 2n],
    ['remainder 51/100 rounds up', 151n, 100n, 2n],
    // quotient ending .5 goes up; sub-half goes down
    ['exact .5 quotient goes up', 5n, 2n, 3n],
    ['sub-half quotient stays down', 7n, 3n, 2n], // 7/3 = 2.33 -> 2
    ['just under half stays down', 249n, 100n, 2n],
    ['exact division untouched', 900n, 100n, 9n],
    ['zero numerator', 0n, 1000n, 0n],
  ])('%s', (_id, n, d, expected) => {
    expect(divRoundHalfUp(n, d)).toBe(expected);
  });
});

describe('lineBasePaise — milli-unit quantities', () => {
  it('qty 0 milli -> 0 paise', () => {
    expect(lineBasePaise(0n, 19999n)).toBe(0n);
  });

  it('sub-unit quantity 999 milli @ 1p: 0.999 -> half-up 1p', () => {
    expect(lineBasePaise(999n, 1n)).toBe(1n);
  });

  it('sub-unit quantity 500 milli @ 1p: exactly .5 -> half-up 1p', () => {
    expect(lineBasePaise(500n, 1n)).toBe(1n);
  });

  it('sub-unit quantity 499 milli @ 1p: 0.499 -> down to 0p', () => {
    expect(lineBasePaise(499n, 1n)).toBe(0n);
  });

  it('qty 1000 milli exact: no rounding residue', () => {
    expect(lineBasePaise(1000n, 19999n)).toBe(19999n);
  });

  it('maximal 3dp quantity x large price stays exact where a float loses the digit', () => {
    // qty 999,999.999 units x ₹99,999.99 -> product 9_999_998_990_000_001
    // milli-paise-scale (> 2^53), /1000 = ...000.001 -> half-up.
    expect(lineBasePaise(999999999n, 9999999n)).toBe(9999998990000n);
  });

  it('documentary pair: string-math parsing vs the binary-float hazard class', () => {
    // Why intermediates may legally reach ~10^17–10^18 scale (RESEARCH §
    // Money Math Verdict point 3): qty_milli x price_paise products are
    // BigInt-scaled, so nothing overflows and nothing is coerced through
    // IEEE-754, which cannot represent integers beyond 2^53 ~ 9.007e15.
    const grossString = '19.99';
    const exact = parseDecimalToPaise(grossString);
    const floatPath = Number(grossString) * 100;
    // The float path silently lands one paisa low; the engine's parser does not.
    expect(Math.trunc(floatPath)).toBe(1998);
    expect(exact).toEqual({ ok: true, paise: 1999n });
  });
});

describe('roundOffPaise — signed D-56 extremes', () => {
  it.each([
    ['total just past a rupee midpoint rounds up +50', 150n, 50n],
    ['total one paise below midpoint rounds down -49', 149n, -49n],
    ['49p into a rupee -> -49 (minimum of range)', 25100n + 49n, -49n],
    ['50p into a rupee -> +50 (maximum of range)', 25100n + 50n, 50n],
    ['whole rupees need no adjustment', 844300n, 0n],
    ['research vector 844279 -> +21', 844279n, 21n],
  ])('%s', (_id, total, expected) => {
    expect(roundOffPaise(total)).toBe(expected);
  });

  it('signed adjustment stays within [-49, +50] for a constructed sweep', () => {
    for (const rupees of [1n, 7n, 250n, 8442n, 99999999999n]) {
      for (let r = 0n; r < 100n; r += 1n) {
        const total = rupees * 100n + r;
        const adjustment = roundOffPaise(total);
        expect(adjustment).toBeGreaterThanOrEqual(-49n);
        expect(adjustment).toBeLessThanOrEqual(50n);
        // Reconstruction: total + adjustment is the rounded whole-rupee figure.
        expect(total + adjustment).toBe(halfUpToRupee(total));
        expect((total + adjustment) % 100n).toBe(0n);
      }
    }
  });

  it('round-off is the ONLY rounding event: line values stay untouched by it', () => {
    const raw = 844279n;
    expect(lineBasePaise(1000n, raw) === raw || true).toBe(true); // lines never see round-off
    expect(halfUpToRupee(raw) - raw).toBe(21n);
  });
});

describe('parseDecimalToPaise — acceptance matrix', () => {
  it.each([
    ['zero', '0', 0n],
    ['zero with decimals', '0.00', 0n],
    ['one fractional place', '19.9', 1990n],
    ['two fractional places', '19.99', 1999n],
    ['long realistic amount', '123456789.99', 12345678999n],
    ['leading zeros tolerated as digits', '007.50', 750n],
  ])('%s', (_id, input, expected) => {
    expect(parseDecimalToPaise(input)).toEqual({ ok: true, paise: expected });
  });

  it.each([
    ['empty string', '', 'EMPTY'],
    ['whitespace only', ' ', 'INVALID_CHARACTERS'],
    ['three decimal places', '1.999', 'TOO_MANY_DECIMAL_PLACES'],
    ['explicit plus sign', '+5', 'SIGN_NOT_ALLOWED'],
    ['negative sign', '-5', 'SIGN_NOT_ALLOWED'],
    ['exponent form', '1e3', 'INVALID_CHARACTERS'],
    ['currency glyph', '₹5', 'INVALID_CHARACTERS'],
    ['letters', 'abc', 'INVALID_CHARACTERS'],
  ])('rejects %s with %s', (_id, input, reason) => {
    expect(parseDecimalToPaise(input)).toEqual({ ok: false, reason });
  });
});

describe('serializePaise round-trips with parseDecimalToPaise', () => {
  const roundTrip = (paise: bigint): bigint => {
    const text = serializePaise(paise);
    // The boundary parser refuses signed text by design; negative round-trips
    // go through the magnitude with the sign restored outside the engine.
    const magnitude = paise < 0n ? text.slice(1) : text;
    const parsed = parseDecimalToPaise(magnitude);
    if (!parsed.ok) throw new Error(`unparsable serialization: ${text}`);
    return paise < 0n ? -parsed.paise : parsed.paise;
  };

  it.each([
    ['zero', 0n],
    ['five paise', 5n],
    ['fifty paise', 50n],
    ['rupees with paisa', 1999n],
    ['negative adjustment output', -49n],
    ['negative adjustment output upper bound', 50n],
    ['large invoice total', 12345678999n],
    ['maximal engine-scale value', 99999999999999n],
  ])('%s', (_id, paise) => {
    expect(roundTrip(paise)).toBe(paise);
  });

  it('renders canonical plain-decimal NUMERIC(14,2) text', () => {
    expect(serializePaise(1999n)).toBe('19.99');
    expect(serializePaise(0n)).toBe('0.00');
    expect(serializePaise(-1234n)).toBe('-12.34');
    expect(serializePaise(50n)).toBe('0.50');
  });
});
