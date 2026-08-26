// SHELL strings - UI-SPEC Copywriting Contract rows owned by plan 03-06.
// Nav labels are D-66 locked slots; banner/tooltips verbatim from the spec.
import { CTA_ADD_BUSINESS } from "./global";

export const NAV_DASHBOARD = "Dashboard";
export const NAV_BILLS = "Bills";
export const NAV_CUSTOMERS = "Customers";
export const NAV_CATALOG = "Catalog";
export const NAV_BUSINESSES = "Businesses";
export const NAV_SETTINGS = "Settings";

/** Role captions under the sidebar footer avatar ("Admin"/"Staff"). */
export const roleCaption = (role: string | null): string =>
  role === "staff" ? "Staff" : "Admin";

/** Mutation-CTA tooltip while offline (D-82). */
export const OFFLINE_CTA_TOOLTIP = "Offline — changes can't save";

/** Slim neutral banner for archived active-business context (D-35/D-36). */
export const ARCHIVED_BANNER = "This business is archived — read-only.";

/** Switcher trigger fallback + zero-business popover empty state. */
export const SWITCHER_SELECT_PLACEHOLDER = "Select business";
export const SWITCHER_EMPTY_TITLE = "No businesses yet";
export const SWITCHER_MANAGE_LINK = "Manage businesses";
export const SWITCHER_ARCHIVED_SUFFIX = "Archived · read-only";
export { CTA_ADD_BUSINESS };

export const SIGN_OUT_ARIA_LABEL = "Sign out";

/** Placeholder screen titles/bodies - exact Copywriting table rows. */
export const PLACEHOLDER_DASHBOARD_TITLE = "Dashboard";
export const PLACEHOLDER_DASHBOARD_BODY =
  "Your dashboard arrives in Phase 8 — outstandings and revenue at a glance.";
export const PLACEHOLDER_BILLS_TITLE = "Bills";
export const PLACEHOLDER_BILLS_BODY =
  "Bill drafting arrives next — blank screen to final number in under 30 seconds.";
