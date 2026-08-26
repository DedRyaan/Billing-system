// S5 Customers strings - UI-SPEC Copywriting rows owned by plan 03-08.
import { RETRY } from "./global";

export const CUSTOMERS_SCREEN_TITLE = "Customers";
export const SEARCH_PLACEHOLDER = "Search name, phone or GSTIN";
export const CTA_ADD = "Add customer";

export const EMPTY_TITLE = "No customers yet";
export const EMPTY_BODY =
  "Add your first customer — bills will pick their details straight from here.";

export const SHEET_CREATE_TITLE = "Add customer";
export const SHEET_EDIT_TITLE = "Edit customer";

export const FIELD_NAME = "Legal name*";
export const FIELD_GSTIN = "GSTIN (optional)";
export const FIELD_PHONE = "Phone";
export const FIELD_ADDRESS = "Address lines";
export const FIELD_CITY = "City";
export const FIELD_STATE = "State*";
export const FIELD_NOTES = "Notes";

export const nameRequiredCaption = "Legal name is required.";
export const nameTooLongCaption = "Name must be 200 characters or fewer.";
/** Specific fail-union caption composed with the generic tail line (S4 parity). */
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

// Auto-fetch machine hints - VERBATIM Copywriting rows. Neither blocks Save.
export const FETCH_CHECKING_CAPTION = "Checking GST registry…";
export const FETCH_VERIFIED_HINT =
  "Filled from the GST public registry — edit anything before saving.";
export const FETCH_FALLBACK_HINT =
  "Couldn't fetch automatically. Fill the details manually — nothing is blocked.";

// Table columns.
export const COL_CUSTOMER = "Customer";
export const COL_CITY = "City";
export const COL_STATE = "State";
export const COL_GSTIN = "GSTIN";
export const COL_UPDATED = "Updated";

export { RETRY };
