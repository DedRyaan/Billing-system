// Query-key factory (D-81/BIZ-04): every server-state key is produced ONLY
// here as a frozen [entity, businessId, ...rest] tuple. Switching businesses
// invalidates stale cache BY CONSTRUCTION - two different businessIds can
// never collide, and prefix matching powers switch-time invalidation.

export const GLOBAL_BUSINESS = "global";

export type BusinessScope = string; // business uuid or GLOBAL_BUSINESS

function key(entity: string, scope: BusinessScope, rest: readonly unknown[]): readonly unknown[] {
  return Object.freeze([entity, scope, ...rest]);
}

export const keysFor = {
  /** Owner-visible table; omit businessId for the global listing. */
  businesses: (businessId?: BusinessScope, ...rest: readonly unknown[]) =>
    key("businesses", businessId ?? GLOBAL_BUSINESS, rest),
  customers: (businessId: BusinessScope, ...rest: readonly unknown[]) =>
    key("customers", businessId, rest),
  catalogItems: (businessId: BusinessScope, ...rest: readonly unknown[]) =>
    key("catalog_items", businessId, rest),
  /** Invoice drafts + issued documents, business-scoped (D-81/BIZ-04). */
  invoices: (businessId: BusinessScope, ...rest: readonly unknown[]) =>
    key("invoices", businessId, rest),
  /**
   * Payment history per invoice (PAY-01..03, D-79 single-door).
   * rest carries optional [invoiceId] for per-invoice history.
   */
  payments: (businessId: BusinessScope, ...rest: readonly unknown[]) =>
    key("payments", businessId, rest),
  /** Open invoices sorted by age (PAY-04). Business-scoped. */
  outstandings: (businessId: BusinessScope, ...rest: readonly unknown[]) =>
    key("outstandings", businessId, rest),
  /** Scope is a business OR a staff user id depending on the surface. */
  memberships: (scope: BusinessScope, ...rest: readonly unknown[]) =>
    key("memberships", scope, rest),
  /**
   * Admin roster (IN-01): global-scope so business switches never sweep it.
   * Factory-owned per D-81 - TeamSection may not hand-roll this tuple.
   */
  membershipsRoster: () => key("memberships", GLOBAL_BUSINESS, ["roster"]),
} as const;
