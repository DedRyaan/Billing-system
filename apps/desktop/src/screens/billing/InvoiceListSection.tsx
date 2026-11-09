// InvoiceListSection — compact invoice list for context when reissuing (R-51).
//
// Shows recent invoices (drafts, issued, voided) with status badges.
// Compact layout (not full DataTable) since this is context, not the primary view.
// Clicking a draft could open it for editing (future enhancement);
// issued invoices are read-only; voided shown dimmed.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { listInvoicesByBusiness, type InvoiceRow } from "@billing/api/invoices";
import { keysFor } from "@billing/api/query-keys";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { useAuth } from "../../auth/AuthProvider";
import { useActiveBusiness } from "../../business/ActiveBusinessProvider";
import { useBusinessRealtime } from "../../lib/hooks/useBusinessRealtime";
import { formatRupees } from "../../lib/format";

function statusBadgeTone(status: InvoiceRow["status"]): BadgeTone {
  switch (status) {
    case "draft":
      return "accent";
    case "issued":
      return "success";
    case "voided":
      return "danger";
  }
}

const formatTotal = formatRupees;

export interface InvoiceListSectionProps {
  onSelectDraft?: (invoice: InvoiceRow) => void;
}

export function InvoiceListSection({ onSelectDraft }: InvoiceListSectionProps) {
  const auth = useAuth();
  const biz = useActiveBusiness();
  const businessId = biz.activeBusinessId;
  useBusinessRealtime(auth.client, "invoices", businessId);

  const query = useQuery({
    queryKey: keysFor.invoices(businessId ?? "global"),
    queryFn: async () => {
      if (auth.client === null || businessId === null) throw new Error("invariant: no client");
      const res = await listInvoicesByBusiness(auth.client, businessId);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    enabled: auth.client !== null && businessId !== null,
  });

  const invoices = useMemo(() => query.data ?? [], [query.data]);

  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={<FileText size={40} aria-hidden="true" />}
        title="No invoices yet"
        copy="Create your first bill to get started."
      />
    );
  }

  return (
    <div className="flex flex-col gap-xs">
      <h2 className="text-caption text-ink-secondary">Recent Invoices</h2>
      <div className="flex flex-col gap-xs">
        {invoices.map((inv) => (
          <button
            key={inv.id}
            type="button"
            onClick={() => {
              if (inv.status === "draft" && onSelectDraft !== undefined) {
                onSelectDraft(inv);
              }
            }}
            disabled={inv.status !== "draft"}
            className={`flex items-center justify-between rounded-md border border-hairline bg-surface px-sm py-xs text-left text-body transition-colors ${
              inv.status === "draft"
                ? "cursor-pointer hover:bg-paper"
                : "cursor-default opacity-60"
            }`}
          >
            <div className="flex flex-col">
              <span className="font-medium">
                {inv.seq !== null ? `#${inv.seq}` : "Draft"}
              </span>
              <span className="text-caption text-ink-secondary">
                {inv.customer_name ?? "No customer"}
              </span>
            </div>
            <div className="flex items-center gap-sm">
              <span className="text-caption text-ink-secondary">
                {formatTotal(inv.total_amount)}
              </span>
              <Badge tone={statusBadgeTone(inv.status)}>
                {inv.status}
              </Badge>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
