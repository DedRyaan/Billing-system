// Business form schema (plan 03-07 Task 1, BIZ-01/BIZ-02/BIZ-05/D-77).
//
// Zod handles mechanical constraints; @billing/gst owns GSTIN law and the
// STATE_CODES universe. The validator NEVER throws - it returns a field-keyed
// error map plus the normalized values ready for the api module builders.
import { z } from "zod";
import { deriveFinancialYear, validateGstin } from "@billing/gst";
import { gstinFailCaption } from "../../lib/strings/businesses";

export const REGISTRATION_TYPES = ["regular", "composition"] as const;
export const NUMBER_FORMATS = ["prefix_fy_seq", "prefix_seq", "seq"] as const;

export interface BusinessFormValues {
  legal_name: string;
  trade_name: string;
  gstin: string;
  /** Newline-separated textarea source; normalized to lines[]. */
  address_text: string;
  city: string;
  pincode: string;
  /** STATE_CODES entry code ('27'…'97'); '' = unset. */
  state_code: string;
  phone: string;
  email: string;
  registration_type: (typeof REGISTRATION_TYPES)[number];
  number_format: (typeof NUMBER_FORMATS)[number];
  prefix: string;
}

export type BusinessFormField = keyof BusinessFormValues;
export type BusinessFormErrors = Partial<Record<BusinessFormField, string>>;

export interface NormalizedBusinessForm {
  legal_name: string;
  trade_name: string | null;
  gstin: string;
  address: { lines: string[]; city: string; pincode: string };
  state: string;
  phone: string | null;
  email: string | null;
  registration_type: (typeof REGISTRATION_TYPES)[number];
  number_format: (typeof NUMBER_FORMATS)[number];
  prefix: string | null;
}

const mechanicalSchema = z.object({
  legal_name: z
    .string()
    .trim()
    .min(1, "Legal name is required.")
    .max(200, "Legal name must be 200 characters or fewer."),
  trade_name: z.string().max(200, "Trade name must be 200 characters or fewer."),
  address_text: z.string(),
  city: z.string().trim().min(1, "City is required.").max(100, "City must be 100 characters or fewer."),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address.")]),
  registration_type: z.enum(REGISTRATION_TYPES),
  number_format: z.enum(NUMBER_FORMATS),
});

/** Digits/spaces tolerated; normalized to a bare 10-digit string. */
export function normalizePhone(raw: string): string {
  return raw.replace(/[\s()-]/g, "");
}

/**
 * THE validator (no throw): every documented failure mode lands as a specific
 * field-keyed caption ending in the spec's generic GSTIN line.
 */
export function validateBusinessForm(
  values: BusinessFormValues,
): { errors: BusinessFormErrors; normalized: NormalizedBusinessForm | null } {
  const errors: BusinessFormErrors = {};

  // Mechanical pass (name/city/email/enums).
  const mechanical = mechanicalSchema.safeParse({
    legal_name: values.legal_name,
    trade_name: values.trade_name,
    address_text: values.address_text,
    city: values.city,
    email: values.email,
    registration_type: values.registration_type,
    number_format: values.number_format,
  });
  if (!mechanical.success) {
    for (const issue of mechanical.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && errors[field as BusinessFormField] === undefined) {
        errors[field as BusinessFormField] = issue.message;
      }
    }
  }

  // GSTIN law belongs to the engine (fail-union reasons surfaced verbatim).
  const gstinUpper = values.gstin.trim().toUpperCase();
  if (gstinUpper.length === 0) {
    errors["gstin"] = "GSTIN is required.";
  } else {
    const verdict = validateGstin(gstinUpper);
    if (!verdict.ok) errors["gstin"] = gstinFailCaption(verdict.reason);
  }

  // Address block: lines >= 1, 6-digit PIN.
  const lines = values.address_text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) errors["address_text"] = "At least one address line is required.";
  if (!/^\d{6}$/.test(values.pincode.trim())) {
    errors["pincode"] = "Enter the 6-digit PIN code.";
  }

  // State from the STATE_CODES universe ('' = unset is an error here).
  if (values.state_code.length === 0) errors["state_code"] = "Pick the state (place of supply).";

  // Phone optional but 10-digit when present.
  const phone = normalizePhone(values.phone.trim());
  if (phone.length > 0 && !/^\d{10}$/.test(phone)) {
    errors["phone"] = "Enter a 10-digit phone number.";
  }

  // Prefix law: charset [A-Za-z0-9-]{1,10}; required unless bare-sequence.
  const prefixTrimmed = values.prefix.trim();
  if (values.number_format !== "seq") {
    if (prefixTrimmed.length === 0) {
      errors["prefix"] = "Prefix is required for this numbering template.";
    } else if (!/^[A-Za-z0-9-]{1,10}$/.test(prefixTrimmed)) {
      errors["prefix"] =
        "Use only letters, digits and dashes (up to 10 characters).";
    }
  }

  if (Object.keys(errors).length > 0) return { errors, normalized: null };

  return {
    errors,
    normalized: {
      legal_name: values.legal_name.trim(),
      trade_name: values.trade_name.trim().length > 0 ? values.trade_name.trim() : null,
      gstin: gstinUpper,
      address: {
        lines,
        city: values.city.trim(),
        pincode: values.pincode.trim(),
      },
      state: values.state_code,
      phone: phone.length > 0 ? phone : null,
      email: values.email.trim().length > 0 ? values.email.trim() : null,
      registration_type: values.registration_type,
      number_format: values.number_format,
      prefix: values.number_format === "seq" ? null : prefixTrimmed,
    },
  };
}

/** Live numbering preview (D-77): prefix + deriveFinancialYear + fixed 4-digit pad. */
export function previewNumbering(
  template: (typeof NUMBER_FORMATS)[number],
  prefix: string,
  fy: string,
): string {
  const seq = String(4).padStart(4, "0");
  if (template === "seq") return seq;
  const p = prefix.trim();
  if (p.length === 0) return seq; // bare-sequence degradation, never crashes
  if (template === "prefix_fy_seq") return `${p}/${fy}/${seq}`;
  return `${p}-${seq}`;
}

/** Live caption for the GSTIN field while typing (same composition as submit-time). */
export function gstinLiveCaption(reason: string): string {
  return gstinFailCaption(reason);
}

/**
 * The ONLY date source for previews: local calendar date -> engine
 * deriveFinancialYear. Previews can never show a stale FY at boundaries
 * because nothing else reads the clock.
 */
export function currentFinancialYearLabel(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const res = deriveFinancialYear(`${y}-${m}-${d}`);
  return res.ok ? res.fy : "";
}
