// CustomerSheet - the S5 editor (plan 03-08 Task 2, MSTR-01/MSTR-03).
//
// Validation truth: ONLY name and state are required; an empty GSTIN is
// legal, a non-empty one must pass the engine's law (specific caption).
// The GSTIN field drives the auto-fetch machine: verified prefills apply
// through mergePrefill's dirty-field guard and NEVER block saving. Verified
// saves embed the `_gstin_lookup` snapshot envelope so reopen re-renders as
// verified without refetching.
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { getStateEntry, validateGstin } from "@billing/gst";
import { embedGstinLookup, GSTIN_LOOKUP_KEY } from "@billing/api/customers";
import { Field } from "../../components/ui/Field";
import { Input, TextArea } from "../../components/ui/Input";
import { Sheet } from "../../components/ui/Sheet";
import { StatePicker } from "../../components/ui/StatePicker";
import {
  FETCH_CHECKING_CAPTION,
  FETCH_FALLBACK_HINT,
  FETCH_VERIFIED_HINT,
  FIELD_ADDRESS,
  FIELD_CITY,
  FIELD_GSTIN,
  FIELD_NAME,
  FIELD_NOTES,
  FIELD_PHONE,
  FIELD_STATE,
  SHEET_CREATE_TITLE,
  SHEET_EDIT_TITLE,
  STATE_PICK_PLACEHOLDER,
  gstinFailCaption,
  nameRequiredCaption,
} from "../../lib/strings/customers";
import {
  mergePrefill,
  useGstinAutoFetch,
  type AutoFetchOutcome,
  type PrefillDraft,
  type SeedSnapshot,
} from "./useGstinAutoFetch";

const EMPTY_DRAFT: PrefillDraft & { phone: string; notes: string } = {
  legal_name: "",
  address_text: "",
  city: "",
  pincode: "",
  state_code: "",
  phone: "",
  notes: "",
};

export interface NormalizedCustomerForm {
  name: string;
  gstin: string | null;
  phone: string | null;
  address: Record<string, unknown> | null;
  stateCode: string;
  notes: string | null;
}

export interface CustomerSheetProps {
  open: boolean;
  mode: "create" | "edit";
  /** Explicit tenant scope (D-80). */
  businessId: string;
  initial?: Partial<{
    name: string;
    gstin: string;
    phone: string;
    address_text: string;
    city: string;
    pincode: string;
    state_code: string;
    notes: string;
    seedSnapshot: SeedSnapshot | null;
    /** IN-04: the row's raw stored address - keys this sheet does NOT own
        (anything besides lines/city/pincode/_gstin_lookup) round-trip on
        save instead of being dropped by the rebuild. */
    raw_address: Record<string, unknown> | null;
  }>;
  onClose: () => void;
  /** Receives normalized values; return false to keep the sheet open. */
  onSubmit: (values: NormalizedCustomerForm) => Promise<boolean> | boolean;
  /** Injected lookup (tests script outcomes); undefined disables the machine. */
  lookup?: (gstin: string) => Promise<AutoFetchOutcome>;
}

// Stable disabled-deps identity - constructing inline would re-run the
// machine's effect every render.
const DISABLED_LOOKUP_DEPS = {
  lookup: async () => ({ outcome: "not_found" }) as AutoFetchOutcome,
  enabled: false,
};

// IN-04: the address keys THIS sheet owns - everything else in a stored
// address jsonb is foreign data that must survive an edit-save untouched
// (the form never renders it, so the user can never intend to clear it).
const SHEET_OWNED_ADDRESS_KEYS: ReadonlySet<string> = new Set([
  "lines",
  "city",
  "pincode",
  GSTIN_LOOKUP_KEY,
]);

export function CustomerSheet({
  open,
  mode,
  businessId,
  initial,
  onClose,
  onSubmit,
  lookup,
}: CustomerSheetProps) {
  const [values, setValues] = useState({
    ...EMPTY_DRAFT,
    legal_name: initial?.name ?? "",
    gstinInput: initial?.gstin ?? "",
    address_text: initial?.address_text ?? "",
    city: initial?.city ?? "",
    pincode: initial?.pincode ?? "",
    state_code: initial?.state_code ?? "",
    phone: initial?.phone ?? "",
    notes: initial?.notes ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [submitting, setSubmitting] = useState(false);
  const touchedRef = useRef<Set<string>>(new Set());
  const snapshotRef = useRef<SeedSnapshot | null>(initial?.seedSnapshot ?? null);
  // IN-04: the row's ORIGINAL address at open time - a ref, not state; form
  // edits never touch it and it is read exactly once, at submit compose.
  const rawAddressRef = useRef<Record<string, unknown> | null>(initial?.raw_address ?? null);
  void businessId; // scope rides in the screen's mutation calls (D-80 explicitness)

  const setField = (key: keyof typeof values) => (input: string) => {
    touchedRef.current.add(key);
    setValues((v) => ({ ...v, [key]: input }));
  };

  // ---- auto-fetch machine -------------------------------------------------
  const { state: fetchState } = useGstinAutoFetch(
    lookup !== undefined ? { lookup } : DISABLED_LOOKUP_DEPS,
    values.gstinInput,
    initial?.seedSnapshot ?? null,
  );

  // Apply verified prefills through the dirty-field guard.
  useEffect(() => {
    if (fetchState.status !== "verified") return;
    setValues((v) =>
      mergePrefill(
        {
          legal_name: v.legal_name,
          address_text: v.address_text,
          city: v.city,
          pincode: v.pincode,
          state_code: v.state_code,
        },
        touchedRef.current,
        fetchState.prefill,
      ) === v
        ? v
        : {
            ...v,
            ...mergePrefill(
              {
                legal_name: v.legal_name,
                address_text: v.address_text,
                city: v.city,
                pincode: v.pincode,
                state_code: v.state_code,
              },
              touchedRef.current,
              fetchState.prefill,
            ),
          },
    );
    snapshotRef.current = {
      ...fetchState.prefill,
      gstin: values.gstinInput.trim().toUpperCase(),
      fetchedAt: new Date().toISOString(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchState]);

  // Live GSTIN law when non-empty.
  useEffect(() => {
    const candidate = values.gstinInput.trim().toUpperCase();
    if (candidate.length === 0) {
      setErrors((e) => ({ ...e, gstinInput: undefined }));
      return;
    }
    const verdict = validateGstin(candidate);
    setErrors((e) => ({
      ...e,
      gstinInput: verdict.ok ? undefined : gstinFailCaption(verdict.reason),
    }));
  }, [values.gstinInput]);

  const formValid =
    values.legal_name.trim().length > 0 &&
    values.legal_name.trim().length <= 200 &&
    errors["gstinInput"] === undefined &&
    values.state_code.length > 0;

  const handleSubmit = async () => {
    if (submitting) return;
    if (values.legal_name.trim().length === 0) {
      setErrors((e) => ({ ...e, legal_name: nameRequiredCaption }));
      return;
    }
    if (!formValid) return;

    const gstinUpper = values.gstinInput.trim().toUpperCase();
    const hasAddress =
      values.address_text.trim().length > 0 ||
      values.city.trim().length > 0 ||
      values.pincode.trim().length > 0 ||
      snapshotRef.current !== null;

    // IN-04: foreign keys (anything the sheet does not own) round-trip.
    // Owned keys are rebuilt ONLY from the form, so clearing a field really
    // clears it - nothing resurrects out of the raw row through the merge.
    const carried: Record<string, unknown> = Object.fromEntries(
      Object.entries(rawAddressRef.current ?? {}).filter(
        ([k]) => !SHEET_OWNED_ADDRESS_KEYS.has(k),
      ),
    );

    let address: Record<string, unknown> | null = null;
    if (hasAddress) {
      address = {
        ...carried,
        ...(values.address_text.trim().length > 0
          ? {
              lines: values.address_text
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
            }
          : {}),
        ...(values.city.trim().length > 0 ? { city: values.city.trim() } : {}),
        ...(values.pincode.trim().length > 0 ? { pincode: values.pincode.trim() } : {}),
      };
      if (snapshotRef.current !== null && gstinUpper.length > 0) {
        address = embedGstinLookup(address, snapshotRef.current as Record<string, unknown>);
      }
    } else if (Object.keys(carried).length > 0) {
      // Every field this sheet owns was cleared - owned keys go away, but
      // destroying the whole object would take foreign data down as
      // collateral. Carry it forward instead of nulling the address.
      address = carried;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: values.legal_name.trim(),
        gstin: gstinUpper.length > 0 ? gstinUpper : null,
        phone: values.phone.replace(/[\s()-]/g, "").length > 0 ? values.phone.replace(/[\s()-]/g, "") : null,
        address,
        stateCode: values.state_code,
        notes: values.notes.trim().length > 0 ? values.notes.trim() : null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === "create" ? SHEET_CREATE_TITLE : SHEET_EDIT_TITLE}
      dirty={JSON.stringify(values) !== JSON.stringify({ ...EMPTY_DRAFT, gstinInput: "", legal_name: initial?.name ?? "" })}
      onSave={() => void handleSubmit()}
      saveDisabled={!formValid || submitting}
    >
      <div className="flex flex-col gap-sd">
        <Field id="cust-legal-name" label={FIELD_NAME} error={errors["legal_name"]}>
          <Input value={values.legal_name} onChange={(e) => setField("legal_name")(e.target.value)} maxLength={200} />
        </Field>

        <Field
          id="cust-gstin"
          label={FIELD_GSTIN}
          error={errors["gstinInput"]}
          helper={
            fetchState.status === "verified"
              ? FETCH_VERIFIED_HINT
              : fetchState.status === "checking"
                ? undefined
                : fetchState.status === "fallback"
                  ? FETCH_FALLBACK_HINT
                  : undefined
          }
        >
          <Input
            value={values.gstinInput}
            onChange={(e) => setField("gstinInput")(e.target.value.toUpperCase())}
            maxLength={15}
            className="font-mono"
          />
        </Field>
        <div aria-live="polite">
          {fetchState.status === "checking" && (
            <p className="flex items-center gap-xs text-caption text-ink-secondary">
              <LoaderCircle size={12} aria-hidden="true" className="animate-spin" />
              {FETCH_CHECKING_CAPTION}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-sd">
          <Field id="cust-phone" label={FIELD_PHONE}>
            <Input value={values.phone} onChange={(e) => setField("phone")(e.target.value)} inputMode="tel" />
          </Field>
          <Field id="cust-city" label={FIELD_CITY}>
            <Input id="cust-city-input" data-testid="cust-city" value={values.city} onChange={(e) => setField("city")(e.target.value)} maxLength={100} />
          </Field>
        </div>

        <Field id="cust-address" label={FIELD_ADDRESS}>
          <TextArea value={values.address_text} onChange={(e) => setField("address_text")(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-sd">
          <Field id="cust-state" label={FIELD_STATE}>
            {/* IN-02: UI-SPEC Component Contracts - the state field is the
                type-to-filter StatePicker combobox, not a raw Select. Picking
                marks the field touched for the prefill dirty-field guard. */}
            <StatePicker
              value={getStateEntry(values.state_code) ?? null}
              onPick={(entry) => {
                touchedRef.current.add("state_code");
                setValues((s) => ({ ...s, state_code: entry.code }));
              }}
              placeholder={STATE_PICK_PLACEHOLDER}
            />
          </Field>
          <Field id="cust-pincode" label="PIN code">
            <Input id="cust-pincode-input" value={values.pincode} onChange={(e) => setField("pincode")(e.target.value)} inputMode="numeric" maxLength={6} />
          </Field>
        </div>

        <Field id="cust-notes" label={FIELD_NOTES}>
          <TextArea value={values.notes} onChange={(e) => setField("notes")(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
