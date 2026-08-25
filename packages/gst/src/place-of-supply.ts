/**
 * Place-of-supply → tax-head derivation — the twelve-row rule table (INV-02).
 *
 * Law sources: IGST Act ss.8/10/12/13 per RESEARCH § Pattern 3. The two
 * bill-to≠ship-to flavors are DISTINCT input kinds so a single boolean
 * "differship" flag cannot collapse them (RESEARCH Pitfall 4):
 *   - goods_movement: ship-to governs; bill-to is the fallback when absent;
 *     same-recipient multi-address invoices are NOT a s.10(1)(b) case.
 *   - goods_directed: third-party delivery under s.10(1)(b) — the bill-to
 *     party's principal place of business governs, ship-to ignored, and a
 *     missing bill-to is a typed rejection.
 *
 * Head decision is pure state-CODE equality: equal codes → intra
 * (CGST + secondHeadNameFor(pos)), unequal → IGST. UT naming comes from the
 * code table's typed flags — there is no separate UT arithmetic path and no
 * string comparison against UT names anywhere here (RESEARCH Pitfall 3).
 *
 * Purity: no Date/clock/network/process-env access of any kind; total over
 * all valid inputs (every valid code pairing returns a result), which the
 * golden matrix's totality sweep proves exhaustively.
 */

import { isValidStateCode, secondHeadNameFor } from './state-codes';

export type SupplyKind =
  | 'goods_movement'
  | 'goods_directed'
  | 'goods_nomovement'
  | 'goods_installation'
  | 'goods_onboard'
  | 'service';

export interface PosInput {
  supplierStateCode: string;
  kind: SupplyKind;
  /**
   * Governing delivery-side location. Slot mapping by kind:
   * goods_movement/goods_directed -> physical delivery address;
   * goods_nomovement / goods_installation / goods_onboard -> location of
   * goods at delivery / installation site / on-board point (rows 4-6).
   */
  shipToStateCode?: string;
  /**
   * Ordering/billing party's principal place of business. This is the
   * GOODS s.10(1)(b) slot: for services it is only a last-resort fallback —
   * `recipientRegisteredStateCode` is the lawful s.12(2)(a) governing slot
   * and always outranks it.
   */
  billToStateCode?: string;
  /** Recipient's GST-registered location — the general B2B services row (s.12(2)(a), row 7). */
  recipientRegisteredStateCode?: string;
  /**
   * Restaurant/immovable-property/event performance location — electing this
   * slot ELECTS the special IGST s.12/13 row (row 9). Setting it alongside a
   * recipient-side slot is ambiguous (data presence must not silently elect a
   * legal rule) and rejects typed with 'AMBIGUOUS_SERVICE_SLOTS'.
   */
  performanceLocationStateCode?: string;
  /** Supply to/from an SEZ unit or developer — forces IGST after resolution (row 12). */
  sez?: boolean;
}

export type TaxHead = 'CGST_SGST' | 'CGST_UTGST' | 'IGST';

export type SupplyType = 'intra_state' | 'inter_state';

export type PosFailReason =
  | 'DIRECTED_BILL_TO_REQUIRED'
  | 'AMBIGUOUS_SERVICE_SLOTS'
  | 'UNKNOWN_STATE_CODE';

export type PosResult =
  | {
      ok: true;
      posStateCode: string;
      supplyType: SupplyType;
      head: TaxHead;
      secondHeadName: 'SGST' | 'UTGST';
    }
  | { ok: false; reason: PosFailReason };

function checkCodes(
  codes: ReadonlyArray<string | undefined>,
): PosFailReason | undefined {
  for (const code of codes) {
    if (code !== undefined && !isValidStateCode(code)) {
      return 'UNKNOWN_STATE_CODE';
    }
  }
  return undefined;
}

function resolvePos(input: PosInput): { posStateCode: string } | { fail: PosFailReason } {
  const {
    supplierStateCode,
    kind,
    shipToStateCode,
    billToStateCode,
    recipientRegisteredStateCode,
    performanceLocationStateCode,
  } = input;

  switch (kind) {
    case 'goods_movement':
      // Row 1/3: ship-to governs; bill-to fallback when absent; counter-sale
      // fallback to supplier when nothing is recorded keeps the function total.
      return { posStateCode: shipToStateCode ?? billToStateCode ?? supplierStateCode };

    case 'goods_directed':
      // Row 2 (s.10(1)(b)): bill-to REQUIRED; its PPB governs regardless of ship-to.
      if (billToStateCode === undefined) return { fail: 'DIRECTED_BILL_TO_REQUIRED' };
      return { posStateCode: billToStateCode };

    case 'goods_nomovement':
    case 'goods_installation':
    case 'goods_onboard':
      // Rows 4-6: caller passes the governing location in the ship-to slot;
      // fall back to supplier (goods at seller premises) when absent.
      return { posStateCode: shipToStateCode ?? supplierStateCode };

    case 'service': {
      // Rows 7-9 with EXPLICIT rule election: presence of an optional slot
      // must never silently elect a special IGST s.12/13 row. A performance
      // location recorded alongside a recipient-side slot is ambiguous — the
      // caller must elect one row, so the combo rejects typed instead of
      // letting incidental data flip the tax head.
      const recipientSide = recipientRegisteredStateCode ?? billToStateCode;
      if (performanceLocationStateCode !== undefined && recipientSide !== undefined) {
        return { fail: 'AMBIGUOUS_SERVICE_SLOTS' };
      }
      // Resolution: performance location (row 9, sole election) -> registered
      // recipient location (s.12(2)(a), row 7) -> bill-to as last-resort
      // fallback -> supplier when nothing is on record (row 8 tail).
      return {
        posStateCode:
          performanceLocationStateCode ??
          recipientRegisteredStateCode ??
          billToStateCode ??
          supplierStateCode,
      };
    }
  }
}

export function derivePlaceOfSupply(input: PosInput): PosResult {
  const unknown = checkCodes([
    input.supplierStateCode,
    input.shipToStateCode,
    input.billToStateCode,
    input.recipientRegisteredStateCode,
    input.performanceLocationStateCode,
  ]);
  if (unknown !== undefined) return { ok: false, reason: unknown };

  const resolved = resolvePos(input);
  if ('fail' in resolved) return { ok: false, reason: resolved.fail };
  const { posStateCode } = resolved;

  const sez = input.sez === true;
  const sameState =
    posStateCode === input.supplierStateCode &&
    isValidStateCode(posStateCode); // defensive: never intra against an invalid code

  const secondHeadName = secondHeadNameFor(posStateCode);
  if (sez || !sameState) {
    // Row 12 SEZ proviso: always inter-state → IGST, even within one state.
    return {
      ok: true,
      posStateCode,
      supplyType: 'inter_state',
      head: 'IGST',
      // Informational only under IGST: naming stays bound to the resolved POS.
      secondHeadName,
    };
  }

  return {
    ok: true,
    posStateCode,
    supplyType: 'intra_state',
    head: secondHeadName === 'UTGST' ? 'CGST_UTGST' : 'CGST_SGST',
    secondHeadName,
  };
}
