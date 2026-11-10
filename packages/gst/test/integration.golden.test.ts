import { describe, expect, it } from 'vitest';

// Barrel import on purpose (plan verification): a green run doubles as
// proof the public surface exposes every consumed family.
import {
  computeLine,
  derivePlaceOfSupply,
  totalInvoice,
} from '../src/index.js';

/**
 * Cross-module integration goldens: the full pipeline a Phase 4 finalize
 * payload exercises — derivePlaceOfSupply -> computeLine x n -> totalInvoice
 * — tied out to hand-computed literals end-to-end.
 */
describe('integration: multi-line B2B intra-state invoice ties out exactly', () => {
  // Supplier and buyer both in Maharashtra.
  const pos = derivePlaceOfSupply({
    supplierStateCode: '27',
    kind: 'goods_movement',
    shipToStateCode: '27',
  });
  if (!pos.ok) throw new Error('POS derivation unexpectedly rejected');

  const lines = [
    // L1: qty 2.500 @ Rs199.99 @18% -> base 49998p (half-up from 49997.5), tax 9000p.
    {
      qtyMilli: 2500n,
      unitPricePaise: 19999n,
      discountBps: 0n,
      pricingMode: 'exclusive',
      gstRateBps: 1800n,
      character: 'taxable',
    },
    // L2: Rs404.00 @0.25% -> taxable 40400p, tax exactly 101p (odd split 51/50).
    {
      qtyMilli: 1000n,
      unitPricePaise: 40400n,
      discountBps: 0n,
      pricingMode: 'exclusive',
      gstRateBps: 25n,
      character: 'taxable',
    },
    // L3: Rs500.00 with 10% discount @5% -> discount 5000p, taxable 45000p, tax 2250p.
    {
      qtyMilli: 1000n,
      unitPricePaise: 50000n,
      discountBps: 1000n,
      pricingMode: 'exclusive',
      gstRateBps: 500n,
      character: 'taxable',
    },
    // L4: zero-value free sample — retained for the record, all-zero (D-65).
    {
      qtyMilli: 1000n,
      unitPricePaise: 10000n,
      discountBps: 10000n,
      pricingMode: 'exclusive',
      gstRateBps: 1800n,
      character: 'taxable',
    },
  ] as const;

  const totals = totalInvoice([...lines], {
    head: pos.ok ? pos.head : 'CGST_SGST',
    registrationType: 'regular',
    reverseCharge: false,
  });

  it('POS resolves intra with SGST naming', () => {
    expect(pos).toEqual({
      ok: true,
      posStateCode: '27',
      supplyType: 'intra_state',
      head: 'CGST_SGST',
      secondHeadName: 'SGST',
    });
  });

  it('every column ties out to hand-computed literals', () => {
    if (!totals.ok) throw new Error(`unexpected rejection: ${JSON.stringify(totals)}`);
    expect(totals.lines[0]).toMatchObject({ taxablePaise: 49998n, cgstPaise: 4500n, sgstOrUtgstPaise: 4500n });
    expect(totals.lines[1]).toMatchObject({ taxablePaise: 40400n, cgstPaise: 51n, sgstOrUtgstPaise: 50n });
    expect(totals.lines[2]).toMatchObject({ taxablePaise: 45000n, cgstPaise: 1125n, sgstOrUtgstPaise: 1125n });
    expect(totals.lines[3]).toMatchObject({ taxablePaise: 0n, cgstPaise: 0n, sgstOrUtgstPaise: 0n });

    expect(totals.subtotalPaise).toBe(135398n);
    expect(totals.taxPaise).toBe(11351n);
    // Raw grand 146749p = Rs1467.49 -> rounds DOWN to Rs1467: round-off hits
    // the -49p extreme of the signed range (D-56).
    expect(totals.roundOffPaise).toBe(-49n);
    expect(totals.grandTotalPaise).toBe(146700n);
  });

  it('classification and flavor ride along (D-62/D-60)', () => {
    if (!totals.ok) throw new Error('unexpected rejection');
    expect(totals.docClass).toBe('TAX_INVOICE');
    expect(totals.character).toBe('taxable');
    expect(totals.gstr1Flavor).toBe('B2CS'); // taxable + intra_state hint
    expect(totals.reverseCharge).toBe(false);
  });

  it('zero-value sample line left totals untouched (D-65)', () => {
    if (!totals.ok) throw new Error('unexpected rejection');
    const sumOfFirstThree =
      (totals.lines[0]?.taxablePaise ?? 0n) +
      (totals.lines[1]?.taxablePaise ?? 0n) +
      (totals.lines[2]?.taxablePaise ?? 0n);
    expect(sumOfFirstThree).toBe(totals.subtotalPaise);
  });
});

describe('integration: research round-off scenario embedded at invoice scale', () => {
  // Raw total 844279p (Rs8442.79) must emit round-off +21p via one half-up
  // event (CGST s.170 convention).
  const totals = totalInvoice(
    [
      {
        qtyMilli: 1000n,
        unitPricePaise: 844279n,
        discountBps: 0n,
        pricingMode: 'exclusive',
        gstRateBps: 0n,
        character: 'zero_rated_taxable',
      },
    ],
    { head: 'CGST_SGST', registrationType: 'regular', reverseCharge: false },
  );

  it('raw 844279p -> roundOff +21p -> grand 844300p', () => {
    if (!totals.ok) throw new Error('unexpected rejection');
    expect(totals.subtotalPaise).toBe(844279n);
    expect(totals.taxPaise).toBe(0n);
    expect(totals.roundOffPaise).toBe(21n);
    expect(totals.grandTotalPaise).toBe(844300n);
    expect(totals.docClass).toBe('TAX_INVOICE'); // zero-rated-taxable is still taxable
    expect(totals.gstr1Flavor).toBe('GSTR1_TABLE14_ZERO_RATED');
  });
});

describe('integration: third-party directed delivery books IGST to the bill-to state', () => {
  const pos = derivePlaceOfSupply({
    supplierStateCode: '27',
    kind: 'goods_directed',
    shipToStateCode: '29',
    billToStateCode: '07',
  });
  if (!pos.ok) throw new Error('POS derivation unexpectedly rejected');

  const totals = totalInvoice(
    [
      {
        qtyMilli: 1000n,
        unitPricePaise: 100000n,
        discountBps: 0n,
        pricingMode: 'exclusive',
        gstRateBps: 1800n,
        character: 'taxable',
      },
    ],
    { head: pos.ok ? pos.head : 'IGST', registrationType: 'regular', reverseCharge: false },
  );

  it('POS = Delhi despite KA ship-to (s.10(1)(b)); full tax lands in IGST', () => {
    expect(pos.ok && pos.posStateCode === '07' && pos.head === 'IGST').toBe(true);
    if (!totals.ok) throw new Error('unexpected rejection');
    expect(totals.subtotalPaise).toBe(100000n);
    expect(totals.taxPaise).toBe(18000n);
    expect(totals.lines[0]).toMatchObject({ igstPaise: 18000n, cgstPaise: 0n, sgstOrUtgstPaise: 0n });
    expect(totals.roundOffPaise).toBe(0n);
    expect(totals.grandTotalPaise).toBe(118000n);
    expect(totals.gstr1Flavor).toBe('B2B'); // taxable + inter_state hint
  });
});

describe('integration: RCM flag rides through the whole pipeline unchanged (D-54)', () => {
  const plainLine = {
    qtyMilli: 2000n,
    unitPricePaise: 25000n,
    discountBps: 0n,
    pricingMode: 'exclusive',
    gstRateBps: 1800n,
    character: 'taxable',
  } as const;
  const rcmLine = { ...plainLine, rcm: true } as const;

  const plain = totalInvoice([plainLine], {
    head: 'CGST_SGST',
    registrationType: 'regular',
    reverseCharge: false,
  });
  const rcm = totalInvoice([rcmLine], {
    head: 'CGST_SGST',
    registrationType: 'regular',
    reverseCharge: true,
  });

  it('flags preserved at line and invoice level; arithmetic identical', () => {
    if (!plain.ok || !rcm.ok) throw new Error('unexpected rejection');
    expect(rcm.reverseCharge).toBe(true);
    expect(plain.reverseCharge).toBe(false);
    expect(rcm.lines[0]?.rcm).toBe(true);
    expect(rcm.subtotalPaise).toBe(plain.subtotalPaise);
    expect(rcm.taxPaise).toBe(plain.taxPaise);
    expect(rcm.grandTotalPaise).toBe(plain.grandTotalPaise);
    expect(rcm.docClass).toBe(plain.docClass);
  });
});

describe('integration: rejections propagate through totalInvoice with positions', () => {
  it('an empty draft rejects typed instead of totaling as a zero Bill of Supply', () => {
    const result = totalInvoice([], {
      head: 'CGST_SGST',
      registrationType: 'regular',
      reverseCharge: false,
    });
    expect(result).toEqual({ ok: false, reason: 'EMPTY_DRAFT' });
  });

  it('heterogeneous draft rejects naming the offending position', () => {
    const result = totalInvoice(
      [
        {
          qtyMilli: 1000n,
          unitPricePaise: 10000n,
          discountBps: 0n,
          pricingMode: 'exclusive',
          gstRateBps: 1800n,
          character: 'taxable',
        },
        {
          qtyMilli: 1000n,
          unitPricePaise: 10000n,
          discountBps: 0n,
          pricingMode: 'exclusive',
          gstRateBps: 0n,
          character: 'exempt',
        },
      ],
      { head: 'CGST_SGST', registrationType: 'regular', reverseCharge: false },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'HETEROGENEOUS_TAX_CHARACTER',
      offendingLineIndexes: [1],
    });
  });

  it('abolished-rate line rejects with its position before any totals exist', () => {
    const result = totalInvoice(
      [
        {
          qtyMilli: 1000n,
          unitPricePaise: 10000n,
          discountBps: 0n,
          pricingMode: 'exclusive',
          gstRateBps: 1200n, // abolished 12% slab
          character: 'taxable',
        },
      ],
      { head: 'CGST_SGST', registrationType: 'regular', reverseCharge: false },
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_A_CURRENT_SLAB', linePosition: 0 });
  });

  it('negative-amount line rejects through the pipeline naming its position', () => {
    const result = totalInvoice(
      [
        {
          qtyMilli: 1000n,
          unitPricePaise: 10000n,
          discountBps: 0n,
          pricingMode: 'exclusive',
          gstRateBps: 1800n,
          character: 'taxable',
        },
        {
          qtyMilli: -1000n, // negative quantity — upstream data-entry bug class
          unitPricePaise: 10000n,
          discountBps: 0n,
          pricingMode: 'exclusive',
          gstRateBps: 1800n,
          character: 'taxable',
        },
      ],
      { head: 'CGST_SGST', registrationType: 'regular', reverseCharge: false },
    );
    expect(result).toEqual({ ok: false, reason: 'NEGATIVE_AMOUNT', linePosition: 1 });
  });

  it('over-free discount (discountBps > 10000) rejects with its position', () => {
    const result = totalInvoice(
      [
        {
          qtyMilli: 1000n,
          unitPricePaise: 10000n,
          discountBps: 15000n, // classic zod-gap vector: would drive taxable negative
          pricingMode: 'exclusive',
          gstRateBps: 1800n,
          character: 'taxable',
        },
      ],
      { head: 'IGST', registrationType: 'regular', reverseCharge: false },
    );
    expect(result).toEqual({ ok: false, reason: 'DISCOUNT_OUT_OF_RANGE', linePosition: 0 });
  });

  it('negative rate rejects through the pipeline (T-2-R1) naming its position', () => {
    const result = totalInvoice(
      [
        {
          qtyMilli: 1000n,
          unitPricePaise: 50000n,
          discountBps: 0n,
          pricingMode: 'inclusive',
          gstRateBps: -10000n, // would be BigInt RangeError before the gate
          character: 'exempt',
        },
      ],
      { head: 'CGST_SGST', registrationType: 'regular', reverseCharge: false },
    );
    expect(result).toEqual({ ok: false, reason: 'NEGATIVE_RATE', linePosition: 0 });
  });

  it('per-line computeLine agrees with the pipeline view of an odd-paisa split', () => {
    const direct = computeLine(
      {
        qtyMilli: 1000n,
        unitPricePaise: 12345n,
        discountBps: 0n,
        pricingMode: 'exclusive',
        gstRateBps: 150n,
        character: 'taxable',
      },
      { head: 'CGST_UTGST' },
    );
    if (!direct.ok) throw new Error('unexpected rejection');
    expect(direct.cgstPaise).toBe(93n);
    expect(direct.sgstOrUtgstPaise).toBe(92n);
  });
});

describe('integration: unregistered business (no GSTIN) charges no GST', () => {
  const lines = [
    {
      qtyMilli: 1000n,
      unitPricePaise: 11800n,
      discountBps: 0n,
      pricingMode: 'inclusive',
      gstRateBps: 1800n,
      character: 'taxable',
    },
    {
      qtyMilli: 2000n,
      unitPricePaise: 5000n,
      discountBps: 0n,
      pricingMode: 'exclusive',
      gstRateBps: 500n,
      character: 'taxable',
    },
  ] as const;

  it('prices stay whole, tax is zero and the document is a Bill of Supply', () => {
    const totals = totalInvoice([...lines], {
      head: 'CGST_SGST',
      registrationType: 'unregistered',
      reverseCharge: false,
    });
    if (!totals.ok) throw new Error(totals.reason);
    expect(totals.taxPaise).toBe(0n);
    // Inclusive Rs118 stays Rs118 (no tax backed out) + 2 x Rs50.
    expect(totals.subtotalPaise).toBe(21800n);
    expect(totals.grandTotalPaise).toBe(21800n);
    expect(totals.docClass).toBe('BILL_OF_SUPPLY');
    for (const line of totals.lines) {
      expect(line.gstRateBps).toBe(0n);
      expect(line.cgstPaise + line.sgstOrUtgstPaise + line.igstPaise).toBe(0n);
    }
  });

  it('the same lines on a regular business still carry GST', () => {
    const totals = totalInvoice([...lines], {
      head: 'CGST_SGST',
      registrationType: 'regular',
      reverseCharge: false,
    });
    if (!totals.ok) throw new Error(totals.reason);
    expect(totals.taxPaise).toBeGreaterThan(0n);
  });
});
