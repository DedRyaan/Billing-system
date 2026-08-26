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
import { createCustomer, listCustomersByBusiness, updateCustomer } from "@billing/api/customers";
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
      const res = await listCustomersByBusiness(auth.client!, businessId!);
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
      const res =
        editingId === undefined
          ? await createCustomer(auth.client!, businessId!, {
              name: values.name,
              ...(values.gstin !== null ? { gstin: values.gstin } : {}),
              ...(values.phone !== null ? { phone: values.phone } : {}),
              ...(values.address !== null ? { address: values.address } : {}),
              stateCode: values.stateCode,
              ...(values.notes !== null ? { notes: values.notes } : {}),
            })
          : await updateCustomer(auth.client!, {
              id: editingId,
              businessId: businessId!,
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
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: listingKey });
      return { previous: qc.getQueryData(listingKey) };
    },
    onError: (_e, vars, context) => {
      if (context?.previous !== undefined) qc.setQueryData(listingKey, context.previous);
      showMutationFailure("customer", () =>
        setSheet({ mode: "create", draft: vars.values }),
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: listingKey });
      setSheet(null);
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
                initial: {
                  name: sheet.row.name,
                  gstin: sheet.row.gstin ?? "",
                  phone: sheet.row.phone ?? "",
                  address_text: Array.isArray(sheet.row.address?.["lines"])
                    ? (sheet.row.address?.["lines"] as string[]).join("\n")
                    : "",
                  city: typeof sheet.row.address?.["city"] === "string" ? String(sheet.row.address["city"]) : "",
                  pincode: typeof sheet.row.address?.["pincode"] === "string" ? String(sheet.row.address["pincode"]) : "",
                  state_code: sheet.row.state ?? "",
                  notes: sheet.row.notes ?? "",
                },
              }
            : "draft" in sheet
              ? {
                  initial: {
                    name: sheet.draft.name,
                    gstin: sheet.draft.gstin ?? "",
                    phone: sheet.draft.phone ?? "",
                    address_text:
                      sheet.draft.address !== null && Array.isArray(sheet.draft.address["lines"])
                        ? (sheet.draft.address["lines"] as string[]).join("\n")
                        : "",
                    city:
                      sheet.draft.address !== null && typeof sheet.draft.address["city"] === "string"
                        ? String(sheet.draft.address["city"])
                        : "",
                    state_code: sheet.draft.stateCode,
                    notes: sheet.draft.notes ?? "",
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
        />
      )}
    </>
  );
}
