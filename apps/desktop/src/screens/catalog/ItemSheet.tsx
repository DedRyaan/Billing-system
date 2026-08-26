// ItemSheet - the S6 editor (plan 03-09 Task 2, MSTR-04/D-75/A7).
// Segmented Type control drives HSN vs SAC labeling AND the validator kind.
// Rate select binds to slab-derived options ONLY. Save gates on ERRORS and
// ignores soft HSN/SAC warnings (caption states the specific reason).
// Admins get quiet Deactivate/Reactivate footer actions behind verbatim
// confirms; the staff/detail mode hides the footer entirely (read-only
// mirror of D-44 policy truth).
import { useMemo, useState } from "react";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { Select } from "../../components/ui/Select";
import {
  DEACTIVATE_BUTTON,
  DEACTIVATE_CONFIRM_BODY,
  DEACTIVATE_CONFIRM_VERB,
  REACTIVATE_BUTTON,
  REACTIVATE_CONFIRM_BODY,
  REACTIVATE_CONFIRM_TITLE,
  REACTIVATE_CONFIRM_VERB,
  FIELD_GST_RATE,
  FIELD_MRP,
  FIELD_NAME,
  FIELD_PRICE,
  FIELD_STOCK,
  FIELD_TYPE,
  FIELD_UNIT,
  TYPE_GOODS,
  TYPE_SERVICES,
  SHEET_CREATE_TITLE,
  SHEET_EDIT_TITLE,
  READONLY_NOTE,
  codeLabelFor,
  deactivateConfirmTitle,
} from "../../lib/strings/catalog";
import { UNIT_OPTIONS } from "../../lib/constants/units";
import {
  validateCatalogForm,
  type CatalogFormErrors,
  type CatalogFormValues,
  type NormalizedCatalogItem,
} from "./catalog-schema";
import { slabRateOptions } from "./catalog-schema";

export type ItemSheetMode = "create" | "edit" | "detail";

export interface ItemSheetProps {
  open: boolean;
  mode: ItemSheetMode;
  initial?: Partial<CatalogFormValues> & { is_active?: boolean };
  /** Name used in confirm titles. */
  itemName?: string;
  onClose: () => void;
  onSubmit: (values: NormalizedCatalogItem) => Promise<boolean> | boolean;
  onDeactivate?: () => void;
  onReactivate?: () => void;
}

const EMPTY: CatalogFormValues = {
  name: "",
  kind: "goods",
  hsn_sac: "",
  gst_rate_percent: "",
  unit: "",
  price: "",
  mrp: "",
  stock_qty: "",
};

export function ItemSheet({
  open,
  mode,
  initial,
  itemName,
  onClose,
  onSubmit,
  onDeactivate,
  onReactivate,
}: ItemSheetProps) {
  const [values, setValues] = useState<CatalogFormValues>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<CatalogFormErrors>({});
  const [warning, setWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState<"deactivate" | "reactivate" | null>(null);

  const readOnly = mode === "detail";
  const isActiveRow = initial?.is_active !== false;

  const set = <K extends keyof CatalogFormValues>(key: K, value: CatalogFormValues[K]) => {
    if (readOnly) return;
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    if (key === "hsn_sac") setWarning(null);
  };

  const dirty = useMemo(
    () => JSON.stringify({ ...values }) !== JSON.stringify({ ...EMPTY, ...initial }),
    [values, initial],
  );

  // Live soft check while typing codes - warnings never block.
  const liveWarning =
    values.hsn_sac.trim().length > 0 && warning === null
      ? null
      : warning;

  const formValid =
    !readOnly &&
    Object.values(errors).every((v) => v === undefined) &&
    validateCatalogForm(values).normalized !== null;

  const handleSubmit = async () => {
    if (readOnly || submitting) return;
    const result = validateCatalogForm(values);
    setErrors(result.errors);
    setWarning(result.warnings["hsn_sac"] ?? null);
    if (result.normalized === null) return;
    setSubmitting(true);
    try {
      await onSubmit(result.normalized);
    } finally {
      setSubmitting(false);
    }
  };

  const rateOptions = slabRateOptions();
  const unitOptions = UNIT_OPTIONS.map((u) => ({ value: u as string, label: u as string }));
  const displayName = itemName ?? (values.name.length > 0 ? values.name : "item");

  const footerLeft =
    mode === "edit" && !readOnly ? (
      isActiveRow ? (
        onDeactivate !== undefined ? (
          <Button type="button" variant="danger-text" onClick={() => setConfirm("deactivate")}>
            {DEACTIVATE_BUTTON}
          </Button>
        ) : undefined
      ) : onReactivate !== undefined ? (
        <Button type="button" variant="secondary" onClick={() => setConfirm("reactivate")}>
          {REACTIVATE_BUTTON}
        </Button>
      ) : undefined
    ) : undefined;

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={mode === "create" ? SHEET_CREATE_TITLE : mode === "edit" ? SHEET_EDIT_TITLE : displayName}
        subtitle={readOnly ? READONLY_NOTE : undefined}
        dirty={dirty && !readOnly}
        onSave={() => void handleSubmit()}
        saveDisabled={!formValid || submitting}
        {...(readOnly ? { readOnly: true } : {})}
        {...(footerLeft !== undefined ? { footerLeft } : {})}
      >
        <div className="flex flex-col gap-sd">
          <Field id="item-name" label={FIELD_NAME} error={errors["name"]}>
            <Input value={values.name} onChange={(e) => set("name", e.target.value)} maxLength={200} readOnly={readOnly} />
          </Field>

          {/* Segmented type control - drives label + validator kind. */}
          <div>
            <p className="mb-xs text-caption text-ink-secondary">{FIELD_TYPE}</p>
            <div role="radiogroup" aria-label={FIELD_TYPE} className="flex gap-xs">
              {(["goods", "services"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={values.kind === k}
                  data-testid={`type-${k}`}
                  onClick={() => set("kind", k)}
                  disabled={readOnly}
                  className={`h-(--control-md) flex-1 rounded-md border px-sm text-body transition-colors duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    values.kind === k
                      ? "border-accent bg-accent-subtle font-semibold text-ink"
                      : "border-hairline-strong bg-surface text-ink-secondary hover:bg-paper"
                  }`}
                >
                  {k === "goods" ? TYPE_GOODS : TYPE_SERVICES}
                </button>
              ))}
            </div>
          </div>

          <Field
            id="item-code"
            label={`${codeLabelFor(values.kind)}${readOnly ? "" : " (optional)"}`}
            helper={liveWarning ?? undefined}
            error={errors["hsn_sac"]}
          >
            <Input
              value={values.hsn_sac}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, "");
                set("hsn_sac", next);
                if (next.length > 0) {
                  const result = validateCatalogForm({ ...values, hsn_sac: next });
                  setWarning(result.warnings["hsn_sac"] ?? null);
                }
              }}
              inputMode="numeric"
              className="font-mono"
              maxLength={8}
              readOnly={readOnly}
            />
          </Field>
          {liveWarning !== null && (
            <p className="-mt-xs text-caption text-warning" data-testid="code-warning">
              {liveWarning}
            </p>
          )}

          <div className="grid grid-cols-2 gap-sd">
            <Field id="item-rate" label={FIELD_GST_RATE} error={errors["gst_rate_percent"]}>
              <Select
                value={values.gst_rate_percent}
                onValueChange={(v) => set("gst_rate_percent", v)}
                options={[{ value: "", label: "Select rate…" }, ...rateOptions]}
                disabled={readOnly}
                aria-label={FIELD_GST_RATE}
              />
            </Field>
            <Field id="item-unit" label={FIELD_UNIT} error={errors["unit"]}>
              <Select
                value={values.unit}
                onValueChange={(v) => set("unit", v)}
                options={[{ value: "", label: "Select unit…" }, ...unitOptions]}
                disabled={readOnly}
                aria-label={FIELD_UNIT}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-sd">
            <Field id="item-price" label={FIELD_PRICE} error={errors["price"]}>
              <MoneyInput value={values.price} onValueChange={(raw) => set("price", raw)} readOnly={readOnly} />
            </Field>
            <Field id="item-mrp" label={FIELD_MRP} error={errors["mrp"]}>
              <MoneyInput value={values.mrp} onValueChange={(raw) => set("mrp", raw)} readOnly={readOnly} />
            </Field>
          </div>

          <Field id="item-stock" label={FIELD_STOCK} error={errors["stock_qty"]} helper={undefined}>
            <Input
              value={values.stock_qty}
              onChange={(e) => set("stock_qty", e.target.value)}
              inputMode="numeric"
              readOnly={readOnly}
            />
          </Field>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirm === "deactivate"}
        onOpenChange={(o) => setConfirm(o ? "deactivate" : null)}
        title={deactivateConfirmTitle(displayName)}
        body={DEACTIVATE_CONFIRM_BODY}
        confirmLabel={DEACTIVATE_CONFIRM_VERB}
        tone="danger"
        onConfirm={() => onDeactivate?.()}
      />
      <ConfirmDialog
        open={confirm === "reactivate"}
        onOpenChange={(o) => setConfirm(o ? "reactivate" : null)}
        title={REACTIVATE_CONFIRM_TITLE(displayName)}
        body={REACTIVATE_CONFIRM_BODY}
        confirmLabel={REACTIVATE_CONFIRM_VERB}
        onConfirm={() => onReactivate?.()}
      />
    </>
  );
}
