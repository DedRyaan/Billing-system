/**
 * Indian state/UT GST code table with legislature naming metadata.
 *
 * Assumption A1 (RESEARCH): the universe is exactly codes '01'..'38'
 * (including Ladakh 38 and the merged DNH & Daman-Diu 26) plus '97' Other
 * Territory — 39 entries. Assumption A2: Delhi, Puducherry and Jammu &
 * Kashmir have legislatures, so their second intra-supply head is NAMED
 * SGST; Chandigarh, A&N Islands, Lakshadweep, DNH&DD and Ladakh are named
 * UTGST. Both assumptions are flagged for CA confirmation at UAT — the
 * flags live inline on each entry rather than being derived from name
 * heuristics.
 *
 * Code correction vs plan 02-03 (Rule 1, official CBIC gst.gov.in list):
 * Lakshadweep is '31' (the plan's '36' is Telangana, a plain state whose
 * invoices must name SGST). Entries carry BOTH `isUt` and
 * `isUtWithLegislature` so states and non-legislature UTs stay distinct —
 * the naming split needs both facts.
 *
 * This module is intentionally dependency-free of every other engine file
 * and holds naming metadata ONLY: no arithmetic, no head decisions. The
 * head decision itself stays pure code-equality in place-of-supply.ts
 * (RESEARCH Pitfall 3 prevention — never compare UT names as strings).
 */

export interface StateCodeEntry {
  readonly code: string;
  readonly name: string;
  /** True for union territories (incl. Other Territory), false for states. */
  readonly isUt: boolean;
  readonly isUtWithLegislature: boolean;
}

export const STATE_CODES: readonly StateCodeEntry[] = [
  { code: '01', name: 'Jammu & Kashmir', isUt: true, isUtWithLegislature: true },
  { code: '02', name: 'Himachal Pradesh', isUt: false, isUtWithLegislature: false },
  { code: '03', name: 'Punjab', isUt: false, isUtWithLegislature: false },
  { code: '04', name: 'Chandigarh', isUt: true, isUtWithLegislature: false },
  { code: '05', name: 'Uttarakhand', isUt: false, isUtWithLegislature: false },
  { code: '06', name: 'Haryana', isUt: false, isUtWithLegislature: false },
  { code: '07', name: 'Delhi', isUt: true, isUtWithLegislature: true },
  { code: '08', name: 'Rajasthan', isUt: false, isUtWithLegislature: false },
  { code: '09', name: 'Uttar Pradesh', isUt: false, isUtWithLegislature: false },
  { code: '10', name: 'Bihar', isUt: false, isUtWithLegislature: false },
  { code: '11', name: 'Sikkim', isUt: false, isUtWithLegislature: false },
  { code: '12', name: 'Arunachal Pradesh', isUt: false, isUtWithLegislature: false },
  { code: '13', name: 'Nagaland', isUt: false, isUtWithLegislature: false },
  { code: '14', name: 'Manipur', isUt: false, isUtWithLegislature: false },
  { code: '15', name: 'Mizoram', isUt: false, isUtWithLegislature: false },
  { code: '16', name: 'Tripura', isUt: false, isUtWithLegislature: false },
  { code: '17', name: 'Meghalaya', isUt: false, isUtWithLegislature: false },
  { code: '18', name: 'Assam', isUt: false, isUtWithLegislature: false },
  { code: '19', name: 'West Bengal', isUt: false, isUtWithLegislature: false },
  { code: '20', name: 'Jharkhand', isUt: false, isUtWithLegislature: false },
  { code: '21', name: 'Odisha', isUt: false, isUtWithLegislature: false },
  { code: '22', name: 'Chhattisgarh', isUt: false, isUtWithLegislature: false },
  { code: '23', name: 'Madhya Pradesh', isUt: false, isUtWithLegislature: false },
  { code: '24', name: 'Gujarat', isUt: false, isUtWithLegislature: false },
  {
    code: '25',
    name: 'Daman & Diu (legacy)',
    isUt: true,
    isUtWithLegislature: false,
  },
  {
    code: '26',
    name: 'Dadra & Nagar Haveli and Daman & Diu',
    isUt: true,
    isUtWithLegislature: false,
  },
  { code: '27', name: 'Maharashtra', isUt: false, isUtWithLegislature: false },
  {
    code: '28',
    name: 'Andhra Pradesh (legacy, pre-2014)',
    isUt: false,
    isUtWithLegislature: false,
  },
  { code: '29', name: 'Karnataka', isUt: false, isUtWithLegislature: false },
  { code: '30', name: 'Goa', isUt: false, isUtWithLegislature: false },
  { code: '31', name: 'Lakshadweep', isUt: true, isUtWithLegislature: false },
  { code: '32', name: 'Kerala', isUt: false, isUtWithLegislature: false },
  { code: '33', name: 'Tamil Nadu', isUt: false, isUtWithLegislature: false },
  { code: '34', name: 'Puducherry', isUt: true, isUtWithLegislature: true },
  {
    code: '35',
    name: 'Andaman & Nicobar Islands',
    isUt: true,
    isUtWithLegislature: false,
  },
  { code: '36', name: 'Telangana', isUt: false, isUtWithLegislature: false },
  { code: '37', name: 'Andhra Pradesh', isUt: false, isUtWithLegislature: false },
  { code: '38', name: 'Ladakh', isUt: true, isUtWithLegislature: false },
  { code: '97', name: 'Other Territory', isUt: true, isUtWithLegislature: false },
];

const BY_CODE: ReadonlyMap<string, StateCodeEntry> = new Map(
  STATE_CODES.map((entry) => [entry.code, entry]),
);

/** Membership check against the full A1 universe (validators own rejection messaging). */
export function isValidStateCode(code: string): boolean {
  return BY_CODE.has(code);
}

/** Typed lookup returning the entry or undefined for unknown codes — never throws. */
export function getStateEntry(code: string): StateCodeEntry | undefined {
  return BY_CODE.get(code);
}

/**
 * Name of the second head for an intra-state/UT supply: 'SGST' for states
 * and legislature UTs (A2), 'UTGST' for the non-legislature UTs and Other
 * Territory. Unknown codes yield `undefined` — a plausible-looking default
 * here could print a wrong statutory label (UTGST vs SGST) on invoices;
 * callers validate first (derivePlaceOfSupply does) and must treat
 * `undefined` as the impossible-branch signal it is.
 */
export function secondHeadNameFor(
  code: string,
): 'SGST' | 'UTGST' | undefined {
  const entry = BY_CODE.get(code);
  if (entry === undefined) return undefined;
  if (!entry.isUt) return 'SGST'; // plain states always name SGST
  return entry.isUtWithLegislature ? 'SGST' : 'UTGST';
}
