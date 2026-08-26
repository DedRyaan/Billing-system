// GstPreview — live totals display pinned at bottom of bill entry (R-52).
//
// CLIENT-SIDE ONLY — server recomputes at finalize time (R-46) as a safety
// net. All amounts formatted via serializePaise() from @billing/gst for
// consistent integer→decimal display. Round-off line always shown when
// non-zero (INV-08). Supply type shown as Badge.
import { Badge } from "../../components/ui/Badge";
import { serializePaise } from "@billing/gst";
import type { InvoiceTotals, SupplyType } from "@billing/gst";

export interface GstPreviewProps {
  totals: InvoiceTotals | null;
  supplyType: SupplyType | null;
}

function fmtPaise(paise: bigint): string {
  return `₹${serializePaise(paise)}`;
}

export function GstPreview({ totals, supplyType }: GstPreviewProps) {
  if (totals === null) {
    return (
      <div className="rounded-md border border-dashed border-hairline bg-paper px-md py-lg text-center text-caption text-ink-secondary">
        Add line items to see GST preview
      </div>
    );
  }

  return (
    <div className="rounded-md border border-hairline bg-surface px-md py-sm">
      <div className="flex items-center justify-between text-body">
        <span className="text-ink-secondary">Subtotal (taxable value)</span>
        <span className="font-medium">{fmtPaise(totals.subtotalPaise)}</span>
      </div>

      {supplyType === "intra_state" && (
        <>
          <div className="flex items-center justify-between text-body">
            <span className="text-ink-secondary">CGST</span>
            <span>{fmtPaise(totals.lines.reduce((s, l) => s + l.cgstPaise, 0n))}</span>
          </div>
          <div className="flex items-center justify-between text-body">
            <span className="text-ink-secondary">SGST</span>
            <span>{fmtPaise(totals.lines.reduce((s, l) => s + l.sgstOrUtgstPaise, 0n))}</span>
          </div>
        </>
      )}

      {supplyType === "inter_state" && (
        <div className="flex items-center justify-between text-body">
          <span className="text-ink-secondary">IGST</span>
          <span>{fmtPaise(totals.lines.reduce((s, l) => s + l.igstPaise, 0n))}</span>
        </div>
      )}

      {totals.roundOffPaise !== 0n && (
        <div className="flex items-center justify-between text-body">
          <span className="text-ink-secondary">Round Off</span>
          <span>{fmtPaise(totals.roundOffPaise)}</span>
        </div>
      )}

      <div className="mt-xs flex items-center justify-between border-t border-hairline pt-xs text-body font-semibold">
        <span>Total</span>
        <span>{fmtPaise(totals.grandTotalPaise)}</span>
      </div>

      {supplyType !== null && (
        <div className="mt-xs">
          <Badge tone={supplyType === "intra_state" ? "accent" : "warning"}>
            {supplyType === "intra_state" ? "Intra-state (CGST+SGST)" : "Inter-state (IGST)"}
          </Badge>
        </div>
      )}
    </div>
  );
}
