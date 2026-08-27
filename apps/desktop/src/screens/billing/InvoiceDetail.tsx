// InvoiceDetail — read-only view for issued/voided invoices (INV-04, INV-05).
//
// Displayed after finalize success or when viewing an existing issued/voided
// invoice from InvoiceListSection. Shows all Rule 46 particulars: both
// GSTINs, HSN/SAC, tax breakup, place of supply, reverse-charge indicator.
// Issued invoices are fully immutable (INV-05). Voided invoices show the
// void reason and consumed number permanently.
import { serializePaise } from "@billing/gst";
import type { InvoiceRow, InvoiceLineRow } from "@billing/api/invoices";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";

export interface InvoiceDetailProps {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  /** Admin-only void handler — omitted for staff role. */
  onVoid?: () => void;
  onNewBill?: () => void;
  onBack?: () => void;
}

function fmtPaise(amount: number): string {
  const paise = BigInt(Math.round(amount * 100));
  return `₹${serializePaise(paise)}`;
}

function statusBadge(status: InvoiceRow["status"]) {
  switch (status) {
    case "issued":
      return <Badge tone="success">Issued</Badge>;
    case "voided":
      return <Badge tone="danger">Voided</Badge>;
    case "draft":
      return <Badge tone="accent">Draft</Badge>;
  }
}

function paymentStatusBadge(status: string) {
  switch (status) {
    case "paid":
      return <Badge tone="success">Paid</Badge>;
    case "partial":
      return <Badge tone="warning">Partial</Badge>;
    case "unpaid":
      return <Badge tone="danger">Unpaid</Badge>;
    default:
      return null;
  }
}

export function InvoiceDetail({
  invoice,
  lines,
  onVoid,
  onNewBill,
  onBack,
}: InvoiceDetailProps) {
  const sortedLines = [...lines].sort((a, b) => a.position - b.position);

  const totalCgst = lines.reduce((s, l) => s + Number(l.cgst_amount), 0);
  const totalSgst = lines.reduce((s, l) => s + Number(l.sgst_amount), 0);
  const totalIgst = lines.reduce((s, l) => s + Number(l.igst_amount), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-lg py-lg">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-md">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-sm">
            <h1 className="text-heading text-ink">
              {invoice.seq !== null ? `Invoice #${invoice.seq}` : "Draft Invoice"}
            </h1>
            {statusBadge(invoice.status)}
            {invoice.status === "issued" && paymentStatusBadge(invoice.payment_status)}
          </div>
          <span className="text-caption text-ink-secondary">
            {invoice.issued_at
              ? new Date(invoice.issued_at).toLocaleDateString("en-IN")
              : invoice.created_at
                ? new Date(invoice.created_at).toLocaleDateString("en-IN")
                : ""}
          </span>
        </div>

        {/* Buyer section */}
        <div className="rounded-md border border-hairline bg-surface px-md py-sm">
          <h2 className="mb-xs text-caption font-semibold text-ink-secondary">Buyer</h2>
          <p className="text-body font-medium text-ink">{invoice.customer_name ?? "No customer"}</p>
          {invoice.customer_gstin && (
            <p className="text-caption text-ink-secondary">GSTIN: {invoice.customer_gstin}</p>
          )}
          {!invoice.customer_gstin && (
            <p className="text-caption text-ink-secondary">Unregistered</p>
          )}
          {invoice.customer_address && (
            <p className="text-caption text-ink-secondary">
              {JSON.stringify(invoice.customer_address)}
            </p>
          )}
        </div>

        {/* Line items table — read-only */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="border-b border-hairline text-caption text-ink-secondary">
                <th className="w-8 px-sm py-xs text-center font-medium">#</th>
                <th className="px-sm py-xs text-left font-medium">Description</th>
                <th className="w-24 px-sm py-xs text-left font-medium">HSN/SAC</th>
                <th className="w-20 px-sm py-xs text-right font-medium">Qty</th>
                <th className="w-28 px-sm py-xs text-right font-medium">Price</th>
                <th className="w-20 px-sm py-xs text-right font-medium">Disc %</th>
                <th className="w-24 px-sm py-xs text-left font-medium">GST Rate</th>
                <th className="w-28 px-sm py-xs text-right font-medium">Taxable</th>
                <th className="w-28 px-sm py-xs text-right font-medium">Tax</th>
              </tr>
            </thead>
            <tbody>
              {sortedLines.map((line) => (
                <tr key={line.id} className="border-b border-hairline/50">
                  <td className="px-sm py-xs text-center text-caption text-ink-secondary">
                    {line.position}
                  </td>
                  <td className="px-sm py-xs text-body">{line.description}</td>
                  <td className="px-sm py-xs font-mono text-caption">{line.hsn_sac ?? "—"}</td>
                  <td className="px-sm py-xs text-right text-caption">{line.quantity}</td>
                  <td className="px-sm py-xs text-right text-caption">
                    {fmtPaise(Number(line.unit_price_charged))}
                  </td>
                  <td className="px-sm py-xs text-right text-caption">{line.discount_pct}%</td>
                  <td className="px-sm py-xs text-caption">{line.gst_rate}%</td>
                  <td className="px-sm py-xs text-right text-caption">
                    {fmtPaise(Number(line.taxable_value))}
                  </td>
                  <td className="px-sm py-xs text-right text-caption">
                    {fmtPaise(Number(line.cgst_amount) + Number(line.sgst_amount) + Number(line.igst_amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="rounded-md border border-hairline bg-surface px-md py-sm">
          <div className="flex items-center justify-between text-body">
            <span className="text-ink-secondary">Subtotal</span>
            <span>{fmtPaise(Number(invoice.subtotal_amount))}</span>
          </div>

          {invoice.supply_type === "intra_state" && (
            <>
              <div className="flex items-center justify-between text-body">
                <span className="text-ink-secondary">CGST</span>
                <span>{fmtPaise(totalCgst)}</span>
              </div>
              <div className="flex items-center justify-between text-body">
                <span className="text-ink-secondary">SGST</span>
                <span>{fmtPaise(totalSgst)}</span>
              </div>
            </>
          )}

          {invoice.supply_type === "inter_state" && (
            <div className="flex items-center justify-between text-body">
              <span className="text-ink-secondary">IGST</span>
              <span>{fmtPaise(totalIgst)}</span>
            </div>
          )}

          {invoice.round_off_amount !== 0 && (
            <div className="flex items-center justify-between text-body">
              <span className="text-ink-secondary">Round Off</span>
              <span>{fmtPaise(Number(invoice.round_off_amount))}</span>
            </div>
          )}

          <div className="mt-xs flex items-center justify-between border-t border-hairline pt-xs text-body font-semibold">
            <span>Total</span>
            <span>{fmtPaise(Number(invoice.total_amount))}</span>
          </div>

          <div className="mt-xs flex items-center gap-sm">
            {invoice.supply_type && (
              <Badge tone={invoice.supply_type === "intra_state" ? "accent" : "warning"}>
                {invoice.supply_type === "intra_state" ? "Intra-state (CGST+SGST)" : "Inter-state (IGST)"}
              </Badge>
            )}
            {invoice.reverse_charge && (
              <Badge tone="warning">Reverse Charge</Badge>
            )}
          </div>
        </div>

        {/* Payment balance (issued only) — derived from trigger-maintained
            paid_amount, never computed optimistically (T-05-09). */}
        {invoice.status === "issued" && (
          <div className="rounded-md border border-hairline bg-surface px-md py-sm">
            <div className="flex items-center justify-between text-body">
              <span className="text-ink-secondary">Paid</span>
              <span>{fmtPaise(Number(invoice.paid_amount))}</span>
            </div>
            <div className="mt-xs flex items-center justify-between border-t border-hairline pt-xs text-body font-semibold">
              <span>Balance Due</span>
              <span>{fmtPaise(Number(invoice.total_amount) - Number(invoice.paid_amount))}</span>
            </div>
            <div className="mt-xs flex items-center gap-sm">
              {paymentStatusBadge(invoice.payment_status)}
            </div>
          </div>
        )}

        {/* Void details */}
        {invoice.status === "voided" && (
          <div className="rounded-md border border-danger/30 bg-danger-subtle px-md py-sm">
            <h2 className="mb-xs text-caption font-semibold text-danger">Void Details</h2>
            {invoice.void_reason && (
              <p className="text-body text-ink">Reason: {invoice.void_reason}</p>
            )}
            {invoice.voided_at && (
              <p className="text-caption text-ink-secondary">
                Voided on {new Date(invoice.voided_at).toLocaleDateString("en-IN")}
              </p>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-sm border-t border-hairline pt-md">
          {onBack && (
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
          )}
          {onNewBill && (
            <Button variant="primary" onClick={onNewBill}>
              New Bill
            </Button>
          )}
          {onVoid && invoice.status === "issued" && (
            <Button variant="danger" onClick={onVoid}>
              Void
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
