import { describe, expect, it } from 'vitest';

import { deriveFinancialYear } from '../src/financial-year';

/**
 * IST calendar-date FY derivation edges (SC-4 support). The engine never
 * touches the system clock, timezone APIs or the platform Date object —
 * inputs are structured calendar dates or strict 'YYYY-MM-DD' strings.
 */
describe('deriveFinancialYear — the two SC-4 crossings', () => {
  it.each([
    ['last day of FY', { year: 2026, month: 3, day: 31 }, '25-26'],
    ['first day of next FY', { year: 2026, month: 4, day: 1 }, '26-27'],
  ])('%s', (_id, input, expected) => {
    expect(deriveFinancialYear(input)).toEqual({ ok: true, fy: expected });
  });
});

describe('deriveFinancialYear — Dec/Jan sanity stays within one FY per side', () => {
  it.each([
    ['Dec 31 belongs to the running FY', { year: 2026, month: 12, day: 31 }, '26-27'],
    ['Jan 1 opens the new FY', { year: 2027, month: 1, day: 1 }, '26-27'],
    ['mid-March still previous-label FY', { year: 2025, month: 3, day: 15 }, '24-25'],
    ['mid-April carries current-year label', { year: 2025, month: 4, day: 15 }, '25-26'],
  ])('%s', (_id, input, expected) => {
    expect(deriveFinancialYear(input)).toEqual({ ok: true, fy: expected });
  });
});

describe('deriveFinancialYear — label format and century wrap', () => {
  it('April 2099 wraps to 99-00', () => {
    expect(deriveFinancialYear({ year: 2099, month: 4, day: 14 })).toEqual({
      ok: true,
      fy: '99-00',
    });
  });

  it('March 2100 stays 99-00', () => {
    expect(deriveFinancialYear({ year: 2100, month: 3, day: 31 })).toEqual({
      ok: true,
      fy: '99-00',
    });
  });

  it('April 2100 wraps past the century to 00-01', () => {
    expect(deriveFinancialYear({ year: 2100, month: 4, day: 1 })).toEqual({
      ok: true,
      fy: '00-01',
    });
  });

  it('single-digit FY years are zero-padded', () => {
    expect(deriveFinancialYear({ year: 2005, month: 6, day: 1 })).toEqual({
      ok: true,
      fy: '05-06',
    });
  });
});

describe('deriveFinancialYear — ISO string form', () => {
  it('strict YYYY-MM-DD parses and derives', () => {
    expect(deriveFinancialYear('2026-04-01')).toEqual({ ok: true, fy: '26-27' });
    expect(deriveFinancialYear('2026-03-31')).toEqual({ ok: true, fy: '25-26' });
  });

  it('rejects non-canonical strings with MALFORMED_DATE', () => {
    expect(deriveFinancialYear('2026-4-1')).toEqual({ ok: false, reason: 'MALFORMED_DATE' });
    expect(deriveFinancialYear('26-04-01')).toEqual({ ok: false, reason: 'MALFORMED_DATE' });
    expect(deriveFinancialYear('2026/04/01')).toEqual({ ok: false, reason: 'MALFORMED_DATE' });
    expect(deriveFinancialYear('2026-04-01T10:00:00Z')).toEqual({ ok: false, reason: 'MALFORMED_DATE' });
    expect(deriveFinancialYear('')).toEqual({ ok: false, reason: 'MALFORMED_DATE' });
  });
});

describe('deriveFinancialYear — typed rejection of impossible calendar dates', () => {
  it.each([
    ['month 13', { year: 2026, month: 13, day: 1 }],
    ['month 0', { year: 2026, month: 0, day: 15 }],
    ['day 32', { year: 2026, month: 1, day: 32 }],
    ['day 0', { year: 2026, month: 5, day: 0 }],
    ['Feb 30', { year: 2026, month: 2, day: 30 }],
    ['non-leap Feb 29', { year: 2025, month: 2, day: 29 }],
    ['century non-leap Feb 29 (1900)', { year: 1900, month: 2, day: 29 }],
    ['non-integer day', { year: 2026, month: 1, day: 1.5 }],
    ['non-integer month', { year: 2026, month: 2.5, day: 1 }],
  ])('%s -> MALFORMED_DATE (not a throw)', (_id, input) => {
    expect(deriveFinancialYear(input)).toEqual({ ok: false, reason: 'MALFORMED_DATE' });
  });

  it('real leap days pass: Feb 29 2024 and century leap Feb 29 2000', () => {
    expect(deriveFinancialYear({ year: 2024, month: 2, day: 29 })).toEqual({
      ok: true,
      fy: '23-24',
    });
    expect(deriveFinancialYear({ year: 2000, month: 2, day: 29 })).toEqual({
      ok: true,
      fy: '99-00',
    });
  });
});
