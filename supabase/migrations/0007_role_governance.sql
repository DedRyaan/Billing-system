-- Migration 0007: role governance — peer protection, lock mirror, lifecycle RPCs (Plan 06)
--
-- Encodes the AUTH-03 role lifecycle as non-negotiable database predicates so
-- Phase 3 UI merely reflects what Postgres already enforces:
--
--   D-11       regular admins manage staff but NEVER other admins; only
--              super_admin manages admins — enforced by policy shape PLUS a
--              BEFORE UPDATE guard that makes the denial LOUD (42501) instead
--              of a silent zero-row filter
--   D-28/D-29  profiles.locked_at mirrors GoTrue ban state (set by Plan 07's
--              lockout machinery via the service key); cleared ONLY through
--              unlock_account_profile(), the narrow exception any admin may
--              invoke on a locked-out super admin — and which changes nothing
--              except the lock itself
--   T-1-21     users cannot self-edit role/is_active even by forging direct
--              UPDATEs — escalation dies in the guard trigger, defense-in-depth
--              BEYOND RLS so a future policy regression cannot promote anyone
--   D-14       super-admin status moves only through the deliberate
--              initiate/confirm pair (confirm by the pending target, within
--              one hour); the old holder lands as a plain peer-protected admin
--   D-15/D-37  business creation, archive and restore are super-admin-only,
--              reachable through audited RPCs
--
-- PRIVILEGED-MUTATION MARKER CONTRACT: role, is_active, locked_at,
-- pending_transfer_to and transfer_initiated_at change EXCLUSIVELY inside
-- lifecycle RPCs, which set the transaction-local flag
--   perform set_config('gsd.privileged_mutation', 'on', true);
-- before mutating. The guard rejects privileged-column changes whenever the
-- marker is absent — it trusts server-side execution context, never
-- client-supplied values. ANY FUTURE RPC that must touch these columns MUST
-- set the same marker first (search this file for set_config examples).
--
-- SYSTEM/SERVICE CONTEXT CONVENTION (same as 0004's trg_staff_discount_guard
-- and 0005's catalog guard): migrations, bootstrap flows and Plan 07's
-- service-key lockout writer run without a JWT sub, so auth.uid() resolves to
-- NULL and the guard exempts them. Authenticated clients ALWAYS carry a JWT
-- sub, so the guard binds every real client context. This keeps the existing
-- superuser-fixture style of the pgTAP suites working unchanged.
--
-- SESSION-REVOCATION HOOK (D-19/D-20): deactivation's enforcement is the
-- is_active gate inside current_user_role()/can_access_business() — helpers
-- re-read profiles on every query, so a deactivated account's next query sees
-- ZERO rows regardless of token validity (instant data-plane death). GoTrue
-- login-blocking/ban-clearing and refresh-token revocation ride Plan 07's
-- service-role endpoints; the residual stale-access-token window (~JWT exp)
-- is RESEARCH Pitfall 4 / T-1-23, flagged assumption AUTH-03-jwt-staleness.
--
-- Every RPC below appends write_audit entries (D-23 permission events /
-- T-1-24); the 0006 capture triggers additionally log raw before/after row
-- images on profiles and businesses.
--
-- Conventions inherited from Waves 1-4: ENABLE + FORCE row level security,
-- TO authenticated policies, SECURITY DEFINER with fixed search_path = public,
-- EXECUTE revoked from PUBLIC on sensitive functions.

-- ---------------------------------------------------------------------------
-- Task 1: lock mirror column + anti-self-promotion guard
-- ---------------------------------------------------------------------------

-- D-28/D-29 mirror of GoTrue ban state. Set by Plan 07's lockout machinery
-- (service key, no JWT sub -> guard-exempt); cleared ONLY by
-- unlock_account_profile(). Never consulted for authorization directly —
-- is_active/role drive access — it exists so the data layer records WHY an
-- account cannot sign in and so unlock is a first-class audited event.
alter table public.profiles
  add column locked_at timestamptz;

-- ---------------------------------------------------------------------------
-- guard_profile_privileged_columns — BEFORE UPDATE on profiles.
--
-- Two gates, evaluated for every client-context row update (JWT sub present):
--   Gate P (peer protection, D-11): a caller whose effective role is not
--     super_admin may not mutate ANOTHER admin's row AT ALL — edit, demote or
--     remove. Raises 42501 loudly. Rows the RLS layer already hides (e.g. an
--     admin reaching a super_admin row) still filter silently at the policy
--     layer; this gate catches the rows the reshaped admin policy below
--     deliberately exposes so denials become observable.
--   Gate M (privileged columns, T-1-21): role / is_active / locked_at /
--     pending_transfer_to / transfer_initiated_at may change only inside a
--     lifecycle RPC (marker present). Direct forged UPDATEs die here with a
--     named-column exception REGARDLESS of what any future policy allows.
--
-- Self-edits are exempt from Gate P (users manage their own identity display
-- data) but NOT from Gate M (nobody promotes, deactivates or unlocks self by
-- direct UPDATE). Super_admin callers are exempt from Gate P only — their
-- privileged-column changes still require the marker, i.e. the audited RPCs.
-- ---------------------------------------------------------------------------

create or replace function public.guard_profile_privileged_columns() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_changed     text[];
  v_marker      text;
  v_caller_role text;
begin
  -- System/service contexts (migrations, bootstrap, Plan 07 service-key
  -- lockout writer): no JWT sub -> exempt. Convention parity with 0004/0005.
  if (select auth.uid()) is null then
    return new;
  end if;

  select coalesce(array_agg(o.key order by o.key), array[]::text[])
    into v_changed
    from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n on n.key = o.key
   where o.value is distinct from n.value;

  v_marker      := nullif(current_setting('gsd.privileged_mutation', true), '');
  v_caller_role := (select public.current_user_role());

  -- Gate P: D-11 peer protection — loud denial on another admin's row.
  if old.role = 'admin'
     and old.id <> (select auth.uid())
     and v_caller_role is distinct from 'super_admin'
  then
    raise exception 'gsd-guard: admins are peer-protected - only super_admin manages admins D-11'
      using errcode = insufficient_privilege; -- 42501
  end if;

  -- Gate M: privileged columns flow exclusively through audited lifecycle RPCs.
  if v_changed && array['role',
                        'is_active',
                        'locked_at',
                        'pending_transfer_to',
                        'transfer_initiated_at']
     and v_marker is distinct from 'on'
  then
    raise exception 'gsd-guard: privileged columns % may only change through lifecycle RPCs',
      array_to_string(v_changed, ', ')
      using errcode = raise_exception; -- P0001, distinct from policy 42501
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_profile_privileged_columns()
  from public;
revoke execute on function public.guard_profile_privileged_columns()
  from anon;
revoke execute on function public.guard_profile_privileged_columns()
  from authenticated;

create trigger trg_profile_privileged_guard
  before update on public.profiles
  for each row
execute function public.guard_profile_privileged_columns();

-- ---------------------------------------------------------------------------
-- Policy adjustments (defense-in-depth reshape; D-11 semantics unchanged).
--
-- "profiles admin-manages-staff" is reshaped so an admin's UPDATE MATCHES peer
-- admin rows in USING (making the guard's peer-protection denial observable
-- with 42501) while WITH CHECK still pins writable outcomes to staff rows —
-- a demoting forge dies at the trigger first; if the trigger were ever
-- dropped, WITH CHECK backstops the denial. Staff-row management rights are
-- exactly what Plan 01 granted.
--
-- "profiles self-update" is ADDED: every user may update their own row so the
-- plan's "direct callers may change full_name only on their own row" holds —
-- privileged columns on that row remain impossible to change directly because
-- Gate M rejects them. Plan 01's self-read and super-admin-all policies stand
-- untouched.
-- ---------------------------------------------------------------------------

drop policy "profiles admin-manages-staff" on public.profiles;

create policy "profiles admin-manages-staff" on public.profiles
  for update to authenticated
  using (
    (select public.current_user_role()) = 'admin'
    and role in ('staff', 'admin')
  )
  with check (
    (select public.current_user_role()) = 'admin'
    and role = 'staff'
  );

create policy "profiles self-update" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
