import { describe, expect, it } from 'vitest';

import { STATE_CODES, secondHeadNameFor } from '../src/state-codes';
import { derivePlaceOfSupply } from '../src/place-of-supply';
import type { PosInput, SupplyKind } from '../src/place-of-supply';

type PosOkResult = Extract<ReturnType<typeof derivePlaceOfSupply>, { ok: true }>;

const ALL_CODES: readonly string[] = STATE_CODES.map((e) => e.code);

/**
 * Place-of-supply → tax-head targeted law rows (INV-02).
 *
 * Rule table source: RESEARCH § Pattern 3 (IGST ss.8/10/12/13).
 * The two bill-to≠ship-to flavors resolve DIFFERENTLY (D-64 corrected):
 *   - goods_directed (third party, s.10(1)(b)): bill-to party's PPB governs
 *   - goods_movement (same recipient, two addresses): ship-to governs
 */
describe('derivePlaceOfSupply — targeted law rows', () => {
  it.each([
    [
      'intra-MH goods movement',
      { supplierStateCode: '27', kind: 'goods_movement', shipToStateCode: '27' },
      { posStateCode: '27', supplyType: 'intra_state', head: 'CGST_SGST', secondHeadName: 'SGST' },
    ],
    [
      'inter MH->KA goods movement',
      { supplierStateCode: '27', kind: 'goods_movement', shipToStateCode: '29' },
      { posStateCode: '29', supplyType: 'inter_state', head: 'IGST', secondHeadName: 'SGST' },
    ],
    [
      'intra-Chandigarh names UTGST',
      { supplierStateCode: '04', kind: 'goods_movement', shipToStateCode: '04' },
      { posStateCode: '04', supplyType: 'intra_state', head: 'CGST_UTGST', secondHeadName: 'UTGST' },
    ],
    [
      'intra-Delhi names SGST (legislature UT)',
      { supplierStateCode: '07', kind: 'goods_movement', shipToStateCode: '07' },
      { posStateCode: '07', supplyType: 'intra_state', head: 'CGST_SGST', secondHeadName: 'SGST' },
    ],
  ] as ReadonlyArray<[string, PosInput, Omit<PosOkResult, 'ok'>]>)('%s', (_label, input, expected) => {
    expect(derivePlaceOfSupply(input)).toEqual({ ok: true, ...expected });
  });

  it('third-party DIRECTED delivery takes bill-to PPB, NOT ship-to (s.10(1)(b))', () => {
    // Supplier MH, delivering into KA, ordered by a Delhi party: POS = DL.
    const result = derivePlaceOfSupply({
      supplierStateCode: '27',
      kind: 'goods_directed',
      shipToStateCode: '29',
      billToStateCode: '07',
    });
    expect(result).toEqual({
      ok: true,
      posStateCode: '07',
      supplyType: 'inter_state',
      head: 'IGST',
      secondHeadName: 'SGST',
    });
  });

  it('directed delivery without bill-to rejects typed (never throws)', () => {
    expect(
      derivePlaceOfSupply({
        supplierStateCode: '27',
        kind: 'goods_directed',
        shipToStateCode: '29',
      }),
    ).toEqual({ ok: false, reason: 'DIRECTED_BILL_TO_REQUIRED' });
  });

  it('same-recipient two-address invoice follows SHIP-TO (not a 10(1)(b) case)', () => {
    const result = derivePlaceOfSupply({
      supplierStateCode: '27',
      kind: 'goods_movement',
      shipToStateCode: '29',
      billToStateCode: '29',
    });
    expect(result).toEqual({
      ok: true,
      posStateCode: '29',
      supplyType: 'inter_state',
      head: 'IGST',
      secondHeadName: 'SGST',
    });
  });

  it('movement without ship-to falls back to bill-to state (row 1 tail)', () => {
    const result = derivePlaceOfSupply({
      supplierStateCode: '27',
      kind: 'goods_movement',
      billToStateCode: '27',
    });
    expect(result).toMatchObject({ ok: true, posStateCode: '27', head: 'CGST_SGST' });
  });

  it.each([
    ['no-movement slot', 'goods_nomovement'],
    ['installation slot', 'goods_installation'],
    ['on-board slot', 'goods_onboard'],
  ] as ReadonlyArray<[string, SupplyKind]>)('%s maps the governing location onto shipToStateCode', (_label, kind) => {
    const result = derivePlaceOfSupply({
      supplierStateCode: '27',
      kind,
      shipToStateCode: '29',
    });
    expect(result).toMatchObject({ ok: true, posStateCode: '29', head: 'IGST' });
  });

  it('services: performance location wins over every recipient field (row 9)', () => {
    const result = derivePlaceOfSupply({
      supplierStateCode: '27',
      kind: 'service',
      billToStateCode: '29',
      recipientRegisteredStateCode: '24',
      performanceLocationStateCode: '32',
    });
    expect(result).toMatchObject({ ok: true, posStateCode: '32', head: 'IGST' });
  });

  it('services to registered recipient use the recipient location (row 7)', () => {
    const result = derivePlaceOfSupply({
      supplierStateCode: '27',
      kind: 'service',
      billToStateCode: '29',
    });
    expect(result).toMatchObject({ ok: true, posStateCode: '29', head: 'IGST' });
  });

  it('services with nothing on record fall back to the supplier state (row 8 tail)', () => {
    const result = derivePlaceOfSupply({ supplierStateCode: '27', kind: 'service' });
    expect(result).toMatchObject({ ok: true, posStateCode: '27', head: 'CGST_SGST' });
  });

  it('SEZ forces IGST even within one state (row 12)', () => {
    const sez = derivePlaceOfSupply({
      supplierStateCode: '27',
      kind: 'goods_movement',
      shipToStateCode: '27',
      sez: true,
    });
    expect(sez).toEqual({
      ok: true,
      posStateCode: '27',
      supplyType: 'inter_state',
      head: 'IGST',
      secondHeadName: 'SGST',
    });
    // Contrast: identical input without the flag stays intra.
    const plain = derivePlaceOfSupply({
      supplierStateCode: '27',
      kind: 'goods_movement',
      shipToStateCode: '27',
    });
    expect(plain).toMatchObject({ ok: true, supplyType: 'intra_state', head: 'CGST_SGST' });
  });
});

describe('derivePlaceOfSupply — unknown codes reject typed', () => {
  it.each([
    ['unknown supplier', { supplierStateCode: '99', kind: 'service' }],
    ['unknown ship-to', { supplierStateCode: '27', kind: 'goods_movement', shipToStateCode: '00' }],
    ['unknown bill-to', { supplierStateCode: '27', kind: 'service', billToStateCode: '39' }],
    ['unknown recipient registration', {
      supplierStateCode: '27',
      kind: 'service',
      recipientRegisteredStateCode: 'ZZ',
    }],
  ] as ReadonlyArray<[string, PosInput]>)('%s -> UNKNOWN_STATE_CODE', (_label, input) => {
    expect(derivePlaceOfSupply(input)).toEqual({ ok: false, reason: 'UNKNOWN_STATE_CODE' });
  });
});

describe('supplyType strings byte-match the invoices.supply_type DB enum', () => {
  it.each([
    ['intra_state', { supplierStateCode: '27', kind: 'goods_movement', shipToStateCode: '27' }],
    ['inter_state', { supplierStateCode: '27', kind: 'goods_movement', shipToStateCode: '29' }],
  ] as ReadonlyArray<['intra_state' | 'inter_state', PosInput]>)('emits exactly %p', (expectedEnum, input) => {
    const result = derivePlaceOfSupply(input);
    if (!result.ok) throw new Error(`unexpected rejection: ${result.reason}`);
    // Exact string equality with the migration 0004_documents.sql check constraint values.
    expect(result.supplyType === expectedEnum).toBe(true);
  });
});

describe('derivePlaceOfSupply — 39x39 totality sweep (T-2-09)', () => {
  // Every ordered supplier x POS pairing over the full code universe must
  // return a result: equal codes => intra with the table's naming; unequal
  // => IGST; SEZ flips equal pairs to IGST. Loop executes fully in-process —
  // no pairing can hit an unhandled branch at runtime.
  for (const supplier of ALL_CODES) {
    for (const pos of ALL_CODES) {
      const label = supplier + '->' + pos;
      const input: PosInput = {
        supplierStateCode: supplier,
        kind: 'goods_movement',
        shipToStateCode: pos,
      };

      it(label + ': plain supply resolves law-correctly', () => {
        const result = derivePlaceOfSupply(input);
        if (!result.ok) throw new Error('unexpected rejection: ' + result.reason);
        expect(result.posStateCode).toBe(pos);
        if (supplier === pos) {
          const expectedSecond = secondHeadNameFor(pos);
          expect(result.supplyType).toBe('intra_state');
          expect(result.head).toBe(expectedSecond === 'UTGST' ? 'CGST_UTGST' : 'CGST_SGST');
          expect(result.secondHeadName).toBe(expectedSecond);
        } else {
          expect(result.supplyType).toBe('inter_state');
          expect(result.head).toBe('IGST');
        }
      });

      it(label + ': SEZ flip forces IGST', () => {
        const result = derivePlaceOfSupply({ ...input, sez: true });
        if (!result.ok) throw new Error('unexpected rejection: ' + result.reason);
        expect(result.head).toBe('IGST');
        expect(result.supplyType).toBe('inter_state');
      });
    }
  }
});
