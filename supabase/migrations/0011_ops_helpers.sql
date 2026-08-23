-- Migration 0011: ops helpers — live keep-alive target reaffirmation (Plan 10)
--
-- public.health_check() is the D-39 free-tier keep-alive RPC: a SECURITY
-- DEFINER constant read that the daily GitHub Actions ping calls through
-- PostgREST with the anon key, counting as database activity without ever
-- touching tenant rows or tripping RLS 401s (RESEARCH Pattern 8 / Pitfall 6).
--
-- The definition already exists locally since 0006; this migration re-states
-- it with CREATE OR REPLACE so the [BLOCKING] cloud push of Plans 01-10
-- GUARANTEES the keep-alive target exists on the live Mumbai-region project
-- (ap-south-1) even if an earlier file's copy is ever refactored away.
-- Idempotent with any earlier local definition by construction.
--
-- Grants mirror 0006 exactly: EXECUTE revoked from PUBLIC, then granted to
-- anon + authenticated + service_role — unauthenticated-cheap liveness is
-- the entire point.

create or replace function public.health_check() returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'ok'::text
$$;

revoke execute on function public.health_check()
  from public;
grant execute on function public.health_check()
  to anon, authenticated, service_role;
