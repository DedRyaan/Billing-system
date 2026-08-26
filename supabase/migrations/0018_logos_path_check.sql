-- ---------------------------------------------------------------------------
-- 0018_logos_path_check.sql - crafted logos paths deny cleanly (no raw 22P02)
--
-- IN-10 deferred half. 0017's tenant-path guard casts the second path segment
-- straight through ::uuid:
--
--     name like 'businesses/%/%'
--     and can_access_business((regexp_split_to_array(name, '/'))[2]::uuid)
--
-- The LIKE prefilter guarantees a second segment EXISTS but not that it IS a
-- uuid, so any authenticated member could send e.g. 'businesses/zzz/logo.png'
-- or 'businesses//logo.png' and get a raw
--   invalid input syntax for type uuid: "zzz"   (SQLSTATE 22P02)
-- instead of the designed policy denial. An unhandled cast crash inside an
-- RLS predicate is both an ugly client surface and free oracle noise.
--
-- Repair shape follows the replace-in-new-migration precedent (0011, 0012):
-- the applied 0017 file is NOT edited; this forward migration
--   1. adds public.logos_path_business_id() - the ONLY uuid acquisition path,
--      regex-gated to the documented grammar businesses/{uuid}/... so a
--      non-uuid segment yields NULL and NULL propagates to a clean
--      can_access_business(NULL) = false denial (deny-by-default, loud in
--      effect: no row matches, storage returns not-found/not-allowed);
--   2. recreates all five logos policies byte-identically EXCEPT the segment
--      acquisition, which now goes through the helper. Policies cannot be
--      ALTERed in place, so drop-if-exists + create IS the additive pattern;
--      names, verbs, roles and InitPlan wrapping are preserved.
--
-- Acceptance-set note: the regex admits the canonical hyphenated uuid form
-- (upper- or lowercase) - everything ::uuid would have swallowed AND more it
-- would have crashed on now lands in exactly two buckets: valid-grammar ids
-- proceed to the membership check exactly as before; every other crafted
-- shape denies cleanly. App-written keys embed ids verbatim from Postgres
-- output (lowercase canonical), so no legitimate path regresses.
-- ---------------------------------------------------------------------------

create or replace function public.logos_path_business_id(p_name text)
returns uuid
language sql
immutable
-- Security-boundary helper evaluated inside storage RLS: resolve NOTHING
-- beyond pg_catalog (implicitly searched first) - an empty search_path makes
-- schema-shadowing of the built-ins impossible regardless of caller.
set search_path = ''
as $$
  select case
    when p_name ~ '^businesses/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(/|$)'
    then (regexp_split_to_array(p_name, '/'))[2]::uuid
  end;
$$;

-- ---------------------------------------------------------------------------
-- Policies recreated with the helper-swapped predicate (0017 shapes otherwise
-- preserved verbatim: same names, TO authenticated, (select ...) InitPlans).
-- ---------------------------------------------------------------------------

drop policy if exists "logos members-read" on storage.objects;
create policy "logos members-read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'logos'
    and name like 'businesses/%/%'
    and (select public.can_access_business(public.logos_path_business_id(name)))
  );

drop policy if exists "logos members-insert" on storage.objects;
create policy "logos members-insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and name like 'businesses/%/%'
    and (select public.can_access_business(public.logos_path_business_id(name)))
  );

drop policy if exists "logos members-update" on storage.objects;
create policy "logos members-update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and name like 'businesses/%/%'
    and (select public.can_access_business(public.logos_path_business_id(name)))
  )
  with check (
    bucket_id = 'logos'
    and name like 'businesses/%/%'
    and (select public.can_access_business(public.logos_path_business_id(name)))
  );

drop policy if exists "logos members-delete" on storage.objects;
create policy "logos members-delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos'
    and name like 'businesses/%/%'
    and (select public.can_access_business(public.logos_path_business_id(name)))
  );
