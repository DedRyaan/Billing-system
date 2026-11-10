-- ---------------------------------------------------------------------------
-- 0028_unregistered_businesses.sql - businesses without a GSTIN
--
-- A business that is not registered for GST has no GSTIN and cannot charge
-- GST. It gets registration_type 'unregistered'; the @billing/gst engine
-- computes every line at 0% and issues a Bill of Supply.
--
--   * businesses.gstin becomes nullable (the UNIQUE constraint still holds
--     for every real GSTIN; NULLs never collide).
--   * registration_type gains 'unregistered' on businesses and invoices
--     (invoices mirror the business at issue).
--   * A pairing check keeps the two honest: unregistered <=> no GSTIN.
-- ---------------------------------------------------------------------------

alter table public.businesses alter column gstin drop not null;

alter table public.businesses drop constraint businesses_registration_type_check;
alter table public.businesses add constraint businesses_registration_type_check
  check (registration_type in ('regular', 'composition', 'unregistered'));

alter table public.businesses add constraint businesses_gstin_matches_registration
  check ((registration_type = 'unregistered') = (gstin is null));

alter table public.invoices drop constraint invoices_registration_type_check;
alter table public.invoices add constraint invoices_registration_type_check
  check (registration_type in ('regular', 'composition', 'unregistered'));

comment on column public.businesses.gstin is
  'GSTIN of a GST-registered business; NULL exactly when registration_type = ''unregistered''.';

comment on column public.businesses.registration_type is
  'Tax registration: ''regular'' | ''composition'' | ''unregistered'' (no GSTIN, no GST charged, Bill of Supply). Mirrored onto invoices.registration_type at issue.';
