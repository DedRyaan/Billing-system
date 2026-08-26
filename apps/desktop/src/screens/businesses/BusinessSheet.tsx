// BusinessSheet - the S4 single-scroll sectioned editor (D-77).
// Sections: Identity / GSTIN / Address & State / Contact / Tax configuration
// / Logo slot. Create/edit modes validate via business-schema; the DETAIL
// mode renders the read-only mirror for regular admins (fields readOnly
// dashed, footer hidden - mirroring the update-policy truth, D-75 posture).
//
// Edit-mode immutability is structural: GSTIN + registration + numbering are
// create-only facts (the api module's patch builder omits them), so those
// controls disable in edit mode.
import { useEffect, useMemo, useState } from "react";
import { RadioCardGroup } from "../../components/ui/RadioCardGroup";
import { Field } from "../../components/ui/Field";
import { Input, TextArea } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Sheet } from "../../components/ui/Sheet";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { STATE_CODES, validateGstin } from "@billing/gst";
import {
  ARCHIVE_BUTTON,
  ARCHIVE_CONFIRM_BODY,
  ARCHIVE_CONFIRM_VERB,
  archiveConfirmTitle,
  COMPOSITION_CONSEQUENCE,
  COMPOSITION_TITLE,
  FIELD_ADDRESS_LINES,
  FIELD_CITY,
  FIELD_EMAIL,
  FIELD_GSTIN,
  FIELD_LEGAL_NAME,
  FIELD_PHONE,
  FIELD_PINCODE,
  FIELD_PREFIX,
  FIELD_STATE,
  FIELD_TRADE_NAME,
  NUMBERING_HELPER,
  NUMBERING_LABEL,
  NUMBERING_TEMPLATE_TITLES,
  REGISTRATION_LABEL,
   REGULAR_CONSEQUENCE,
   REGULAR_TITLE,
   SECTION_ADDRESS,
   SECTION_CONTACT,
   SECTION_GSTIN,
   SECTION_IDENTITY,
   SECTION_LOGO,
   SECTION_TAX,
   SHEET_CREATE_TITLE,
   SHEET_DETAIL_SUBTITLE,
   SHEET_EDIT_TITLE,
 } from "../../lib/strings/businesses";
import {
  currentFinancialYearLabel,
  gstinLiveCaption,
  previewNumbering,
  validateBusinessForm,
  type BusinessFormErrors,
  type BusinessFormValues,
  type NormalizedBusinessForm,
} from "./business-schema";

export type BusinessSheetMode = "create" | "edit" | "detail";

export interface BusinessSheetProps {
  open: boolean;
  mode: BusinessSheetMode;
  /** Seed values (edit/detail) - identity of the row under edit. */
  initial?: Partial<BusinessFormValues>;
  onClose: () => void;
  /** Receives normalized values; return false to keep the sheet open. */
  onSubmit: (values: NormalizedBusinessForm) => Promise<boolean> | boolean;
  /** Super-admin archive affordance (edit mode only) behind the exact confirm. */
  onArchive?: () => void;
  /** Logo section content (LogoUploadField drops in here). */
  logoSlot?: React.ReactNode;
}

const EMPTY: BusinessFormValues = {
  legal_name: "",
  trade_name: "",
  gstin: "",
  address_text: "",
  city: "",
  pincode: "",
  state_code: "",
  phone: "",
  email: "",
  registration_type: "regular",
  number_format: "prefix_fy_seq",
  prefix: "",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b border-hairline pb-xs uppercase tracking-[0.04em] text-caption text-ink-secondary">
      {children}
    </p>
  );
}

export function BusinessSheet({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
  onArchive,
  logoSlot,
}: BusinessSheetProps) {
  const [values, setValues] = useState<BusinessFormValues>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<BusinessFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const readOnly = mode === "detail";
  const editLocked = mode === "edit"; // GSTIN/tax-config are create-only facts

  const set = <K extends keyof BusinessFormValues>(key: K, value: BusinessFormValues[K]) => {
    if (readOnly) return;
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const dirty = useMemo(
    () => JSON.stringify({ ...values }) !== JSON.stringify({ ...EMPTY, ...initial }),
    [values, initial],
  );

  // Live GSTIN law: the specific fail-union caption appears WHILE typing
  // (once the field is non-empty), not only on submit.
  useEffect(() => {
    if (readOnly) return;
    const gstinUpper = values.gstin.trim().toUpperCase();
    if (gstinUpper.length === 0) return;
    const verdict = validateGstin(gstinUpper);
    setErrors((e) => ({
      ...e,
      gstin: verdict.ok ? undefined : gstinLiveCaption(verdict.reason),
    }));
  }, [values.gstin, readOnly]);

  // Save stays disabled while the WHOLE form is invalid or in flight.
  const formValid =
    !readOnly &&
    Object.values(errors).every((v) => v === undefined) &&
    validateBusinessForm(values).normalized !== null;

  const fy = currentFinancialYearLabel();

  const stateOptions = STATE_CODES.map((entry) => ({
    value: entry.code,
    label: `${entry.name} (${entry.code})${entry.isUt ? " (UT)" : ""}`,
  }));

  const numberingOptions = (
    ["prefix_fy_seq", "prefix_seq", "seq"] as const
  ).map((t) => ({
    value: t as string,
    title: NUMBERING_TEMPLATE_TITLES[t],
    consequence: previewNumbering(t, values.prefix, fy),
  }));

  const handleSubmit = async () => {
    if (readOnly || submitting) return;
    const result = validateBusinessForm(values);
    setErrors(result.errors);
    if (result.normalized === null) return;
    setSubmitting(true);
    try {
      const ok = await onSubmit(result.normalized);
      if (!ok) return; // failure keeps sheet open with edits preserved
    } finally {
      setSubmitting(false);
    }
  };

  const err = (k: keyof BusinessFormValues) => errors[k];

  const archiveFooter =
    mode === "edit" && onArchive !== undefined && !readOnly ? (
      <Button
        type="button"
        variant="danger-text"
        onClick={() => setArchiveOpen(true)}
      >
        {ARCHIVE_BUTTON}
      </Button>
    ) : undefined;

  return (
    <>
    <Sheet
      open={open}
      onClose={onClose}
      // IN-06: titles come from the strings module - no inline copy drift.
      title={mode === "create" ? SHEET_CREATE_TITLE : mode === "edit" ? SHEET_EDIT_TITLE : values.legal_name || "Business"}
      subtitle={readOnly ? SHEET_DETAIL_SUBTITLE : undefined}
      dirty={dirty && !readOnly}
      onSave={() => void handleSubmit()}
      saveDisabled={!formValid || submitting}
      {...(readOnly ? { readOnly: true } : {})}
      {...(archiveFooter !== undefined ? { footerLeft: archiveFooter } : {})}
    >
      <div className="flex flex-col gap-xl">
        {/* IDENTITY */}
        <section className="flex flex-col gap-sd">
          <SectionLabel>{SECTION_IDENTITY}</SectionLabel>
          <Field id="biz-legal-name" label={FIELD_LEGAL_NAME} error={err("legal_name")}>
            <Input value={values.legal_name} onChange={(e) => set("legal_name", e.target.value)} maxLength={200} readOnly={readOnly} />
          </Field>
          <Field id="biz-trade-name" label={FIELD_TRADE_NAME}>
            <Input value={values.trade_name} onChange={(e) => set("trade_name", e.target.value)} maxLength={200} readOnly={readOnly} />
          </Field>
        </section>

        {/* GSTIN */}
        <section className="flex flex-col gap-sd">
          <SectionLabel>{SECTION_GSTIN}</SectionLabel>
          <Field id="biz-gstin" label={FIELD_GSTIN} error={err("gstin")} helper={editLocked ? "GSTIN cannot change after creation." : undefined}>
            <Input
              value={values.gstin}
              onChange={(e) => set("gstin", e.target.value.toUpperCase())}
              maxLength={15}
              className="font-mono"
              readOnly={readOnly || editLocked}
            />
          </Field>
        </section>

        {/* ADDRESS & STATE */}
        <section className="flex flex-col gap-sd">
          <SectionLabel>{SECTION_ADDRESS}</SectionLabel>
          <Field id="biz-address" label={FIELD_ADDRESS_LINES} error={err("address_text")}>
            <TextArea value={values.address_text} onChange={(e) => set("address_text", e.target.value)} readOnly={readOnly} />
          </Field>
          <Field id="biz-city" label={FIELD_CITY} error={err("city")}>
            <Input value={values.city} onChange={(e) => set("city", e.target.value)} maxLength={100} readOnly={readOnly} />
          </Field>
          <div className="grid grid-cols-2 gap-sd">
            <Field id="biz-pincode" label={FIELD_PINCODE} error={err("pincode")}>
              <Input value={values.pincode} onChange={(e) => set("pincode", e.target.value)} inputMode="numeric" maxLength={6} readOnly={readOnly} />
            </Field>
            <Field id="biz-state" label={FIELD_STATE} error={err("state_code")}>
              <Select
                value={values.state_code}
                onValueChange={(v) => set("state_code", v)}
                options={[{ value: "", label: "Select state…" }, ...stateOptions]}
                disabled={readOnly}
                aria-label="State"
              />
            </Field>
          </div>
        </section>

        {/* CONTACT */}
        <section className="flex flex-col gap-sd">
          <SectionLabel>{SECTION_CONTACT}</SectionLabel>
          <div className="grid grid-cols-2 gap-sd">
            <Field id="biz-phone" label={FIELD_PHONE} error={err("phone")}>
              <Input value={values.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" readOnly={readOnly} />
            </Field>
            <Field id="biz-email" label={FIELD_EMAIL} error={err("email")}>
              <Input value={values.email} onChange={(e) => set("email", e.target.value)} type="email" readOnly={readOnly} />
            </Field>
          </div>
        </section>

        {/* TAX CONFIGURATION */}
        <section className="flex flex-col gap-sd">
          <SectionLabel>{SECTION_TAX}</SectionLabel>
          <div>
            <p className="mb-xs text-caption text-ink-secondary">{REGISTRATION_LABEL}</p>
            <RadioCardGroup
              name="registration-type"
              options={[
                { value: "regular", title: REGULAR_TITLE, consequence: REGULAR_CONSEQUENCE },
                { value: "composition", title: COMPOSITION_TITLE, consequence: COMPOSITION_CONSEQUENCE },
              ]}
              value={values.registration_type}
              onValueChange={(v) => set("registration_type", v as BusinessFormValues["registration_type"])}
              // WR-05: registration type is a create-only fact - the patch
              // builder drops it on update, so it must not look editable.
              disabled={readOnly || editLocked}
            />
          </div>
          <div>
            <p className="mb-xs text-caption text-ink-secondary">{NUMBERING_LABEL}</p>
            <RadioCardGroup
              name="numbering-template"
              options={numberingOptions}
              value={values.number_format}
              onValueChange={(v) => set("number_format", v as BusinessFormValues["number_format"])}
              // WR-05: numbering template is a create-only fact.
              disabled={readOnly || editLocked}
            />
            <p className="mt-xs font-mono text-caption text-ink-secondary" data-testid="numbering-preview">
              {previewNumbering(values.number_format, values.prefix, fy)}
            </p>
            <p className="text-caption text-ink-muted">{NUMBERING_HELPER}</p>
          </div>
          <Field id="biz-prefix" label={FIELD_PREFIX} error={err("prefix")}>
            <Input
              value={values.prefix}
              onChange={(e) => set("prefix", e.target.value.toUpperCase())}
              maxLength={10}
              className="font-mono"
              disabled={values.number_format === "seq" || readOnly || editLocked}
            />
          </Field>
        </section>

        {/* LOGO */}
        <section className="flex flex-col gap-sd">
          <SectionLabel>{SECTION_LOGO}</SectionLabel>
          {logoSlot !== undefined ? logoSlot : null}
        </section>
      </div>
    </Sheet>

    {/* Archive confirm (T-3-27): verb-specific confirm, exact consequence copy. */}
    <ConfirmDialog
      open={archiveOpen}
      onOpenChange={setArchiveOpen}
      title={archiveConfirmTitle(values.legal_name || "business")}
      body={ARCHIVE_CONFIRM_BODY}
      confirmLabel={ARCHIVE_CONFIRM_VERB}
      tone="danger"
      onConfirm={() => onArchive?.()}
    />
    </>
  );
}

