// LineItemsTable — editable inline table for invoice lines (R-43).
//
// All fields are inline-editable: description, HSN/SAC, quantity, unit price,
// discount %, GST rate. Catalog line rates are LOCKED to the catalog item's
// rate (R-43). Ad-hoc lines allow free GST rate selection from CURRENT_SLABS_BPS.
// The line total is computed by useDraftTotals (R-52, no server round-trip).
import { useMemo } from "react";
import { Input } from "../../components/ui/Input";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { Select, type SelectOption } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { CURRENT_SLABS_BPS, bpsToPercentString } from "@billing/gst";
import type { InvoiceTotals } from "@billing/gst";
import type { LineItemDraft } from "./billing-schema";
import { formatPaise } from "../../lib/format";

export interface LineItemsTableProps {
  lines: LineItemDraft[];
  onChange: (lines: LineItemDraft[]) => void;
  onRemoveLine: (id: string) => void;
  onAddLine: () => void;
  onAddCustomLine: () => void;
  totals: InvoiceTotals | null;
  /** Disable all inputs during finalize loading state. */
  disabled?: boolean;
}

const RATE_OPTIONS: ReadonlyArray<SelectOption> = CURRENT_SLABS_BPS.map((bps) => ({
  value: bpsToPercentString(bps),
  label: `${bpsToPercentString(bps)}%`,
}));

export function LineItemsTable({
  lines,
  onChange,
  onRemoveLine,
  onAddLine,
  onAddCustomLine,
  totals,
  disabled = false,
}: LineItemsTableProps) {
  const lineTotals = useMemo(() => {
    if (totals === null) return [];
    return totals.lines.map((lr) => ({
      taxablePaise: lr.taxablePaise,
      taxPaise: lr.taxPaise,
      totalPaise: lr.taxablePaise + lr.taxPaise,
    }));
  }, [totals]);

  const updateLine = (id: string, patch: Partial<LineItemDraft>) => {
    onChange(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="whitespace-nowrap border-b border-hairline text-caption text-ink-secondary">
            <th className="w-8 px-sm py-xs text-center font-medium">#</th>
            <th className="min-w-[14rem] px-sm py-xs text-left font-medium">Description</th>
            <th className="w-[6.5rem] px-sm py-xs text-left font-medium">HSN/SAC</th>
            <th className="w-20 px-sm py-xs text-right font-medium">Qty</th>
            <th className="w-28 px-sm py-xs text-right font-medium">Price (₹)</th>
            <th className="w-20 px-sm py-xs text-right font-medium">Disc %</th>
            <th className="w-24 px-sm py-xs text-left font-medium">GST Rate</th>
            <th className="w-28 whitespace-nowrap px-sm py-xs text-right font-medium">Total (₹)</th>
            <th className="w-10 px-sm py-xs" />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => {
            const lt = lineTotals[idx];
            return (
              <tr key={line.id} className="border-b border-hairline/50">
                <td className="px-sm py-xs text-center text-caption text-ink-secondary">
                  {idx + 1}
                </td>
                <td className="px-sm py-xs">
                  <Input
                    value={line.description}
                    onChange={(e) => updateLine(line.id, { description: e.target.value })}
                    className="h-8 text-sm"
                    disabled={disabled}
                  />
                </td>
                <td className="px-sm py-xs">
                  <Input
                    value={line.hsn_sac ?? ""}
                    onChange={(e) => updateLine(line.id, { hsn_sac: e.target.value })}
                    className="h-8 text-sm font-mono"
                    disabled={disabled}
                  />
                </td>
                <td className="px-sm py-xs">
                  <Input
                    type="number"
                    step="0.001"
                    min="0"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.id, { quantity: Number(e.target.value) })}
                    className="h-8 text-sm text-right"
                    disabled={disabled}
                  />
                </td>
                <td className="px-sm py-xs">
                  <MoneyInput
                    value={String(line.unit_price)}
                    onValueChange={(raw) => updateLine(line.id, { unit_price: Number(raw) || 0 })}
                    className="h-8 text-sm text-right"
                    disabled={disabled}
                  />
                </td>
                <td className="px-sm py-xs">
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    max="50"
                    value={line.discount_pct}
                    onChange={(e) => updateLine(line.id, { discount_pct: Number(e.target.value) })}
                    className="h-8 text-sm text-right"
                    disabled={disabled}
                  />
                </td>
                <td className="px-sm py-xs">
                  <Select
                    value={bpsToPercentString(BigInt(Math.round(line.gst_rate * 100)))}
                    onValueChange={(v) => {
                      const rate = Number(v);
                      updateLine(line.id, { gst_rate: rate });
                    }}
                    options={RATE_OPTIONS}
                    aria-label="GST rate"
                    disabled={disabled}
                  />
                </td>
                <td className="whitespace-nowrap px-sm py-xs text-right text-caption text-ink-secondary">
                  {lt !== undefined
                    ? formatPaise(lt.totalPaise)
                    : "—"}
                </td>
                <td className="px-sm py-xs">
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemoveLine(line.id)}
                      aria-label={`Remove line ${idx + 1}`}
                    >
                      ×
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-sm flex gap-sm">
        <Button type="button" variant="secondary" size="sm" onClick={onAddLine}>
          + Add item
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onAddCustomLine}>
          + Add custom line
        </Button>
      </div>
    </div>
  );
}
