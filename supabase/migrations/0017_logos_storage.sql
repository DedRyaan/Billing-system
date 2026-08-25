-- ---------------------------------------------------------------------------
-- 0017_logos_storage.sql - private 'logos' bucket + tenant-path-scoped policies
--
-- D-77 logo uploads live in Supabase Storage under a business_id-scoped path.
-- T-3-01/T-3-04 mitigations:
--   * bucket is PRIVATE (public=false) - anonymous callers match no policy
--     and get nothing;
--   * EVERY verb (select/insert/update/delete) is gated through the Phase 1
--     can_access_business() membership predicate applied to the SECOND path
--     segment, so a member of business A cannot read or write business B's
--     objects even with crafted keys (T-3-02);
--   * path grammar is fixed as businesses/{businessId}/logo.{ext} - segment 2
--     after 'businesses' IS the tenant uuid, cast through ::uuid so foreign
--     ids fail server-side;
--   * deny-by-default otherwise: no public policy, no anon policy.
--
-- Policy style mirrors 0002: TO authenticated, predicates wrapped as
-- (select ...) InitPlans for one-shot evaluation.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('logos', 'logos', false)
on conflict (id) do nothing;

-- Path-scope guard shared by every policy below: the key must sit inside the
-- businesses/{uuid}/ grammar BEFORE the uuid cast is attempted, so objects
-- outside the tenant grammar simply match no policy row (deny-by-default)
-- instead of raising a cast error.
--   name like 'businesses/%/%'  -> at least two segments after bucket prefix
--   split part [2] is the tenant uuid (1-based: ['businesses', '{uuid}', ...])

create policy "logos members-read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'logos'
    and name like 'businesses/%/%'
    and (select public.can_access_business((regexp_split_to_array(name, '/'))[2]::uuid))
  );

create policy "logos members-insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and name like 'businesses/%/%'
    and (select public.can_access_business((regexp_split_to_array(name, '/'))[2]::uuid))
  );

create policy "logos members-update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and name like 'businesses/%/%'
    and (select public.can_access_business((regexp_split_to_array(name, '/'))[2]::uuid))
  )
  with check (
    bucket_id = 'logos'
    and name like 'businesses/%/%'
    and (select public.can_access_business((regexp_split_to_array(name, '/'))[2]::uuid))
  );

create policy "logos members-delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos'
    and name like 'businesses/%/%'
    and (select public.can_access_business((regexp_split_to_array(name, '/'))[2]::uuid))
  );
