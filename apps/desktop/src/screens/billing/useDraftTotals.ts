// useDraftTotals — CLIENT-SIDE live GST preview (R-52).
//
// Computes invoice totals entirely in the browser via totalInvoice() from
// @billing/gst — no server round-trip. The server recomputes at finalize
// time (R-46) as a safety net. Discrepancy = bug to test.
//
// All monetary conversions happen here at the boundary: draft rupee numbers
// → integer paise/milliunits → BigInt engine inputs. No float ever enters
// the GST engine (D-55).
import { useMemo } from "react";
import { totalInvoice, derivePlaceOfSupply } from "@billing/gst";
import type { LineInput, InvoiceTotals, TaxHead, SupplyType } from "@billing/gst";
import type { LineItemDraft } from "./billing-schema";

export interface DraftTotalsResult {
  totals: InvoiceTotals;
  head: TaxHead;
  supplyType: SupplyType;
}

/**
 * Convert draft line-item numbers into BigInt GST engine inputs.
 * Uses parse-style conversion (no parseFloat) — number × scaling
 * preserves precision for the exact decimal inputs our schema accepts.
 */
function toLineInput(line: LineItemDraft): LineInput {
  return {
    qtyMilli: BigInt(Math.round(line.quantity * 1000)),
    unitPricePaise: BigInt(Math.round(line.unit_price * 100)),
    discountBps: BigInt(Math.round(line.discount_pct * 100)),
    pricingMode: "exclusive" as const,
    gstRateBps: BigInt(Math.round(line.gst_rate * 100)),
    character: "taxable" as const,
  };
}

export function useDraftTotals(
  lines: LineItemDraft[],
  supplierStateCode: string | null,
  customerStateCode: string | null,
  registrationType: "regular" | "composition" | "unregistered",
): DraftTotalsResult | null {
  return useMemo(() => {
    if (lines.length === 0 || !supplierStateCode || !customerStateCode) return null;

    const posResult = derivePlaceOfSupply({
      supplierStateCode,
      shipToStateCode: customerStateCode,
      kind: "goods_movement",
    });
    if (!posResult.ok) return null;

    const head: TaxHead = posResult.head;
    const lineInputs: LineInput[] = lines.map(toLineInput);

    const result = totalInvoice(lineInputs, {
      head,
      registrationType,
      reverseCharge: false,
    });

    if (!result.ok) return null;
    return { totals: result, head, supplyType: posResult.supplyType };
  }, [lines, supplierStateCode, customerStateCode, registrationType]);
}
