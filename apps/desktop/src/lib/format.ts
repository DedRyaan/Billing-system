// Shared money formatting for every screen: Indian digit grouping
// (₹1,23,456.78) over the paise-exact serializer from @billing/gst, so bill
// entry, invoice detail, history, dues and payments all read the same way.
import { serializePaise } from "@billing/gst";

/** "1234567" -> "12,34,567" (lakh/crore grouping). */
function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}

/** Paise (bigint) -> "₹1,23,456.78"; negatives render as "-₹…". */
export function formatPaise(paise: bigint): string {
  const s = serializePaise(paise);
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf(".");
  const whole = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? "00" : body.slice(dot + 1).padEnd(2, "0");
  return `${neg ? "-" : ""}₹${groupIndian(whole)}.${frac}`;
}

/** Rupee amount from a DB numeric (number or numeric string) -> "₹1,23,456.78". */
export function formatRupees(amount: number | string): string {
  return formatPaise(BigInt(Math.round(Number(amount) * 100)));
}
