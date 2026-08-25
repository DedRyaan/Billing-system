-- ---------------------------------------------------------------------------
-- 0016_business_profile.sql - BIZ-01/BIZ-02/BIZ-05 master-data columns (D-77)
--
-- Extends businesses with the profile fields Phase 3's nine-screen contract
-- renders (identity / address+state / contact / tax configuration / logo),
-- and customers with an optional notes textarea (S5, 03-UI-SPEC).
--
-- Additive-only in the 0015 style: every column is nullable or defaulted so
-- existing rows are untouched. NO grant or policy changes - new columns
-- inherit businesses'/customers' existing table grants and member-scoped RLS
-- from migration 0002/0005; no new access path exists.
-- ---------------------------------------------------------------------------

alter table public.businesses add column address jsonb;

alter table public.businesses add column state text;

alter table public.businesses add column phone text;

alter table public.businesses add column email text;

alter table public.businesses add column registration_type text not null default 'regular'
  check (registration_type in ('regular', 'composition'));

alter table public.businesses add column logo_path text;

alter table public.customers add column notes text;

comment on column public.businesses.address is
  'Free-form business address jsonb ({lines[], city, pincode}), same convention as customers.address. BIZ-01/D-77 identity section; rendered by the Phase 3 business sheet (S4, 03-UI-SPEC). Nullable master data behind existing super-admin write policies.';

comment on column public.businesses.state is
  'GST state CODE for the business''s own place of business - one of the @billing/gst STATE_CODES universe (two-digit strings, e.g. ''27''). BIZ-01/D-77; consumed by place-of-supply derivation defaults and invoice headers.';

comment on column public.businesses.phone is
  'Optional contact phone number. BIZ-02/D-77 contact section (03-UI-SPEC S4).';

comment on column public.businesses.email is
  'Optional contact email rendered on invoice headers and the business sheet. BIZ-02/D-77.';

comment on column public.businesses.registration_type is
  'Tax registration type: ''regular'' | ''composition'' (BIZ-05/D-30 vocabulary, matching invoices.registration_type strings). Defaults to ''regular''; composition businesses surface their scheme''s consequence line in the tax-configuration section (D-77).';

comment on column public.businesses.logo_path is
  'Storage object path of the business logo inside the private ''logos'' bucket, grammar businesses/{businessId}/logo.{ext} (0017 policies scope every segment to the tenant). Rendered via short-lived signed URLs only.';

comment on column public.customers.notes is
  'Optional free-text notes textarea (S5 section, 03-UI-SPEC). Additive convenience column behind existing customer member-write policies.';
