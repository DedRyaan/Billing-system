import { describe, expect, it } from 'vitest';

import {
  STATE_CODES,
  getStateEntry,
  isValidStateCode,
  secondHeadNameFor,
} from '../src/state-codes';

/**
 * State/UT code table golden rows (RESEARCH Assumptions A1/A2).
 *
 * A1: the universe is exactly codes '01'..'38' plus '97' (Other Territory).
 * A2: Delhi / Puducherry / J&K have legislatures -> their second head is
 * NAMED SGST; Chandigarh / A&N / Lakshadweep / DNH&DD / Ladakh (and OT) are
 * named UTGST. Legal-fact status of both assumptions gets CA confirmation
 * at UAT — flagged, not silently assumed.
 */
describe('STATE_CODES — universe shape', () => {
  it('holds exactly 39 entries', () => {
    expect(STATE_CODES).toHaveLength(39);
  });

  it("covers every code '01'..'38' plus '97', each carrying name + legislature flag", () => {
    const expectedCodes: string[] = [];
    for (let n = 1; n <= 38; n++) {
      expectedCodes.push(String(n).padStart(2, '0'));
    }
    expectedCodes.push('97');

    const actualCodes = STATE_CODES.map((e) => e.code);
    expect([...actualCodes].sort()).toEqual([...expectedCodes].sort());

    for (const entry of STATE_CODES) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.isUtWithLegislature).toBe('boolean');
    }
  });

  it('exactly three entries have legislatures: Delhi, Puducherry, J&K', () => {
    const legislatureUts = STATE_CODES.filter((e) => e.isUtWithLegislature).map((e) => e.code);
    expect(legislatureUts.sort()).toEqual(['01', '07', '34']);
  });

  it('spot-checks canonical entries', () => {
    expect(getStateEntry('27')).toMatchObject({ code: '27', name: 'Maharashtra' });
    expect(getStateEntry('29')).toMatchObject({ code: '29', name: 'Karnataka' });
    expect(getStateEntry('07')).toMatchObject({ code: '07', name: 'Delhi' });
    expect(getStateEntry('26')).toMatchObject({
      code: '26',
      name: 'Dadra & Nagar Haveli and Daman & Diu',
    });
    expect(getStateEntry('31')).toMatchObject({ code: '31', name: 'Lakshadweep' });
    expect(getStateEntry('36')).toMatchObject({ code: '36', name: 'Telangana' });
    expect(getStateEntry('38')).toMatchObject({ code: '38', name: 'Ladakh' });
    expect(getStateEntry('97')).toMatchObject({ code: '97', name: 'Other Territory' });
  });
});

describe('secondHeadNameFor — the A2 naming split', () => {
  it.each([
    ['Delhi (UT with legislature)', '07', 'SGST'],
    ['Puducherry (UT with legislature)', '34', 'SGST'],
    ['Jammu & Kashmir (UT with legislature)', '01', 'SGST'],
    ['plain state Maharashtra', '27', 'SGST'],
    ['plain state Karnataka', '29', 'SGST'],
    ['Chandigarh (UT no legislature)', '04', 'UTGST'],
    ['Andaman & Nicobar Islands', '35', 'UTGST'],
    ['Lakshadweep (official code 31)', '31', 'UTGST'],
    ['DNH and Daman & Diu', '26', 'UTGST'],
    ['Ladakh', '38', 'UTGST'],
    ['Other Territory', '97', 'UTGST'],
    ['Telangana is a plain STATE (code 36), NOT Lakshadweep', '36', 'SGST'],
  ])('%s names the second head %s', (_label, code, head) => {
    expect(secondHeadNameFor(code)).toBe(head);
  });
});

describe('unknown-code handling — undefined-safe lookups, never throws', () => {
  it.each([['99'], ['00'], ['39'], ['7'], ['027'], ['ab'], ['']])(
    '%s is not a valid state code',
    (code) => {
      expect(isValidStateCode(code)).toBe(false);
      expect(getStateEntry(code)).toBeUndefined();
    },
  );

  it.each([['01'], ['27'], ['38'], ['97']])('%s is valid', (code) => {
    expect(isValidStateCode(code)).toBe(true);
  });
});
