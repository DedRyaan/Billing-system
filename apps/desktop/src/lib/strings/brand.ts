// Product identity - the ONE place the app's name lives in the UI.
// "Bahi" is the traditional bound ledger (bahi-khata) Indian traders keep.
export const APP_NAME = "Bahi";
export const APP_TAGLINE = "GST billing for every business you run";

/**
 * Login-screen easter eggs: one is picked at random on each visit. Ledger,
 * chai and shop-floor humour - short, warm, never about the user.
 */
export const LOGIN_PHRASES: readonly string[] = [
  "Every rupee in its rightful column.",
  "CGST and SGST, perfectly balanced, as all things should be.",
  "Shubh labh. Now let's make it official.",
  "The red cloth ledger, minus the red cloth.",
  "Round-off: the most honest paisa in the shop.",
  "Udhaar remembered, so you don't have to.",
  "Chai first. Bills second. Both are hot.",
  "No carbon paper was harmed in making this bill.",
  "Your munim works 24×7 and never asks for Diwali bonus.",
  "Place of supply? We've got it mapped.",
  "Debit, credit, and a little bit of chai.",
  "Invoices numbered without a single gap. Your CA will weep with joy.",
  "HSN codes: eight digits of pure poetry.",
  "Balance due is just a payment that hasn't happened yet.",
  "Khata khol. Hisaab saaf.",
  "Even the abacus is impressed.",
];

/**
 * Random phrase, never the one shown on the previous visit. `random` and
 * `storage` are injectable so tests stay deterministic; storage failures
 * (private mode, blocked storage) just fall back to a plain random pick.
 */
export function pickLoginPhrase(
  random: () => number = Math.random,
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeLocalStorage(),
): string {
  let last = -1;
  try {
    last = Number(storage?.getItem(LAST_PHRASE_KEY) ?? -1);
  } catch {
    last = -1;
  }
  const pool = LOGIN_PHRASES.length - (last >= 0 && last < LOGIN_PHRASES.length ? 1 : 0);
  let i = Math.min(Math.floor(random() * pool), pool - 1);
  if (last >= 0 && last < LOGIN_PHRASES.length && i >= last) i += 1;
  try {
    storage?.setItem(LAST_PHRASE_KEY, String(i));
  } catch {
    // per-viewer nicety only
  }
  return LOGIN_PHRASES[i]!;
}

const LAST_PHRASE_KEY = "bahi.lastLoginPhrase";

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
