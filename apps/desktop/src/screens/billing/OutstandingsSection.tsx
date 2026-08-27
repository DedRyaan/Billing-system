// OutstandingsSection — business-scoped view of all open invoices sorted by
// age (oldest first), with drill-down to invoice detail (PAY-04).
//
// Fetches via listOutstandingInvoices (issued + payment_status <> 'paid').
// Each row shows: invoice number, customer name, balance, age in days,
// payment status badge. Clicking navigates to /bills?invoiceId=xxx.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { IndianRupee } from "lucide-react";
import { listOutstandingInvoices } from "@billing/api/payments";
import { keysFor } from "@billing/api/query-keys";
import { serializePaise } from "@billing/gst";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/EmptyState";
import { useAuth } from "../../auth/AuthProvider";
import { useActiveBusiness } from "../../business/ActiveBusinessProvider";

function fmtPaise(amount: number): string {
  const paise = BigInt(Math.round(amount * 100));
  return `₹${serializePaise(paise)}`;
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

export function OutstandingsSection() {
  const auth = useAuth();
  const biz = useActiveBusiness();
  const businessId = biz.activeBusinessId;
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: keysFor.outstandings(businessId ?? "global"),
    queryFn: async () => {
      if (auth.client === null || businessId === null) throw new Error("invariant: no client");
      const res = await listOutstandingInvoices(auth.client, businessId);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    enabled: auth.client !== null && businessId !== null,
  });

  const invoices = useMemo(() => query.data ?? [], [query.data]);

  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={<IndianRupee size={40} aria-hidden="true" />}
        title="No outstanding dues"
        copy="All invoices are fully paid."
      />
    );
  }

  return (
    <div className="flex flex-col gap-xs">
      <h2 className="text-caption text-ink-secondary">Outstanding Dues</h2>
      <div className="flex flex-col gap-xs">
        {invoices.map((inv) => {
          const balance = Number(inv.total_amount) - Number(inv.paid_amount);
          const ageDays = inv.issued_at
            ? Math.floor((Date.now() - new Date(inv.issued_at).getTime()) / 86400000)
            : 0;
          return (
            <button
              key={inv.id}
              type="button"
              onClick={() =>
                navigate({ to: "/bills", search: { invoiceId: inv.id } })
              }
              className="flex items-center justify-between rounded-md border border-hairline bg-surface px-sm py-xs text-left text-body transition-colors cursor-pointer hover:bg-paper"
            >
              <div className="flex flex-col">
                <span className="font-medium">
                  #{inv.seq ?? "\u2014"}
                </span>
                <span className="text-caption text-ink-secondary">
                  {inv.customer_name ?? "No customer"}
                </span>
              </div>
              <div className="flex items-center gap-sm">
                <div className="flex flex-col items-end">
                  <span className="text-caption font-medium">
                    {fmtPaise(balance)}
                  </span>
                  <span className="text-caption text-ink-secondary">
                    {ageDays}d overdue
                  </span>
                </div>
                {paymentStatusBadge(inv.payment_status)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
