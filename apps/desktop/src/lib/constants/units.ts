// App-level unit vocabulary for the S6 catalog (plan 03-09 Task 1).
//
// This is the UI's Select list per the S6 field order - DISTINCT from any
// storage-side vocabulary: catalog_items.unit is a free text column, so the
// app constant is the single source for what users may pick. Uppercase codes
// render verbatim in the table's Unit column.
export const UNIT_OPTIONS = [
  "PCS",
  "NOS",
  "BOX",
  "SET",
  "KG",
  "GMS",
  "MTR",
  "LTR",
  "BDL",
  "SQF",
  "TON",
  "HRS",
] as const;

export type UnitOption = (typeof UNIT_OPTIONS)[number];
