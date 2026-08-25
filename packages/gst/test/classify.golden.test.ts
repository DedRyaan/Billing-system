import { describe, expect, it } from 'vitest';

import {
  classifyDocument,
  classifyDraft,
  gstr1FlavorFor,
} from '../src/invoice';

/**
 * Classification goldens (D-60/D-61/D-62).
 *
 * Character uniformity is per-INVOICE (D-61): one invoice may not mix
 * taxable and non-taxable lines, so each accepted document maps wholly to
 * ONE GSTR-1 flavor. Classification (D-62): composition dealer OR all
 * non-taxable -> Bill of Supply; regular + taxable -> Tax Invoice.
 */
describe('classifyDraft — uniform characters pass carrying that character', () => {
  it.each([
    ['all taxable', ['taxable', 'taxable', 'taxable'], 'taxable'],
    ['all exempt', ['exempt'], 'exempt'],
    ['all nil_rated', ['nil_rated', 'nil_rated'], 'nil_rated'],
    ['all non_gst', ['non_gst'], 'non_gst'],
    ['all zero_rated_taxable', ['zero_rated_taxable', 'zero_rated_taxable'], 'zero_rated_taxable'],
  ] as const)('%s -> ok', (_label, characters, expected) => {
    expect(classifyDraft(characters.map((character) => ({ character })))).toEqual({
      ok: true,
      character: expected,
    });
  });

  it('a zero-value gift line does NOT break uniformity (D-65 x D-61)', () => {
    // Sample line keeps character 'taxable' with zero amounts — mixing is a
    // CHARACTER question, not an amount question.
    const lines = [
      { character: 'taxable', qtyMilli: 1000n },
      { character: 'taxable', qtyMilli: 0n }, // free sample
      { character: 'taxable', qtyMilli: 2000n },
    ];
    expect(classifyDraft(lines)).toEqual({ ok: true, character: 'taxable' });
  });
});

describe('classifyDraft — mixed drafts reject closed with offending positions (D-61)', () => {
  it('exempt line inside a taxable draft names its position', () => {
    const result = classifyDraft([
      { character: 'taxable' },
      { character: 'taxable' },
      { character: 'exempt' }, // position 2 offends
      { character: 'taxable' },
    ]);
    expect(result).toEqual({
      ok: false,
      reason: 'HETEROGENEOUS_TAX_CHARACTER',
      offendingLinePositions: [2],
    });
  });

  it('multiple offending positions are all reported in order', () => {
    const result = classifyDraft([
      { character: 'taxable' },      // reference character
      { character: 'nil_rated' },    // 1
      { character: 'taxable' },
      { character: 'non_gst' },      // 3
    ]);
    if (result.ok) throw new Error('expected rejection');
    expect(result.reason).toBe('HETEROGENEOUS_TAX_CHARACTER');
    expect(result.offendingLinePositions).toEqual([1, 3]);
  });

  it('an empty draft is vacuously uniform at no character', () => {
    // Totality: no lines -> nothing to mix; ok with undefined-less shape.
    const result = classifyDraft([]);
    expect(result).toEqual({ ok: true, character: null });
  });
});

describe('classifyDocument — D-62 table', () => {
  it.each([
    ['regular + taxable -> Tax Invoice', 'regular', 'taxable', 'TAX_INVOICE'],
    ['regular + zero-rated-taxable -> Tax Invoice', 'regular', 'zero_rated_taxable', 'TAX_INVOICE'],
    ['composition + taxable -> Bill of Supply', 'composition', 'taxable', 'BILL_OF_SUPPLY'],
    ['composition + exempt -> Bill of Supply', 'composition', 'exempt', 'BILL_OF_SUPPLY'],
    ['regular + exempt -> Bill of Supply', 'regular', 'exempt', 'BILL_OF_SUPPLY'],
    ['regular + nil_rated -> Bill of Supply', 'regular', 'nil_rated', 'BILL_OF_SUPPLY'],
    ['regular + non_gst -> Bill of Supply', 'regular', 'non_gst', 'BILL_OF_SUPPLY'],
  ] as const)('%s', (_label, registrationType, character, docClass) => {
    expect(classifyDocument({ registrationType, character })).toBe(docClass);
  });
});

describe('gstr1FlavorFor — four no-tax flavors map to DISTINCT hints (D-60)', () => {
  it.each([
    ['exempt', undefined, 'GSTR1_TABLE8_EXEMPT'],
    ['nil_rated', undefined, 'GSTR1_TABLE8_NIL_RATED'],
    ['non_gst', undefined, 'GSTR1_TABLE8_NON_GST'],
    ['zero_rated_taxable', undefined, 'GSTR1_TABLE14_ZERO_RATED'],
  ] as const)('%s -> %s', (character, supplyType, expected) => {
    expect(gstr1FlavorFor(character, supplyType)).toBe(expected);
  });

  it('the four no-tax hints are pairwise distinct', () => {
    const hints = ([
      'exempt',
      'nil_rated',
      'non_gst',
      'zero_rated_taxable',
    ] as const).map((c) => gstr1FlavorFor(c));
    expect(new Set(hints).size).toBe(4);
  });

  it('taxable resolves toward B2B/B2C by supply type (mapping surface; Phase 8 refines by buyer registration)', () => {
    expect(gstr1FlavorFor('taxable', 'inter_state')).toBe('B2B');
    expect(gstr1FlavorFor('taxable', 'intra_state')).toBe('B2CS');
    expect(gstr1FlavorFor('taxable')).toBe('B2_UNRESOLVED');
  });
});
