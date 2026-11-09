// BillHistoryScreen — every numbered bill of the active business (issued +
// voided), newest first, at /bills/history inside the Bills nav section
// (D-66 nav slots stay untouched; the section stays lit by prefix match).
//
// Keyset "Load more" paging (listBillHistoryPage) keeps the list complete past
// the PostgREST row cap. Search matches a bill number exactly or the buyer
// name. Live sync: invoice/payment changes from any device invalidate the
// invoices prefix, which refetches every loaded page. Rows open the bill in
// bill entry's detail view via /bills?invoiceId=… (same door as Outstandings).
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import {
  listBillHistoryPage,
  type BillHistoryCursor,
  type BillHistoryStatus,
  type InvoiceRow,
} from "@billing/api/invoices";
import { keysFor } from "@billing/api/query-keys";
import { serializePaise } from "@billing/gst";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState, ErrorState } from "../../components/ui/EmptyState";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { HeaderRow } from "../../shell/HeaderRow";
import { useAuth } from "../../auth/AuthProvider";
import { useActiveBusiness } from "../../business/ActiveBusinessProvider";
import { useBusinessRealtime } from "../../lib/hooks/useBusinessRealtime";

const STATUS_OPTIONS = [
  { value: "all", label: "All bills" },
  { value: "issued", label: "Issued" },
  { value: "voided", label: "Voided" },
] as const;

const SEARCH_DEBOUNCE_MS = 250;

function fmtRupees(amount: number): string {
  return `₹${serializePaise(BigInt(Math.round(Number(amount) * 100)))}`;
}

function statusBadge(inv: InvoiceRow) {
  if (inv.status === "voided") return <Badge tone="danger">Voided</Badge>;
  switch (inv.payment_status) {
    case "paid":
      return <Badge tone="success">Paid</Badge>;
    case "partial":
      return <Badge tone="warning">Partial</Badge>;
    default:
      return <Badge tone="neutral">Unpaid</Badge>;
  }
}

export interface BillHistoryScreenProps {
  onOpenBill: (invoiceId: string) => void;
  onNewBill: () => void;
}

export function BillHistoryScreen({ onOpenBill, onNewBill }: BillHistoryScreenProps) {
  const auth = useAuth();
  const biz = useActiveBusiness();
  const businessId = biz.activeBusinessId;
  useBusinessRealtime(auth.client, "invoices", businessId);
  useBusinessRealtime(auth.client, "payments", businessId);

  const [status, setStatus] = useState<BillHistoryStatus>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useInfiniteQuery({
    queryKey: keysFor.invoices(businessId ?? "global", "history", status, search),
    initialPageParam: null as BillHistoryCursor | null,
    queryFn: async ({ pageParam }) => {
      if (auth.client === null || businessId === null) throw new Error("invariant: no client");
      const res = await listBillHistoryPage(auth.client, businessId, {
        status,
        search,
        cursor: pageParam,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: auth.client !== null && businessId !== null,
  });

  const bills = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
  const filtered = status !== "all" || search !== "";

  let body;
  if (query.isPending) {
    body = <p className="text-caption text-ink-secondary">Loading bills…</p>;
  } else if (query.isError) {
    body = <ErrorState entity="bills" onRetry={() => void query.refetch()} />;
  } else if (bills.length === 0) {
    body = filtered ? (
      <EmptyState
        icon={<FileText size={40} aria-hidden="true" />}
        title="No matching bills"
        copy="Try a different bill number, customer name or status."
      />
    ) : (
      <EmptyState
        icon={<FileText size={40} aria-hidden="true" />}
        title="No bills yet"
        copy="Finalized bills for this business will appear here."
        cta={{ label: "New bill", onClick: onNewBill }}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-xs">
        <ul className="flex flex-col gap-xs" aria-label="Bills">
          {bills.map((inv) => {
            const balance = Number(inv.total_amount) - Number(inv.paid_amount);
            return (
              <li key={inv.id}>
                <button
                  type="button"
                  onClick={() => onOpenBill(inv.id)}
                  className={`flex w-full cursor-pointer flex-wrap items-center justify-between gap-sm rounded-md border border-hairline bg-surface px-sm py-xs text-left text-body transition-colors hover:bg-paper ${
                    inv.status === "voided" ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">#{inv.seq ?? "—"}</span>
                    <span className="truncate text-caption text-ink-secondary">
                      {inv.customer_name ?? "Walk-in customer"}
                    </span>
                    <span className="text-caption text-ink-secondary">
                      {inv.issued_at ? new Date(inv.issued_at).toLocaleDateString("en-IN") : "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-sm">
                    <div className="flex flex-col items-end">
                      <span className="text-caption font-medium">{fmtRupees(inv.total_amount)}</span>
                      {inv.status === "issued" && balance > 0 && (
                        <span className="text-caption text-ink-secondary">Due {fmtRupees(balance)}</span>
                      )}
                    </div>
                    {statusBadge(inv)}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        {query.hasNextPage && (
          <div className="flex justify-center pt-sm">
            <Button
              variant="secondary"
              onClick={() => void query.fetchNextPage()}
              loading={query.isFetchingNextPage}
              disabled={query.isFetchingNextPage}
            >
              Load more
            </Button>
          </div>
        )}
        {query.isFetchNextPageError && (
          <p role="alert" className="text-center text-caption text-ink-secondary">
            Couldn’t load more bills. Try again.
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <HeaderRow
        title="All Bills"
        actions={
          <Button onClick={onNewBill} leadingIcon={<Plus size={16} aria-hidden="true" />}>
            New bill
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-lg py-lg">
        <div className="mx-auto flex w-full max-w-[48rem] flex-col gap-md">
          <div className="flex flex-wrap gap-sm">
            <div className="min-w-[12rem] flex-1">
              <Input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search bill number or customer…"
                aria-label="Search bills"
              />
            </div>
            <div className="w-40">
              <Select
                aria-label="Bill status"
                value={status}
                onValueChange={(v) => setStatus(v as BillHistoryStatus)}
                options={STATUS_OPTIONS}
              />
            </div>
          </div>
          {body}
        </div>
      </div>
    </>
  );
}
