// BusinessesScreen - S4 assembly (plan 03-07, BIZ-01/02/05).
// Toolbar: search + Show-archived checkbox + super-admin-only CTA. Columns
// per spec; archived rows flagged read-only. Row click opens the sectioned
// sheet (edit for super_admin, detail mirror otherwise - the UI hides what
// RLS would deny, D-67/D-75). Saves are optimistic with snapshot rollback +
// Retry reopening the sheet with edits preserved (D-81/A5).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import type { BusinessRow } from "@billing/api/businesses";
import {
  archiveBusiness,
  createBusiness,
  listBusinesses,
  restoreBusiness,
  updateBusiness,
  type CreateBusinessInput,
} from "@billing/api/businesses";
import { keysFor } from "@billing/api/query-keys";
import { getStateEntry } from "@billing/gst";
import { DataTable, type DataTableColumn } from "../../components/ui/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { Button } from "../../components/ui/Button";
import { HeaderRow } from "../../shell/HeaderRow";
import { useAuth } from "../../auth/AuthProvider";
import { useOnlineStatus, OFFLINE_CTA_TOOLTIP } from "../../shell/OfflineBanner";
import { showMutationFailure } from "../../shell/toast-store";
import { useBusinessRealtime } from "../../lib/hooks/useBusinessRealtime";
import { CTA_ADD_BUSINESS } from "../../lib/strings/shell";
import {
  COL_BUSINESS,
  COL_GSTIN,
  COL_SCHEME,
  COL_STATE,
  EMPTY_BODY,
  EMPTY_TITLE,
  SCHEME_COMPOSITION,
  SCHEME_REGULAR,
  SEARCH_PLACEHOLDER,
  SHOW_ARCHIVED_CHECKBOX,
  STATUS_ARCHIVED_BADGE,
} from "../../lib/strings/businesses";
import { BusinessSheet } from "./BusinessSheet";
import { LogoUploadField } from "./LogoUploadField";
import type { NormalizedBusinessForm } from "./business-schema";

interface RowVM {
  id: string;
  display_name: string;
  trade: string;
  gstin_display: string;
  state_name: string;
  scheme_label: string;
  registration_type: string;
  status_label: string | null;
}

const isSuperAdmin = (role: string | null): boolean => role === "super_admin";

export function BusinessesScreen({ logoDeps }: { logoDeps?: Parameters<typeof LogoUploadField>[0]["deps"] }) {
  const auth = useAuth();
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const [showArchived, setShowArchived] = useState(false);
  // Sheet state: null = closed.
  const [sheet, setSheet] = useState<
    | { mode: "create" }
    | { mode: "edit" | "detail"; row: BusinessRow }
    // Retry-reopen payload keeps failed edits alive (D-81/S4 rollback contract).
    | { mode: "create"; draft: NormalizedBusinessForm; retry: true }
    // CR-03: a failed EDIT retries as THE SAME edit - identity carried, never
    // converted into a create.
    | { mode: "edit"; row: BusinessRow; draft: NormalizedBusinessForm }
    | null
  >(null);

  const canEdit = isSuperAdmin(auth.role);
  const listingKey = keysFor.businesses();

  const listing = useQuery({
    queryKey: listingKey,
    queryFn: async () => {
      const res = await listBusinesses(auth.client!);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    enabled: auth.client !== null,
  });

  // Realtime keeps rows live across devices; scoped to the global listing.
  useBusinessRealtime(auth.client, "businesses", "global");

  const rows = useMemo<BusinessRow[]>(() => listing.data ?? [], [listing.data]);
  const visibleRows = useMemo(
    () => (showArchived ? rows : rows.filter((r) => r.archived_at == null)),
    [rows, showArchived],
  );

  const vms = useMemo<RowVM[]>(
    () =>
      visibleRows.map((r) => ({
        id: r.id,
        display_name: r.legal_name,
        trade: r.trade_name ?? "",
        gstin_display: r.gstin,
        state_name: r.state !== null ? (getStateEntry(r.state)?.name ?? r.state) : "—",
        scheme_label:
          r.registration_type === "composition" ? SCHEME_COMPOSITION : SCHEME_REGULAR,
        registration_type: String(r.registration_type),
        status_label: r.archived_at != null ? STATUS_ARCHIVED_BADGE : null,
      })),
    [visibleRows],
  );

  // ---- optimistic create/update with snapshot rollback -------------------
  const saveMutation = useMutation({
    mutationFn: async ({
      values,
      editingId,
    }: {
      values: NormalizedBusinessForm;
      editingId?: string;
    }) => {
      const res =
        editingId === undefined
          ? await createBusiness(auth.client!, {
              gstin: values.gstin,
              legal_name: values.legal_name,
              trade_name: values.trade_name,
              address: values.address,
              state: values.state,
              phone: values.phone,
              email: values.email,
              registration_type: values.registration_type,
              number_format: values.number_format,
              prefix: values.prefix,
            } satisfies CreateBusinessInput)
          : await updateBusiness(auth.client!, editingId, {
              legal_name: values.legal_name,
              trade_name: values.trade_name,
              address: values.address,
              state: values.state,
              phone: values.phone,
              email: values.email,
            });
      // Result envelopes are DATA - map denials onto the error channel so the
      // rollback + toast contract runs uniformly (T-3-25).
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    // WR-01: GENUINE optimism (UI-SPEC state matrix - "Row updates instantly
    // on Save"). Updates project the edited values onto the row NOW; creates
    // append a provisional row with a temp id. onSettled invalidation then
    // replaces both with server truth; onError rolls back to the snapshot.
    onMutate: async ({ values, editingId }) => {
      await qc.cancelQueries({ queryKey: listingKey });
      const previous = qc.getQueryData(listingKey) as BusinessRow[] | undefined;
      if (previous !== undefined) {
        if (editingId !== undefined) {
          qc.setQueryData(
            listingKey,
            previous.map((r) =>
              r.id === editingId
                ? {
                    ...r,
                    legal_name: values.legal_name,
                    trade_name: values.trade_name,
                    gstin: values.gstin,
                    address: values.address,
                    state: values.state,
                    phone: values.phone,
                    email: values.email,
                  }
                : r,
            ),
          );
        } else {
          const provisional: BusinessRow = {
            id: `temp-${globalThis.crypto.randomUUID()}`,
            legal_name: values.legal_name,
            trade_name: values.trade_name,
            gstin: values.gstin,
            number_format: values.number_format,
            prefix: values.prefix,
            address: values.address,
            state: values.state,
            phone: values.phone,
            email: values.email,
            registration_type: values.registration_type,
            logo_path: null,
            archived_at: null,
            created_at: new Date().toISOString(),
          };
          qc.setQueryData(listingKey, [...previous, provisional]);
        }
      }
      return { previous };
    },
    onError: (_err, vars, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData(listingKey, context.previous);
      }
      // CR-03: Retry must re-apply THE SAME operation. A failed edit reopens
      // edit-mode bound to the same row id (update path); only a failed
      // create falls back to the create sheet.
      const editingId = vars.editingId;
      const retrying = () => {
        if (editingId !== undefined) {
          const base =
            (context?.previous as BusinessRow[] | undefined) ??
            (qc.getQueryData(listingKey) as BusinessRow[] | undefined);
          const row = base?.find((r) => r.id === editingId);
          if (row !== undefined) {
            setSheet({ mode: "edit", row, draft: vars.values });
            return;
          }
        }
        setSheet({ mode: "create", draft: vars.values, retry: true });
      };
      showMutationFailure("business", retrying);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listingKey });
      setSheet(null);
    },
    onSettled: () => {
      // Replaces provisional/optimistic rows with server truth in BOTH
      // outcomes.
      void qc.invalidateQueries({ queryKey: listingKey });
    },
  });

  const lifecycleMutation = useMutation({
    mutationFn: async ({ id, verb }: { id: string; verb: "archive" | "restore" }) => {
      const res =
        verb === "archive"
          ? await archiveBusiness(auth.client!, id)
          : await restoreBusiness(auth.client!, id);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onMutate: async ({ id, verb }) => {
      await qc.cancelQueries({ queryKey: listingKey });
      const previous = qc.getQueryData(listingKey) as BusinessRow[] | undefined;
      if (previous !== undefined) {
        qc.setQueryData(
          listingKey,
          previous.map((r) =>
            r.id === id
              ? {
                  ...r,
                  archived_at:
                    verb === "archive"
                      ? new Date().toISOString()
                      : null,
                }
              : r,
          ),
        );
      }
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous !== undefined) qc.setQueryData(listingKey, context.previous);
      showMutationFailure("business", () => undefined);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: listingKey }),
  });

  const columns: ReadonlyArray<DataTableColumn<RowVM>> = [
    { key: "display_name", label: COL_BUSINESS, sortable: true },
    { key: "gstin_display", label: COL_GSTIN, mono: true },
    { key: "state_name", label: COL_STATE },
    { key: "scheme_label", label: COL_SCHEME },
    { key: "status_label", label: "" },
  ];

  const primaryAction =
    canEdit === true ? (
      <span title={online ? undefined : OFFLINE_CTA_TOOLTIP}>
        <Button
          onClick={() => setSheet({ mode: "create" })}
          disabled={!online}
          data-testid="add-business-cta"
        >
          {CTA_ADD_BUSINESS}
        </Button>
      </span>
    ) : undefined;

  return (
    <>
      <HeaderRow
        title="Businesses"
        actions={
          <label className="flex items-center gap-xs text-caption text-ink-secondary">
            <input
              type="checkbox"
              data-testid="show-archived-toggle"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {SHOW_ARCHIVED_CHECKBOX}
          </label>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col px-lg py-lg">
        <DataTable<RowVM>
          columns={columns}
          rows={vms}
          getRowId={(r) => r.id}
          searchableKeys={["display_name", "gstin_display"]}
          rowKeyLabel="businesses"
          isLoading={listing.isLoading}
          isError={listing.isError}
          onRetry={() => void listing.refetch()}
          searchPlaceholder={SEARCH_PLACEHOLDER}
          primaryAction={primaryAction}
          emptyState={
            <EmptyState
              icon={<Building2 size={40} aria-hidden="true" />}
              title={EMPTY_TITLE}
              copy={EMPTY_BODY}
              {...(canEdit && online
                ? { cta: { label: CTA_ADD_BUSINESS, onClick: () => setSheet({ mode: "create" }) } }
                : {})}
            />
          }
          onRowActivate={(vm) => {
            const row = rows.find((r) => r.id === vm.id);
            if (row === undefined) return;
            if (row.archived_at != null) {
              setSheet({ mode: "detail", row }); // archived stays read-only even for super admins
              return;
            }
            setSheet(canEdit ? { mode: "edit", row } : { mode: "detail", row });
          }}
        />
      </div>

      {sheet !== null && (
        <BusinessSheet
          open
          onClose={() => setSheet(null)}
          mode={"row" in sheet ? sheet.mode : "create"}
          {...("row" in sheet
            ? {
                initial:
                  "draft" in sheet
                    ? // CR-03: retried edit - row identity + edited values.
                      { ...rowToInitial(sheet.row), ...draftToInitial(sheet.draft) }
                    : rowToInitial(sheet.row),
              }
            : "draft" in sheet
              ? { initial: draftToInitial(sheet.draft) }
              : {})}
          onSubmit={async (values) => {
            const editingId = "row" in sheet ? sheet.row.id : undefined;
            try {
              // mutateAsync throws on denial (Result mapped to error channel);
              // resolution means success - sheet closes via onSuccess.
              await saveMutation.mutateAsync({
                values,
                ...(editingId !== undefined ? { editingId } : {}),
              });
              return true;
            } catch {
              return false;
            }
          }}
          {...("row" in sheet && sheet.mode === "detail" && sheet.row.archived_at != null && canEdit
            ? {
                onRestore: () => {
                  lifecycleMutation.mutate({ id: sheet.row.id, verb: "restore" });
                  setSheet(null);
                },
              }
            : {})}
          {...("row" in sheet && sheet.mode === "edit" && canEdit
            ? {
                onArchive: () => {
                  lifecycleMutation.mutate({ id: sheet.row.id, verb: "archive" });
                  setSheet(null);
                },
                logoSlot:
                  logoDeps !== undefined ? (
                    <LogoUploadField
                      deps={logoDeps}
                      businessId={sheet.row.id}
                      existingPath={sheet.row.logo_path}
                      onUploaded={(path) => {
                        void updateBusiness(auth.client!, sheet.row.id, { logo_path: path });
                        void qc.invalidateQueries({ queryKey: listingKey });
                      }}
                      onRemoved={() => {
                        void updateBusiness(auth.client!, sheet.row.id, { logo_path: null });
                        void qc.invalidateQueries({ queryKey: listingKey });
                      }}
                    />
                  ) : undefined,
              }
            : {})}
        />
      )}
    </>
  );
}

function readAddressText(address: Record<string, unknown> | null): string {
  const lines = address?.["lines"];
  return Array.isArray(lines) ? lines.filter((l): l is string => typeof l === "string").join("\n") : "";
}
function readAddressCity(address: Record<string, unknown> | null): string {
  const v = address?.["city"];
  return typeof v === "string" ? v : "";
}
function readAddressPincode(address: Record<string, unknown> | null): string {
  const v = address?.["pincode"];
  return typeof v === "string" ? v : "";
}
function rowToInitial(row: BusinessRow): Partial<{
  legal_name: string;
  trade_name: string;
  gstin: string;
  address_text: string;
  city: string;
  pincode: string;
  state_code: string;
  phone: string;
  email: string;
  registration_type: "regular" | "composition";
  number_format: NormalizedBusinessForm["number_format"];
  prefix: string;
}> {
  return {
    legal_name: row.legal_name,
    trade_name: row.trade_name ?? "",
    gstin: row.gstin,
    address_text: readAddressText(row.address),
    city: readAddressCity(row.address),
    pincode: readAddressPincode(row.address),
    state_code: row.state ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    registration_type:
      row.registration_type === "composition"
        ? ("composition" as const)
        : ("regular" as const),
    number_format: row.number_format as NormalizedBusinessForm["number_format"],
    prefix: row.prefix ?? "",
  };
}

function draftToInitial(draft: NormalizedBusinessForm): Partial<{
  legal_name: string;
  gstin: string;
  address_text: string;
  city: string;
  pincode: string;
  state_code: string;
  phone: string;
  email: string;
}> {
  return {
    legal_name: draft.legal_name,
    gstin: draft.gstin,
    address_text: draft.address.lines.join("\n"),
    city: draft.address.city,
    pincode: draft.address.pincode,
    state_code: draft.state,
    phone: draft.phone ?? "",
    email: draft.email ?? "",
  };
}