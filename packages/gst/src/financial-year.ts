/**
 * Indian financial-year derivation over IST calendar dates (SC-4).
 *
 * The engine is pure: inputs are structured calendar dates or strict
 * 'YYYY-MM-DD' strings. No system clock, no timezone API, no platform Date
 * object is consulted (RESEARCH Don't-Hand-Roll row 1) — callers own the
 * IST conversion at the app edge.
 *
 * Label convention matches the invoices.fy text column
 * (supabase/migrations/0004_documents.sql:52): '26-27' style, FY starting
 * April 1. Month >= 4 maps the calendar year to the FY start; months 1-3
 * belong to the previous year's FY.
 */

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export type FyResult =
  | { ok: true; fy: string }
  | { ok: false; reason: 'MALFORMED_DATE' };

const DAYS_IN_MONTH: readonly number[] = [
  0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

function isLeapYear(year: number): boolean {
  // Divisible by 4, except centuries, unless divisible by 400.
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isValidCalendarDate(d: CalendarDate): boolean {
  if (!Number.isInteger(d.year) || !Number.isInteger(d.month) || !Number.isInteger(d.day)) {
    return false;
  }
  if (d.year < 1 || d.year > 9999) return false;
  if (d.month < 1 || d.month > 12) return false;
  const max = DAYS_IN_MONTH[d.month];
  if (max === undefined) return false;
  const limit = d.month === 2 && isLeapYear(d.year) ? 29 : max;
  return d.day >= 1 && d.day <= limit;
}

function twoDigit(n: number): string {
  return n.toString().padStart(2, '0');
}

function fyLabel(fyStartYear: number): string {
  const yy = ((fyStartYear % 100) + 100) % 100;
  return `${twoDigit(yy)}-${twoDigit((yy + 1) % 100)}`;
}

/**
 * Derive the 'YY-YY+1' financial-year label for an Indian FY (April-March).
 * Returns a typed rejection for impossible dates — never throws, never
 * falls back to platform date machinery.
 */
export function deriveFinancialYear(input: CalendarDate | string): FyResult {
  let date: CalendarDate;

  if (typeof input === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    if (m === null) return { ok: false, reason: 'MALFORMED_DATE' };
    date = {
      year: Number(m[1] ?? ''),
      month: Number(m[2] ?? ''),
      day: Number(m[3] ?? ''),
    };
  } else if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    date = { year: input.year, month: input.month, day: input.day };
  } else {
    return { ok: false, reason: 'MALFORMED_DATE' };
  }

  if (!isValidCalendarDate(date)) {
    return { ok: false, reason: 'MALFORMED_DATE' };
  }

  const fyStartYear = date.month >= 4 ? date.year : date.year - 1;
  return { ok: true, fy: fyLabel(fyStartYear) };
}
