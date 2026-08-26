// CatalogScreen - S6 assembly (plan 03-09 Task 3, MSTR-04/D-75).
// Admins edit; staff browse read-only (rows open a detail-only sheet -
// hiding is courtesy, RLS enforces). Rate labels come from
// bpsToPercentString over the stored numeric percent (engine canonical).
// Inactive items stay visible-but-muted: honest inventory truth, no filter
// toggle exists in the spec (choice documented inline per plan).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package } from "lucide-react";
import type { CatalogItemRow } from "@billing/api/catalog-items";
import {
  createCatalogItem,
  deactivateItem,
  listCatalogItems,
  updateCatalogItem,
} from "@billing/api/catalog-items";
import { keysFor } from "@billing/api/query-keys";
import { bpsToPercentString, parseDecimalToPaise, serializePaise } from "@billing/gst";
import { DataTable, type DataTableColumn } from "../../components/ui/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { Button } from "../../components/ui/Button";
import { HeaderRow } from "../../shell/HeaderRow";
import { useAuth } from "../../auth/AuthProvider";
import { useActiveBusiness } from "../../business/ActiveBusinessProvider";
import { OFFLINE_CTA_TOOLTIP, useOnlineStatus } from "../../shell/OfflineBanner";
import { showMutationFailure } from "../../shell/toast-store";
import { useBusinessRealtime } from "../../lib/hooks/useBusinessRealtime";
import { CTA_ADD_ITEM } from "../../lib/strings/global";
import {
  COL_CODE,
  COL_ITEM,
  COL_MRP,
  COL_PRICE,
  COL_RATE,
  COL_STOCK,
  COL_UNIT,
  CATALOG_SCREEN_TITLE,
  CTA_ADD_ITEM as CTA_LABEL,
  EMPTY_BODY,
  EMPTY_TITLE,
  SEARCH_PLACEHOLDER,
} from "../../lib/strings/catalog";
import { ItemSheet } from "./ItemSheet";
import type { NormalizedCatalogItem } from "./catalog-schema";

/** en-IN grouped rupees from a DB numeric string ("1499.50" -> "₹1,499.50"). */
function groupIndian(intStr: string): string {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  const rest = intStr.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}

export function formatRupees(numeric: string): string {
  const parsed = parseDecimalToPaise(numeric);
  if (!parsed.ok) return `₹${numeric}`;
  const s = serializePaise(parsed.paise);
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const dotIdx = body.indexOf(".");
  const whole = dotIdx === -1 ? body : body.slice(0, dotIdx);
  const frac = dotIdx === -1 ? "00" : body.slice(dotIdx + 1).padEnd(2, "0");
  return `${neg ? "-" : ""}₹${groupIndian(whole)}.${frac}`;
}

/** numeric percent ("5"/"0.25"/"18.00") -> canonical bps -> "5%" label. */
function parsePercentToBps(percent: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(percent.trim());
  if (m === null) return null;
  const whole = BigInt(m[1] ?? "0");
  const fracRaw = (m[2] ?? "").padEnd(2, "0");
  return whole * 100n + BigInt(fracRaw.length > 0 ? fracRaw : "0");
}

function rateLabel(item: CatalogItemRow): string {
  const bps = parsePercentToBps(String(item.gst_rate));
  return bps === null ? `${String(item.gst_rate)}%` : `${bpsToPercentString(bps)}%`;
}

interface RowVM {
  id: string;
  name: string;
  code: string;
  rate_label: string;
  unit: string;
  price_label: string;
  mrp_label: string;
  stock_label: string;
}

const canEditCatalog = (role: string | null): boolean =>
  role === "admin" || role === "super_admin";

export function CatalogScreen() {
  const auth = useAuth();
  const biz = useActiveBusiness();
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const editableRole = canEditCatalog(auth.role);
  const readOnlyContext = biz.isArchived;

  const [sheet, setSheet] = useState<
    | { mode: "create" }
    | { mode: "edit"; row: CatalogItemRow }
    | { mode: "detail"; row: CatalogItemRow }
    | null
  >(null);

  const businessId = biz.activeBusinessId;
  const listingKey = keysFor.catalogItems(businessId ?? "global");

  const listing = useQuery({
    queryKey: listingKey,
    queryFn: async () => {
      const res = await listCatalogItems(auth.client!, businessId!);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    enabled: auth.client !== null && businessId !== null,
  });

  useBusinessRealtime(auth.client, "catalog_items", businessId);

  const rows = useMemo<CatalogItemRow[]>(() => listing.data ?? [], [listing.data]);

  const vms = useMemo<RowVM[]>(
    () =>
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.hsn_sac ?? "—",
        rate_label: rateLabel(r),
        unit: r.unit,
        price_label: formatRupees(String(r.price)),
        mrp_label: r.mrp === null ? "—" : formatRupees(String(r.mrp)),
        stock_label: String(r.stock_qty),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows],
  );

  const saveMutation = useMutation({
    mutationFn: async ({ values, editingId }: { values: NormalizedCatalogItem; editingId?: string }) => {
      const res =
        editingId === undefined
          ? await createCatalogItem(auth.client!, businessId!, {
              name: values.name,
              kind: values.kind,
              ...(values.hsnSac !== null ? { hsnSac: values.hsnSac } : {}),
              gstRateBps: values.gstRateBps,
              unit: values.unit,
              pricePaise: values.pricePaise,
              mrpPaise: values.mrpPaise,
              stockQty: values.stockQty,
            })
          : await updateCatalogItem(auth.client!, {
              id: editingId,
              businessId: businessId!,
              patch: {
                name: values.name,
                ...(values.hsnSac !== null ? { hsnSac: values.hsnSac } : {}),
                gstRateBps: values.gstRateBps,
                unit: values.unit,
                pricePaise: values.pricePaise,
                mrpPaise: values.mrpPaise,
                stockQty: values.stockQty,
              },
            });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: listingKey });
      return { previous: qc.getQueryData(listingKey) };
    },
    onError: (_e, vars, context) => {
      if (context?.previous !== undefined) qc.setQueryData(listingKey, context.previous);
      showMutationFailure("item", () => setSheet({ mode: "create" }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listingKey });
      setSheet(null);
    },
  });

  const lifecycle = useMutation({
    mutationFn: async ({ id, reactivate }: { id: string; reactivate: boolean }) => {
      const res = reactivate
        ? await updateCatalogItem(auth.client!, {
            id,
            businessId: businessId!,
            patch: { isActive: true },
          })
        : await deactivateItem(auth.client!, { id, businessId: businessId! });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: listingKey }),
  });

  const columns: ReadonlyArray<DataTableColumn<RowVM>> = [
    { key: "name", label: COL_ITEM, sortable: true, truncate: true },
    { key: "code", label: COL_CODE, mono: true },
    { key: "rate_label", label: COL_RATE },
    { key: "unit", label: COL_UNIT },
    { key: "price_label", label: COL_PRICE, numeric: true },
    { key: "mrp_label", label: COL_MRP, numeric: true },
    { key: "stock_label", label: COL_STOCK, numeric: true },
  ];

  const openRow = (vm: RowVM) => {
    const row = rows.find((r) => r.id === vm.id);
    if (row === undefined || readOnlyContext) return;
    setSheet(editableRole ? { mode: "edit", row } : { mode: "detail", row });
  };

  return (
    <>
      <HeaderRow title={CATALOG_SCREEN_TITLE} />
      <div className="flex min-h-0 flex-1 flex-col px-lg py-lg">
        <DataTable<RowVM>
          columns={columns}
          rows={vms}
          getRowId={(r) => r.id}
          searchableKeys={["name", "code"]}
          rowKeyLabel="items"
          isLoading={listing.isLoading}
          isError={listing.isError}
          onRetry={() => void listing.refetch()}
          searchPlaceholder={SEARCH_PLACEHOLDER}
          getRowClassName={(vm) => {
            const row = rows.find((r) => r.id === vm.id);
            return row !== undefined && !row.is_active ? "opacity-50" : "";
          }}
          primaryAction={
            editableRole && !readOnlyContext ? (
              <span title={online ? undefined : OFFLINE_CTA_TOOLTIP}>
                <Button onClick={() => setSheet({ mode: "create" })} disabled={!online || businessId === null}>
                  {CTA_ADD_ITEM}
                </Button>
              </span>
            ) : undefined
          }
          emptyState={
            <EmptyState
              icon={<Package size={40} aria-hidden="true" />}
              title={EMPTY_TITLE}
              copy={EMPTY_BODY}
              {...(editableRole && !readOnlyContext && online && businessId !== null
                ? { cta: { label: CTA_LABEL, onClick: () => setSheet({ mode: "create" }) } }
                : {})}
            />
          }
          onRowActivate={openRow}
        />
      </div>

      {sheet !== null && businessId !== null && (
        <ItemSheet
          open
          onClose={() => setSheet(null)}
          mode={"row" in sheet ? sheet.mode : "create"}
          itemName={"row" in sheet ? sheet.row.name : undefined}
          {...("row" in sheet
            ? {
                initial: {
                  name: sheet.row.name,
                  kind: guessKind(sheet.row.hsn_sac),
                  hsn_sac: sheet.row.hsn_sac ?? "",
                  gst_rate_percent: rateLabel(sheet.row).replace("%", ""),
                  unit: sheet.row.unit,
                  price: String(sheet.row.price),
                  mrp: sheet.row.mrp === null ? "" : String(sheet.row.mrp),
                  stock_qty: String(sheet.row.stock_qty),
                  is_active: sheet.row.is_active,
                },
              }
            : {})}
          onSubmit={async (values) => {
            const editingId = "row" in sheet ? sheet.row.id : undefined;
            try {
              await saveMutation.mutateAsync({
                values,
                ...(editingId !== undefined ? { editingId } : {}),
              });
              return true;
            } catch {
              return false;
            }
          }}
          {...("row" in sheet && sheet.mode === "edit" && editableRole && !readOnlyContext
            ? {
                onDeactivate: () => {
                  lifecycle.mutate({ id: sheet.row.id, reactivate: false });
                  setSheet(null);
                },
              }
            : {})}
          {...("row" in sheet &&
          sheet.mode === "edit" &&
          !sheet.row.is_active &&
          editableRole &&
          !readOnlyContext
            ? {
                onReactivate: () => {
                  lifecycle.mutate({ id: sheet.row.id, reactivate: true });
                  setSheet(null);
                },
              }
            : {})}
        />
      )}
    </>
  );
}

function guessKind(hsnSac: string | null): "goods" | "services" {
  // 99-prefix six-digit codes are SAC (services); everything else edits as goods.
  return hsnSac !== null && /^\d{6}$/.test(hsnSac) && hsnSac.startsWith("99")
    ? "services"
    : "goods";
}
