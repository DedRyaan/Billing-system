// GLOBAL strings from the UI-SPEC Copywriting Contract, verbatim.
// Per-screen copy lives in sibling modules (strings/<screen>.ts) owned by the
// screen's plan - never one shared mega-file.
//
// Voice: plain, calm, Indian-business literate; zero exclamation marks;
// sentence case. Error copy states problem then next step.

/** Primary CTA pattern: verb + noun ("Add customer", "Add business", "Add item", "Sign in"). */
export const CTA_ADD_CUSTOMER = "Add customer";
export const CTA_ADD_BUSINESS = "Add business";
export const CTA_ADD_ITEM = "Add item";
export const CTA_SIGN_IN = "Sign in";

/** Save/saving pair - CTA disabled during flight. */
export const SAVE = "Save";
export const SAVING = "Saving…";

export const CANCEL = "Cancel";

/** StatePicker combobox placeholder (S4 Business / S5 Customer sheets share it). */
export const STATE_PICK_PLACEHOLDER = "Select state…";

/**
 * Routine-save feedback is SILENCE - no success toast for routine saves; the
 * row updates live (optimistic). Toasts are reserved for failures and
 * reversible destructive acts.
 */

/** Load error panel: problem + next step + [Retry]. */
export const loadErrorHeading = (entity: string): string => `Couldn't load ${entity}.`;
export const LOAD_ERROR_BODY = "Check your connection, then try again.";
export const RETRY = "Retry";

/** Mutation failure toast with [Retry] reopening the sheet, edits preserved. */
export const mutationFailureToast = (entity: string): string =>
  `Couldn't save ${entity}. Your changes were undone.`;

/** Search no-results compact variant (+ "Clear search" link resets input). */
export const searchNoResultsHeading = (query: string): string => `No results for "${query}"`;
export const SEARCH_NO_RESULTS_BODY = "Check the spelling or clear the search.";
export const CLEAR_SEARCH = "Clear search";

/** Offline banner - warning tones, non-blocking (D-82). */
export const OFFLINE_BANNER =
  "You're offline — reconnecting… Changes can't save until the connection returns.";

/** Session-end redirect reasons rendered by /login (?reason=). */
export const SESSION_ENDED_BANNER = "Your session ended. Sign in to continue.";
export const ACCOUNT_DEACTIVATED_BANNER = "This account has been deactivated. Contact an admin.";
export const ACCOUNT_LOCKED_BANNER =
  "Too many failed attempts. This account is locked — ask an admin to unlock it.";

/**
 * Invalid-credentials copy is NEVER re-typed here: surfaces import
 * GENERIC_CREDENTIALS_MESSAGE from @billing/api/errors so UI and the
 * auth-sign-in Edge Function stay byte-identical (D-73/T-3-04).
 */

/**
 * Destructive confirm pattern guidance:
 * Title as question naming the target ("Archive {name}?"); body states the
 * consequence plainly; confirm button repeats the verb ("Archive business"),
 * never "OK"/"Yes"; Cancel is visually secondary.
 */
