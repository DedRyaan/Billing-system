// CustomersScreen - S5 assembly (plan 03-08, MSTR-01/D-43).
// ALL roles get the Add-customer affordance (staff maintain their books,
// D-43). Rows scope to the ACTIVE business; realtime keeps them live;
// saves are optimistic with snapshot rollback + Retry reopening preserved
// edits. An ARCHIVED active business renders read-only chrome (no CTA,
// detail-only sheets - D-35/D-36 mirror).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { enIN } from "date-fns/locale";
import { Users } from "lucide-react";
import type { CustomerRow } from "@billing/api/customers";
import { createCustomer, listCustomersByBusiness, readGstinLookup, updateCustomer } from "@billing/api/customers";
import { fetchGstinParty, type NormalizedParty } from "@billing/api/gstin-lookup";
import { keysFor } from "@billing/api/query-keys";
import { getStateEntry } from "@billing/gst";
import { readGstinLookupEnv } from "../../lib/env";
import { DataTable, type DataTableColumn } from "../../components/ui/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { Button } from "../../components/ui/Button";
import { HeaderRow } from "../../shell/HeaderRow";
import { useAuth } from "../../auth/AuthProvider";
import { useActiveBusiness } from "../../business/ActiveBusinessProvider";
import { OFFLINE_CTA_TOOLTIP, useOnlineStatus } from "../../shell/OfflineBanner";
import { showMutationFailure } from "../../shell/toast-store";
import { useBusinessRealtime } from "../../lib/hooks/useBusinessRealtime";
import { CTA_ADD_CUSTOMER } from "../../lib/strings/global";
import {
  COL_CITY,
  COL_CUSTOMER,
  COL_GSTIN,
  COL_STATE,
  COL_UPDATED,
  CTA_ADD,
  CUSTOMERS_SCREEN_TITLE,
  EMPTY_BODY,
  EMPTY_TITLE,
  SEARCH_PLACEHOLDER,
} from "../../lib/strings/customers";
import { CustomerSheet, type NormalizedCustomerForm } from "./CustomerSheet";
import type { AutoFetchOutcome, NormalizedPayload } from "./useGstinAutoFetch";

interface RowVM {
  id: string;
  name: string;
  phone: string;
  city: string;
  state_name: string;
  gstin_display: string;
  updated_label: string;
}

export function CustomersScreen() {
  const auth = useAuth();
  const biz = useActiveBusiness();
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const readOnlyContext = biz.isArchived;

  const [sheet, setSheet] = useState<
    | { mode: "create" }
    | { mode: "edit"; row: CustomerRow }
    | { mode: "create"; draft: NormalizedCustomerForm }
    // CR-03: a failed EDIT retries as THE SAME edit - identity carried.
    | { mode: "edit"; row: CustomerRow; draft: NormalizedCustomerForm }
    | null
  >(null);

  const businessId = biz.activeBusinessId;
  const listingKey = keysFor.customers(businessId ?? "global");

  // CR-02 (MSTR-03 end-to-end): compose the production lookup ONCE per mount
  // over the optional env wiring. Stable identity - the machine's effect
  // depends on deps.lookup. Absent config keeps the feature disabled exactly
  // like the tests' disabled-deps path; silent degradation stays the contract.
  const lookup = useMemo(() => {
    const config = readGstinLookupEnv(import.meta.env as unknown as Record<string, unknown>);
    if (config === null) return undefined;
    const toMachinePayload = (p: NormalizedParty): NormalizedPayload => ({
      legalName: p.legalName,
      ...(p.tradeName !== undefined ? { tradeName: p.tradeName } : {}),
      ...(p.registeredAddress !== undefined
        ? {
            registeredAddress: {
              lines: p.registeredAddress.lines,
              ...(p.registeredAddress.city !== undefined ? { city: p.registeredAddress.city } : {}),
              ...(p.registeredAddress.stateCode !== undefined
                ? { stateCode: p.registeredAddress.stateCode }
                : {}),
              ...(p.registeredAddress.pincode !== undefined
                ? { pincode: p.registeredAddress.pincode }
                : {}),
            },
          }
        : {}),
    });
    return async (gstin: string): Promise<AutoFetchOutcome> => {
      const outcome = await fetchGstinParty({ config }, { gstin });
      switch (outcome.outcome) {
        case "verified":
          return { outcome: "verified", payload: toMachinePayload(outcome.payload) };
        case "not_found":
          return { outcome: "not_found" };
        // disabled/invalid_structure cannot occur here (config present; the
        // machine pre-validates structure) - degrade like any other failure.
        default:
          return { outcome: "failed" };
      }
    };
  }, []);

  const listing = useQuery({
    queryKey: listingKey,
    queryFn: async () => {
      // IN-08: explicit narrowing instead of non-null assertions.
      if (auth.client === null || businessId === null) {
        throw new Error("invariant: listing ran without client or business");
      }
      const res = await listCustomersByBusiness(auth.client, businessId);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    enabled: auth.client !== null && businessId !== null,
  });

  useBusinessRealtime(auth.client, "customers", businessId);

  const rows = useMemo<CustomerRow[]>(() => listing.data ?? [], [listing.data]);

  const vms = useMemo<RowVM[]>(
    () =>
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone ?? "",
        city: typeof r.address?.["city"] === "string" ? String(r.address["city"]) : "",
        state_name: r.state !== null ? (getStateEntry(r.state)?.name ?? r.state) : "—",
        gstin_display: r.gstin ?? "—",
        updated_label: format(new Date(r.updated_at), "d MMM yyyy", { locale: enIN }),
      })),
    [rows],
  );

  const saveMutation = useMutation({
    mutationFn: async ({ values, editingId }: { values: NormalizedCustomerForm; editingId?: string }) => {
      // IN-08: explicit narrowing instead of non-null assertions.
      if (auth.client === null || businessId === null) {
        throw new Error("invariant: save ran without client or business");
      }
      const res =
        editingId === undefined
          ? await createCustomer(auth.client, businessId, {
              name: values.name,
              ...(values.gstin !== null ? { gstin: values.gstin } : {}),
              ...(values.phone !== null ? { phone: values.phone } : {}),
              ...(values.address !== null ? { address: values.address } : {}),
              stateCode: values.stateCode,
              ...(values.notes !== null ? { notes: values.notes } : {}),
            })
          : await updateCustomer(auth.client, {
              id: editingId,
              businessId,
              patch: {
                name: values.name,
                gstin: values.gstin,
                phone: values.phone,
                address: values.address,
                stateCode: values.stateCode,
                notes: values.notes,
              },
            });
      if (!res.ok) throw new Error(res.error.message); // denials ride the error channel
      return res.data;
    },
    // WR-01: GENUINE optimism (UI-SPEC state matrix). Updates project onto
    // the row NOW; creates append a provisional temp-id row. onSettled
    // invalidation replaces both with server truth; onError rolls back.
    onMutate: async ({ values, editingId }) => {
      await qc.cancelQueries({ queryKey: listingKey });
      const previous = qc.getQueryData(listingKey) as CustomerRow[] | undefined;
      if (previous !== undefined) {
        if (editingId !== undefined) {
          qc.setQueryData(
            listingKey,
            previous.map((r) =>
              r.id === editingId
                ? {
                    ...r,
                    name: values.name,
                    gstin: values.gstin,
                    phone: values.phone,
                    address: values.address,
                    state: values.stateCode,
                    notes: values.notes,
                  }
                : r,
            ),
          );
        } else {
          const now = new Date().toISOString();
          const provisional: CustomerRow = {
            id: `temp-${globalThis.crypto.randomUUID()}`,
            business_id: businessId ?? "global",
            name: values.name,
            gstin: values.gstin,
            phone: values.phone,
            address: values.address,
            state: values.stateCode,
            notes: values.notes,
            is_active: true,
            created_at: now,
            updated_at: now,
          };
          qc.setQueryData(listingKey, [...previous, provisional]);
        }
      }
      return { previous };
    },
    onError: (_e, vars, context) => {
      if (context?.previous !== undefined) qc.setQueryData(listingKey, context.previous);
      // CR-03: Retry re-applies THE SAME operation - a failed edit reopens
      // edit-mode bound to the same row id; never converted into a create.
      const editingId = vars.editingId;
      const retrying = () => {
        if (editingId !== undefined) {
          const base =
            (context?.previous as CustomerRow[] | undefined) ??
            (qc.getQueryData(listingKey) as CustomerRow[] | undefined);
          const row = base?.find((r) => r.id === editingId);
          if (row !== undefined) {
            setSheet({ mode: "edit", row, draft: vars.values });
            return;
          }
        }
        setSheet({ mode: "create", draft: vars.values });
      };
      showMutationFailure("customer", retrying);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listingKey });
      setSheet(null);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: listingKey });
    },
  });

  const columns: ReadonlyArray<DataTableColumn<RowVM>> = [
    { key: "name", label: COL_CUSTOMER, sortable: true, truncate: true },
    { key: "city", label: COL_CITY },
    { key: "state_name", label: COL_STATE },
    { key: "gstin_display", label: COL_GSTIN, mono: true },
    { key: "updated_label", label: COL_UPDATED },
  ];


  return (
    <>
      <HeaderRow title={CUSTOMERS_SCREEN_TITLE} />
      <div className="flex min-h-0 flex-1 flex-col px-lg py-lg">
        <DataTable<RowVM>
          columns={columns}
          rows={vms}
          getRowId={(r) => r.id}
          searchableKeys={["name", "phone", "gstin_display"]}
          rowKeyLabel="customers"
          isLoading={listing.isLoading}
          isError={listing.isError}
          onRetry={() => void listing.refetch()}
          searchPlaceholder={SEARCH_PLACEHOLDER}
          primaryAction={
            !readOnlyContext ? (
              <span title={online ? undefined : OFFLINE_CTA_TOOLTIP}>
                <Button
                  onClick={() => setSheet({ mode: "create" })}
                  disabled={!online || businessId === null}
                >
                  {CTA_ADD_CUSTOMER}
                </Button>
              </span>
            ) : undefined
          }
          emptyState={
            <EmptyState
              icon={<Users size={40} aria-hidden="true" />}
              title={EMPTY_TITLE}
              copy={EMPTY_BODY}
              {...(!readOnlyContext && online && businessId !== null
                ? { cta: { label: CTA_ADD, onClick: () => setSheet({ mode: "create" }) } }
                : {})}
            />
          }
          onRowActivate={(vm) => {
            const row = rows.find((r) => r.id === vm.id);
            if (row === undefined) return;
            if (readOnlyContext) return;
            setSheet({ mode: "edit", row });
          }}
        />
      </div>

      {sheet !== null && businessId !== null && (
        <CustomerSheet
          open
          onClose={() => setSheet(null)}
          mode={"row" in sheet ? "edit" : "create"}
          businessId={businessId}
          {...(lookup !== undefined ? { lookup } : {})}
          {...("row" in sheet
            ? {
                initial:
                  "draft" in sheet
                    ? // CR-03: retried edit - row identity + edited values.
                      { ...customerRowToInitial(sheet.row), ...customerDraftToInitial(sheet.draft) }
                    : customerRowToInitial(sheet.row),
              }
            : "draft" in sheet
              ? { initial: customerDraftToInitial(sheet.draft) }
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
        />
      )}
    </>
  );
}

function customerRowToInitial(row: CustomerRow): Partial<{
  name: string;
  gstin: string;
  phone: string;
  address_text: string;
  city: string;
  pincode: string;
  state_code: string;
  notes: string;
  seedSnapshot: Record<string, unknown> | null;
  raw_address: Record<string, unknown> | null;
}> {
  return {
    name: row.name,
    gstin: row.gstin ?? "",
    phone: row.phone ?? "",
    address_text: Array.isArray(row.address?.["lines"])
      ? (row.address?.["lines"] as string[]).join("\n")
      : "",
    city: typeof row.address?.["city"] === "string" ? String(row.address["city"]) : "",
    pincode:
      typeof row.address?.["pincode"] === "string" ? String(row.address["pincode"]) : "",
    state_code: row.state ?? "",
    notes: row.notes ?? "",
    // IN-04: reopen a previously verified customer AS the verified state -
    // seed the auto-fetch machine from the stored _gstin_lookup envelope
    // (no refetch) instead of discarding it.
    seedSnapshot: readGstinLookup(row.address) ?? null,
    // IN-04: the raw stored address rides along so edit-saves can carry
    // keys this sheet does not own through the rebuild instead of dropping
    // them.
    raw_address: row.address ?? null,
  };
}

function customerDraftToInitial(draft: NormalizedCustomerForm): Partial<{
  name: string;
  gstin: string;
  phone: string;
  address_text: string;
  city: string;
  pincode: string;
  state_code: string;
  notes: string;
  raw_address: Record<string, unknown> | null;
}> {
  return {
    name: draft.name,
    gstin: draft.gstin ?? "",
    phone: draft.phone ?? "",
    address_text:
      draft.address !== null && Array.isArray(draft.address["lines"])
        ? (draft.address["lines"] as string[]).join("\n")
        : "",
    city:
      draft.address !== null && typeof draft.address["city"] === "string"
        ? String(draft.address["city"])
        : "",
    pincode:
      draft.address !== null && typeof draft.address["pincode"] === "string"
        ? String(draft.address["pincode"])
        : "",
    state_code: draft.stateCode,
    notes: draft.notes ?? "",
    // CR-03 retry path: a previously composed address already contains the
    // carried foreign keys - it is the freshest raw source for the retry.
    raw_address: draft.address ?? null,
  };
}
