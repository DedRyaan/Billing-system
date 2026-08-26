// BillEntryScreen — full-page bill entry composition (R-40).
//
// Replaces the /bills PlaceholderScreen with a functional drafting interface.
// Layout: HeaderRow → CustomerPicker → LineItemsTable → GstPreview → Action bar.
// Draft state in React useState (R-49, D-82 — no DB persistence in v1).
// Data fetching: listCustomersByBusiness + listCatalogItems via React Query.
// Line operations: add from catalog, add custom ad-hoc, update, remove.
// Finalize button is rendered but wired in a later plan (05).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listCustomersByBusiness, type CustomerRow } from "@billing/api/customers";
import { listCatalogItems, type CatalogItemRow } from "@billing/api/catalog-items";
import { keysFor } from "@billing/api/query-keys";
import { HeaderRow } from "../../shell/HeaderRow";
import { Button } from "../../components/ui/Button";
import { useAuth } from "../../auth/AuthProvider";
import { useActiveBusiness } from "../../business/ActiveBusinessProvider";
import { useOnlineStatus } from "../../shell/OfflineBanner";
import { CustomerPicker } from "./CustomerPicker";
import { ItemPicker } from "./ItemPicker";
import { LineItemsTable } from "./LineItemsTable";
import { GstPreview } from "./GstPreview";
import { useDraftTotals } from "./useDraftTotals";
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

export function BillEntryScreen() {
  const auth = useAuth();
  const biz = useActiveBusiness();
  const online = useOnlineStatus();

  const [lines, setLines] = useState<LineItemDraft[]>(() => [createEmptyLine()]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);

  const businessId = biz.activeBusinessId;

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

  // --- Finalize placeholder ---
  const handleFinalize = useCallback(() => {
    // Wired in Plan 05 — finalize-invoice Edge Function call.
  }, []);

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
                // Open item picker by adding a line then letting user interact
                // For simplicity, just add a custom line with a search prompt
                addCustomLine();
              }}
              onAddCustomLine={addCustomLine}
              totals={draftResult?.totals ?? null}
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
              disabled={!online || catalogItems.length === 0}
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
              disabled={!online || lines.length === 0 || draftResult === null}
            >
              Finalize
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setLines([createEmptyLine()]);
                setSelectedCustomer(null);
              }}
              disabled={!isDirty}
            >
              Discard
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
