-- ---------------------------------------------------------------------------
-- 0015_catalog_mrp.sql — D-59 optional catalog MRP column
--
-- Adds the nullable MRP field that feeds the statutory "MRP Rs X inclusive
-- of taxes" declaration (wording source for Phase 6 PDF rendering) and lets
-- inclusive-mode billing default its price from MRP (D-58).
--
-- Nullable, no default, no NOT NULL: existing catalog rows are untouched.
-- No grant/policy changes: the column inherits catalog_items' existing
-- table grants and member-read RLS from Phase 1; no new access path.
-- ---------------------------------------------------------------------------

alter table public.catalog_items add column mrp numeric(14,2);

comment on column public.catalog_items.mrp is
  'Optional maximum retail price inclusive of taxes (D-59). Source for the statutory MRP declaration rendered by Phase 6 and a default seed for tax-inclusive line pricing (D-58). Nullable master data behind existing admin-only write policies.';
