// BillEntryScreen — full-page bill entry composition (R-40).
//
// Replaces the /bills PlaceholderScreen with a functional drafting interface.
// Layout: HeaderRow → CustomerPicker → LineItemsTable → GstPreview → Action bar.
// Draft state in React useState (R-49, D-82 — no DB persistence in v1).
// Data fetching: listCustomersByBusiness + listCatalogItems via React Query.
// Line operations: add from catalog, add custom ad-hoc, update, remove.
// Finalize wired: creates draft → finalizeInvoice() → InvoiceDetail view.
// Void-and-reissue: admin-only void → replacement draft pre-populated (INV-06).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import {
  listCustomersByBusiness,
  type CustomerRow,
} from "@billing/api/customers";
import { listCatalogItems, type CatalogItemRow } from "@billing/api/catalog-items";
import {
  createDraftInvoice,
  finalizeInvoice,
  getInvoice,
  type InvoiceRow,
  type InvoiceLineRow,
} from "@billing/api/invoices";
import { keysFor } from "@billing/api/query-keys";
import { deriveFinancialYear } from "@billing/gst";
import { HeaderRow } from "../../shell/HeaderRow";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../auth/AuthProvider";
import { useActiveBusiness } from "../../business/ActiveBusinessProvider";
import { useOnlineStatus } from "../../shell/OfflineBanner";
import { showToast } from "../../shell/toast-store";
import { CustomerPicker } from "./CustomerPicker";
import { ItemPicker } from "./ItemPicker";
import { LineItemsTable } from "./LineItemsTable";
import { GstPreview } from "./GstPreview";
import { useDraftTotals } from "./useDraftTotals";
import { InvoiceDetail } from "./InvoiceDetail";
import { VoidDialog } from "./VoidDialog";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
import type { LineItemDraft } from "./billing-schema";

let lineIdSeq = 0;
function nextLineId(): string {
  return `line-${++lineIdSeq}-${Date.now()}`;
}

function createEmptyLine(): LineItemDraft {
  return {
    id: nextLineId(),
    catalog_item_id: null,
    description: "",
    hsn_sac: undefined,
    quantity: 1,
    unit_price: 0,
    discount_pct: 0,
    gst_rate: 18,
    unit: "nos",
  };
}

function lineFromCatalogItem(item: CatalogItemRow): LineItemDraft {
  return {
    id: nextLineId(),
    catalog_item_id: item.id,
    description: item.name,
    hsn_sac: item.hsn_sac ?? undefined,
    quantity: 1,
    unit_price: Number(item.price),
    discount_pct: 0,
    gst_rate: Number(item.gst_rate),
    unit: item.unit ?? "nos",
  };
}

type ScreenView =
  | { kind: "draft" }
  | { kind: "detail"; invoice: InvoiceRow; lines: InvoiceLineRow[] };

export function BillEntryScreen() {
  // Deep-link (real route): /bills?invoiceId=xxx opens InvoiceDetail directly.
  // Tests mount this screen directly without a RouterProvider, where useSearch()
  // dereferences a null router and throws. Render a router-aware host only when
  // a router is actually mounted; fall back to a plain body with no deep-link.
  const router = useRouter({ warn: false });
  if (!router) return <BillEntryContent />;
  return <RouterDeepLinkHost />;
}

function RouterDeepLinkHost() {
  const { invoiceId } = useSearch({ strict: false }) as { invoiceId?: string };
  return <BillEntryContent targetInvoiceId={invoiceId} />;
}

interface BillEntryContentProps {
  targetInvoiceId?: string | undefined;
}

function BillEntryContent({ targetInvoiceId }: BillEntryContentProps) {
  const auth = useAuth();
  const biz = useActiveBusiness();
  const online = useOnlineStatus();
  const queryClient = useQueryClient();

  const [lines, setLines] = useState<LineItemDraft[]>(() => [createEmptyLine()]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [view, setView] = useState<ScreenView>({ kind: "draft" });
  const [finalizing, setFinalizing] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);

  const businessId = biz.activeBusinessId;

  // When deep-linked, fetch the target invoice and switch to detail view.
  useEffect(() => {
    if (targetInvoiceId === undefined || auth.client === null || businessId === null) return;
    let cancelled = false;
    (async () => {
      const res = await getInvoice(auth.client!, targetInvoiceId, businessId!);
      if (cancelled || !res.ok) return;
      setView({ kind: "detail", invoice: res.data, lines: res.data.invoice_lines });
    })();
    return () => {
      cancelled = true;
    };
  }, [targetInvoiceId, auth.client, businessId]);

  // --- Data fetching ---
  const customerQuery = useQuery({
    queryKey: keysFor.customers(businessId ?? "global"),
    queryFn: async () => {
      if (auth.client === null || businessId === null) throw new Error("invariant: no client");
      const res = await listCustomersByBusiness(auth.client, businessId);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    enabled: auth.client !== null && businessId !== null,
  });

  const itemQuery = useQuery({
    queryKey: keysFor.catalogItems(businessId ?? "global"),
    queryFn: async () => {
      if (auth.client === null || businessId === null) throw new Error("invariant: no client");
      const res = await listCatalogItems(auth.client, businessId);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    enabled: auth.client !== null && businessId !== null,
  });

  const customers = useMemo(() => customerQuery.data ?? [], [customerQuery.data]);
  const catalogItems = useMemo(() => itemQuery.data ?? [], [itemQuery.data]);

  // --- POS / GST computation inputs ---
  const supplierStateCode = biz.activeBusiness?.state ?? null;
  const customerStateCode = selectedCustomer?.state ?? null;
  const registrationType = (biz.activeBusiness?.registration_type as "regular" | "composition") ?? "regular";

  const draftResult = useDraftTotals(lines, supplierStateCode, customerStateCode, registrationType);

  // --- Line operations ---
  const addLineFromCatalog = useCallback(
    (item: CatalogItemRow) => {
      setLines((prev) => [...prev, lineFromCatalogItem(item)]);
    },
    [],
  );

  const addCustomLine = useCallback(() => {
    setLines((prev) => [...prev, createEmptyLine()]);
  }, []);

  const removeLine = useCallback((id: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)));
  }, []);

  // --- Dirty state ---
  const isDirty = lines.some(
    (l) =>
      l.description !== "" ||
      l.unit_price !== 0 ||
      l.discount_pct !== 0 ||
      l.quantity !== 1,
  ) || selectedCustomer !== null;

  // --- Navigation guard ---
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // --- Customer selection ---
  const handleCustomerSelect = useCallback((customer: CustomerRow | null) => {
    setSelectedCustomer(customer);
  }, []);

  const handleCustomerCreateNew = useCallback((_name: string) => {
    // CustomerSheet for inline creation wired in a future plan.
  }, []);

  // --- Finalize flow ---
  const handleFinalize = useCallback(async () => {
    if (auth.client === null || businessId === null || finalizing) return;

    // Validate: at least one line with description
    const validLines = lines.filter((l) => l.description.trim() !== "" && l.quantity > 0);
    if (validLines.length === 0) {
      showToast({ variant: "error", message: "Add at least one line item with a description" });
      return;
    }

    // Create draft invoice first (for the server to reference)
    const fyResult = deriveFinancialYear(new Date().toISOString().slice(0, 10));
    if (!fyResult.ok) {
      showToast({ variant: "error", message: "Could not determine financial year" });
      return;
    }

    setFinalizing(true);
    try {
      const draftRes = await createDraftInvoice(auth.client, businessId, {
        fy: fyResult.fy,
        customer_id: selectedCustomer?.id ?? null,
      });
      if (!draftRes.ok) {
        showToast({ variant: "error", message: `Failed to create draft: ${draftRes.error.message}` });
        return;
      }

      const invoiceId = draftRes.data.id;

      // Finalize
      const result = await finalizeInvoice(auth.client, invoiceId, businessId);
      if (!result.ok) {
        showToast({ variant: "error", message: `Finalize failed: ${result.error.message}` });
        return;
      }

      // Invalidate caches
      await queryClient.invalidateQueries({
        queryKey: keysFor.invoices(businessId),
      });

      showToast({
        variant: "success",
        message: `Invoice ${result.data.doc_number} finalized successfully`,
      });

      // Fetch the finalized invoice detail and show it
      const detailRes = await getInvoice(auth.client, result.data.invoice_id, businessId);
      if (detailRes.ok) {
        setView({
          kind: "detail",
          invoice: detailRes.data,
          lines: detailRes.data.invoice_lines,
        });
      }
    } catch (err) {
      showToast({
        variant: "error",
        message: err instanceof Error ? `Finalize failed: ${err.message}` : "Finalize failed",
      });
    } finally {
      setFinalizing(false);
    }
  }, [auth.client, businessId, finalizing, lines, selectedCustomer, queryClient]);

  // --- Void flow ---
  const handleVoided = useCallback(
    async (newDraftId: string) => {
      if (auth.client === null || businessId === null) return;

      // Fetch the new draft invoice + lines
      const res = await getInvoice(auth.client, newDraftId, businessId);
      if (!res.ok) {
        showToast({ variant: "error", message: "Failed to load replacement draft" });
        return;
      }

      const draftLines = res.data.invoice_lines;

      // Pre-populate lines from voided invoice
      const populatedLines: LineItemDraft[] = draftLines.map((dl) => ({
        id: nextLineId(),
        catalog_item_id: dl.catalog_item_id ?? null,
        description: dl.description,
        hsn_sac: dl.hsn_sac ?? undefined,
        quantity: dl.quantity,
        unit_price: Number(dl.unit_price_charged),
        discount_pct: Number(dl.discount_pct),
        gst_rate: Number(dl.gst_rate),
        unit: "nos",
      }));

      setLines(populatedLines.length > 0 ? populatedLines : [createEmptyLine()]);
      setView({ kind: "draft" });
      showToast({
        variant: "success",
        message: "Draft created from voided invoice. Review and finalize.",
      });
    },
    [auth.client, businessId],
  );

  const handlePaymentRecorded = useCallback(async (invoiceId: string) => {
    if (auth.client === null || businessId === null) return;
    const res = await getInvoice(auth.client, invoiceId, businessId);
    if (!res.ok) {
      showToast({ variant: "error", message: "Payment recorded, but invoice refresh failed. Reopen the invoice to refresh." });
      return;
    }
    setView((current) => current.kind === "detail" && current.invoice.id === invoiceId
      && current.invoice.business_id === businessId
      ? { kind: "detail", invoice: res.data, lines: res.data.invoice_lines }
      : current);
  }, [auth.client, businessId]);

  // --- Handle new bill ---
  const handleNewBill = useCallback(() => {
    setLines([createEmptyLine()]);
    setSelectedCustomer(null);
    setView({ kind: "draft" });
  }, []);

  // --- Handle back from detail view ---
  const handleBack = useCallback(() => {
    setLines([createEmptyLine()]);
    setSelectedCustomer(null);
    setView({ kind: "draft" });
  }, []);

  // --- Detail view ---
  if (view.kind === "detail") {
    const isAdmin = auth.role === "admin" || auth.role === "super_admin";
    return (
      <>
        <HeaderRow title="Invoice" />
        <InvoiceDetail
          invoice={view.invoice}
          lines={view.lines}
          onNewBill={handleNewBill}
          onBack={handleBack}
          {...(isAdmin ? { onVoid: () => setVoidDialogOpen(true) } : {})}
          {...(view.invoice.status === "issued" && view.invoice.payment_status !== "paid"
            ? { onRecordPayment: () => setRecordPaymentOpen(true) }
            : {})}
        />
        {isAdmin && (
          <VoidDialog
            open={voidDialogOpen}
            onOpenChange={setVoidDialogOpen}
            invoiceId={view.invoice.id}
            invoiceDocNumber={view.invoice.seq !== null ? `#${view.invoice.seq}` : "Draft"}
            businessId={businessId ?? ""}
            onVoided={handleVoided}
          />
        )}
        <RecordPaymentDialog
          open={recordPaymentOpen}
          onOpenChange={setRecordPaymentOpen}
          invoiceId={view.invoice.id}
          invoiceDocNumber={view.invoice.seq !== null ? `#${view.invoice.seq}` : "Draft"}
          businessId={businessId ?? ""}
          balance={Number(view.invoice.total_amount) - Number(view.invoice.paid_amount)}
          paymentStatus={view.invoice.payment_status}
          invoiceStatus={view.invoice.status}
          onRecorded={handlePaymentRecorded}
        />
      </>
    );
  }

  // --- Draft view ---
  return (
    <>
      <HeaderRow title="New Bill" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-lg py-lg">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-md">
          {/* Customer picker */}
          <div>
            <label htmlFor="customer-picker" className="mb-xs block text-caption text-ink-secondary">
              Customer
            </label>
            <CustomerPicker
              customers={customers}
              selected={selectedCustomer}
              onSelect={handleCustomerSelect}
              onCreateNew={handleCustomerCreateNew}
              disabled={!online}
              placeholder="Search customer…"
            />
          </div>

          {/* Line items table */}
          <div>
            <h2 className="mb-xs text-caption text-ink-secondary">Line Items</h2>
            <LineItemsTable
              lines={lines}
              onChange={setLines}
              onRemoveLine={removeLine}
              onAddLine={() => {
                addCustomLine();
              }}
              onAddCustomLine={addCustomLine}
              totals={draftResult?.totals ?? null}
              disabled={finalizing}
            />
          </div>

          {/* Item picker for adding from catalog */}
          <div>
            <label htmlFor="item-picker" className="mb-xs block text-caption text-ink-secondary">
              Quick add from catalog
            </label>
            <ItemPicker
              items={catalogItems}
              onSelect={addLineFromCatalog}
              disabled={!online || catalogItems.length === 0 || finalizing}
              placeholder={catalogItems.length === 0 ? "No catalog items" : "Search catalog item…"}
            />
          </div>

          {/* GST Preview */}
          <GstPreview totals={draftResult?.totals ?? null} supplyType={draftResult?.supplyType ?? null} />

          {/* Action bar */}
          <div className="flex items-center gap-sm border-t border-hairline pt-md">
            <Button
              variant="primary"
              size="lg"
              onClick={handleFinalize}
              loading={finalizing}
              disabled={!online || lines.length === 0 || draftResult === null || finalizing}
            >
              {finalizing ? "Finalizing…" : "Finalize"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setLines([createEmptyLine()]);
                setSelectedCustomer(null);
              }}
              disabled={!isDirty || finalizing}
            >
              Discard
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
