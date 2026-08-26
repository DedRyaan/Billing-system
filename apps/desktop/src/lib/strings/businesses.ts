// S4 Businesses strings - UI-SPEC Copywriting rows owned by plan 03-07.
// ALL screen copy lives here verbatim; screens never re-type a line.
import { RETRY } from "./global";

export const BUSINESSES_SCREEN_TITLE = "Businesses";
export const SEARCH_PLACEHOLDER = "Search name or GSTIN";
export const SHOW_ARCHIVED_CHECKBOX = "Show archived";

export const EMPTY_TITLE = "No businesses yet";
export const EMPTY_BODY =
  "Create your first business profile — its GSTIN, address and numbering series hold everything else together.";

export const SHEET_CREATE_TITLE = "Add business";
export const SHEET_EDIT_TITLE = "Edit business";
export const SHEET_DETAIL_SUBTITLE = "Read-only — visible to every admin of this business.";

// Section labels (Caption uppercase per sheet anatomy).
export const SECTION_IDENTITY = "IDENTITY";
export const SECTION_GSTIN = "GSTIN";
export const SECTION_ADDRESS = "ADDRESS & STATE";
export const SECTION_CONTACT = "CONTACT";
export const SECTION_TAX = "TAX CONFIGURATION";
export const SECTION_LOGO = "LOGO";

// Identity
export const FIELD_LEGAL_NAME = "Legal name";
export const FIELD_TRADE_NAME = "Trade name (optional)";

// GSTIN
export const FIELD_GSTIN = "GSTIN";
/**
 * The spec's generic tail line. Specific fail-union captions are composed as
 * `${gstinFailCaption(reason)}` - each ends in THIS generic line so the user
 * always knows what to do next.
 */
export const GSTIN_GENERIC_LINE = "Enter a valid 15-character GSTIN.";
export const gstinFailCaption = (reason: string): string => {
  const specific: Record<string, string> = {
    WRONG_LENGTH: "GSTIN must be exactly 15 characters.",
    INVALID_CHARACTERS: "GSTIN contains unsupported characters.",
    UNKNOWN_STATE_CODE: "GSTIN's first two digits aren't a valid state code.",
    BAD_PAN_SHAPE: "The PAN portion (characters 3-12) doesn't look right.",
    DEFAULT_Z_MISSING: "The 14th character must be 'Z'.",
    ENTITY_CHAR_INVALID: "The entity code (13th character) isn't recognized.",
    CHECKSUM_FAILED: "The final check digit doesn't match.",
  };
  return `${specific[reason] ?? "This GSTIN didn't validate."} ${GSTIN_GENERIC_LINE}`;
};

// Address & State
export const FIELD_ADDRESS_LINES = "Address lines";
export const FIELD_CITY = "City";
export const FIELD_PINCODE = "PIN code";
export const FIELD_STATE = "State";
export const pincodeFailCaption = "Enter the 6-digit PIN code.";

// Contact
export const FIELD_PHONE = "Phone";
export const FIELD_EMAIL = "Email";
export const phoneFailCaption = "Enter a 10-digit phone number.";
export const emailFailCaption = "Enter a valid email address.";

// Tax configuration - consequence lines VERBATIM from the Copywriting table.
export const REGISTRATION_LABEL = "Registration type";
export const REGULAR_TITLE = "Regular";
export const REGULAR_CONSEQUENCE =
  "Issues tax invoices showing CGST+SGST or IGST separately. Buyers can claim input credit.";
export const COMPOSITION_TITLE = "Composition";
export const COMPOSITION_CONSEQUENCE =
  "Pays a flat rate on yearly turnover and cannot show tax on invoices. Buyers get no input credit.";

export const NUMBERING_LABEL = "Invoice numbering";
export const NUMBERING_HELPER =
  "Prefix locks at your first bill each financial year (April). Sequence numbers use 4 digits.";
export const NUMBERING_TEMPLATE_TITLES = {
  prefix_fy_seq: "{PREFIX}/{FY}/{SEQ}",
  prefix_seq: "{PREFIX}-{SEQ}",
  seq: "Sequence only",
} as const;
export const FIELD_PREFIX = "Prefix (letters, digits, dashes — up to 10)";
export const prefixFailCaption =
  "Use only letters, digits and dashes (up to 10 characters).";

/** Sample sequence rendered in previews ("0004" per the Copywriting row). */
export const PREVIEW_SAMPLE_SEQ = 4;

// Archive/restore confirms - VERBATIM.
export const archiveConfirmTitle = (business: string): string => `Archive ${business}?`;
export const ARCHIVE_CONFIRM_BODY =
  "Archived businesses leave daily views but keep every record for GST. No new bills can be issued. You can restore it later.";
export const ARCHIVE_CONFIRM_VERB = "Archive business";
export const RESTORE_CONFIRM_TITLE = (business: string): string => `Restore ${business}?`;
export const RESTORE_CONFIRM_BODY =
  "The business returns to daily views and can issue bills again.";
export const RESTORE_CONFIRM_VERB = "Restore business";
export const ARCHIVE_BUTTON = "Archive…";
export const RESTORE_BUTTON = "Restore…";

// Table columns + badges.
export const COL_BUSINESS = "Business";
export const COL_GSTIN = "GSTIN";
export const COL_STATE = "State";
export const COL_SCHEME = "Scheme";
export const SCHEME_REGULAR = "Regular";
export const SCHEME_COMPOSITION = "Composition";
export const STATUS_ARCHIVED_BADGE = "Archived";

// Logo upload.
export const LOGO_CAPTION = "PNG, JPG or SVG · up to 1 MB";
export const LOGO_REPLACE = "Replace";
export const LOGO_REMOVE = "Remove";
export const logoGateCaption = (reason: string): string =>
  reason === "TOO_LARGE"
    ? "Logo must be 1 MB or smaller."
    : "Logo must be a PNG, JPG or SVG image.";
export { RETRY };
export { STATE_PICK_PLACEHOLDER } from "./global";
