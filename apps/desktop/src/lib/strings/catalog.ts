// S6 Catalog strings - UI-SPEC Copywriting rows owned by plan 03-09.
import { RETRY } from "./global";

export const CATALOG_SCREEN_TITLE = "Catalog";
export const SEARCH_PLACEHOLDER = "Search name or HSN/SAC";
export const CTA_ADD_ITEM = "Add item";

export const EMPTY_TITLE = "Catalog is empty";
export const EMPTY_BODY =
  "Add the products and services you bill most often. Bills pick items from this list.";

export const SHEET_CREATE_TITLE = "Add item";
export const SHEET_EDIT_TITLE = "Edit item";
export const READONLY_NOTE = "Read-only — catalog edits are admin-only.";

export const FIELD_NAME = "Name*";
export const FIELD_TYPE = "Type*";
export const TYPE_GOODS = "Goods";
export const TYPE_SERVICES = "Services";
/** Segmented control drives label + validator kind: goods→HSN, services→SAC. */
export const codeLabelFor = (kind: "goods" | "services"): string =>
  kind === "services" ? "SAC*" : "HSN*";

export const FIELD_HSN_SAC = "HSN/SAC";
export const FIELD_GST_RATE = "GST rate*";
export const FIELD_UNIT = "Unit*";
export const FIELD_PRICE = "Price*";
export const FIELD_MRP = "MRP (optional)";
export const FIELD_STOCK = "Stock qty";

// Soft HSN/SAC warning captions (never block save).
export const hsnSacWarningCaption = (reason: string): string => {
  const specific: Record<string, string> = {
    EMPTY: "HSN/SAC is empty.",
    NON_DIGIT_CHARS: "HSN/SAC must contain digits only.",
    BAD_HSN_LENGTH: "HSN codes are usually 4, 6 or 8 digits.",
    BAD_SAC_LENGTH: "SAC codes are 6 digits.",
    SAC_PREFIX_INVALID: "SAC codes start with 99.",
  };
  return `${specific[reason] ?? "This code looks unusual."} You can still save.`;
};

// Hard-block captions.
export const nameRequiredCaption = "Name is required.";
export const priceFailCaption = "Enter a valid rupee amount (e.g. 149.50).";
export const stockFailCaption = "Stock must be a whole number of 0 or more.";

// Deactivate/reactivate confirms.
export const deactivateConfirmTitle = (name: string): string => `Deactivate ${name}?`;
export const DEACTIVATE_CONFIRM_BODY =
  "Deactivated items disappear from bill picking but keep their history on past bills.";
export const DEACTIVATE_CONFIRM_VERB = "Deactivate item";
export const REACTIVATE_CONFIRM_TITLE = (name: string): string => `Reactivate ${name}?`;
export const REACTIVATE_CONFIRM_BODY =
  "The item returns to bill picking immediately.";
export const REACTIVATE_CONFIRM_VERB = "Reactivate item";
export const DEACTIVATE_BUTTON = "Deactivate…";
export const REACTIVATE_BUTTON = "Reactivate…";

// Table columns.
export const COL_ITEM = "Item";
export const COL_CODE = "HSN/SAC";
export const COL_RATE = "Rate";
export const COL_UNIT = "Unit";
export const COL_PRICE = "Price";
export const COL_MRP = "MRP";
export const COL_STOCK = "Stock";

export { RETRY };
