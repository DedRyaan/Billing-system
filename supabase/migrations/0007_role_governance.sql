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

-- ---------------------------------------------------------------------------
-- Task 2: lifecycle RPCs — unlock, deactivate/reactivate, transfer, business
-- governance. Every function: SECURITY DEFINER, fixed search_path, internal
-- authorization via current_user_role() (never client input), sets the
-- privileged-mutation marker before touching guarded columns, and appends a
-- write_audit entry D-23/T-1-24.
--
-- Cross-plan contract (Plan 07): the GoTrue half of lockout lives in
-- service-role Edge Functions. The sign-in wrapper clears ban_duration FIRST,
-- then calls unlock_account_profile() to clear profiles.locked_at + audit;
-- deactivate/reactivate likewise pair with Plan 07's ban/sign-out endpoints.
-- The data-plane is_active gate here is authoritative and instant either way.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- D-14 transfer state lives beside locked_at on profiles: the HOLDER row
-- records who may claim super_admin and when the one-hour window opened.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column pending_transfer_to uuid references public.profiles(id),
  add column transfer_initiated_at timestamptz;

-- ---------------------------------------------------------------------------
-- unlock_account_profile — THE narrow D-29 exception: any admin may UNLOCK a
-- locked-out account, including a locked-out super_admin, but this path
-- changes NOTHING except locked_at. Narrowness is structural: the body below
-- contains exactly one column assignment; the pgTAP suite proves the whole
-- row is unchanged apart from the lock. (Gate M passes inside marker'd RPCs,
-- so keeping this function one-column-wide IS the enforcement.)
-- ---------------------------------------------------------------------------

create or replace function public.unlock_account_profile(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if (select public.current_user_role()) not in ('admin', 'super_admin') then
    raise exception 'unlock_account_profile requires an admin or super_admin caller D-28 D-29'
      using errcode = insufficient_privilege; -- staff denied; D-29 admits admins
  end if;

  select to_jsonb(p.*) into v_before
    from public.profiles p where p.id = p_target;
  if v_before is null then
    raise exception 'unlock_account_profile target account not found';
  end if;

  perform set_config('gsd.privileged_mutation', 'on', true);

  -- Deliberately the ONLY assignment in this function: locked_at = null.
  update public.profiles set locked_at = null where id = p_target;

  select to_jsonb(p.*) into v_after
    from public.profiles p where p.id = p_target;

  perform public.write_audit('profile.unlock', 'profiles', p_target::text,
                             null, v_before, v_after);
end;
$$;

-- ---------------------------------------------------------------------------
-- deactivate_staff_account / reactivate_staff_account — D-19/D-21 reversible
-- departure. Admin callers manage STAFF rows only (D-11/D-17); super_admin
-- manages anyone EXCEPT themselves (no self-lockout of the last super).
-- Deactivation needs NO draft handling for D-22: drafts are a shared pool
-- (D-41/D-42) already visible to admins, so an orphaned draft simply stays
-- put, attributed to its deactivated creator (created_by survives — rows are
-- never hard-deleted).
-- ---------------------------------------------------------------------------

create or replace function public.deactivate_staff_account(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     text;
  v_target_row public.profiles;
begin
  v_caller := (select public.current_user_role());
  if v_caller is null then
    raise exception 'deactivate_staff_account requires an active caller'
      using errcode = insufficient_privilege; -- deactivated/deleted caller: no effective role
  end if;
  if v_caller not in ('admin', 'super_admin') then
    raise exception 'deactivate_staff_account requires an admin or super_admin caller'
      using errcode = insufficient_privilege;
  end if;
  if p_target = (select auth.uid()) then
    raise exception 'deactivate_staff_account cannot deactivate your own account';
  end if;

  select * into v_target_row from public.profiles where id = p_target;
  if v_target_row.id is null then
    raise exception 'deactivate_staff_account target account not found';
  end if;
  if v_caller = 'admin' and v_target_row.role <> 'staff' then
    raise exception 'deactivate_staff_account admins may only deactivate staff accounts D-11 D-17'
      using errcode = insufficient_privilege; -- peer protection holds inside RPCs too
  end if;

  perform set_config('gsd.privileged_mutation', 'on', true);

  update public.profiles set is_active = false where id = p_target;

  perform public.write_audit('profile.deactivate', 'profiles', p_target::text,
                             null,
                             to_jsonb(v_target_row),
                             jsonb_set(to_jsonb(v_target_row), '{is_active}', 'false'));
end;
$$;

create or replace function public.reactivate_staff_account(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     text;
  v_target_row public.profiles;
begin
  v_caller := (select public.current_user_role());
  if v_caller is null then
    raise exception 'reactivate_staff_account requires an active caller'
      using errcode = insufficient_privilege;
  end if;
  if v_caller not in ('admin', 'super_admin') then
    raise exception 'reactivate_staff_account requires an admin or super_admin caller'
      using errcode = insufficient_privilege;
  end if;
  if p_target = (select auth.uid()) then
    raise exception 'reactivate_staff_account cannot reactivate your own account';
  end if;

  select * into v_target_row from public.profiles where id = p_target;
  if v_target_row.id is null then
    raise exception 'reactivate_staff_account target account not found';
  end if;
  if v_caller = 'admin' and v_target_row.role <> 'staff' then
    raise exception 'reactivate_staff_account admins may only reactivate staff accounts D-11 D-17'
      using errcode = insufficient_privilege;
  end if;

  perform set_config('gsd.privileged_mutation', 'on', true);

  update public.profiles set is_active = true where id = p_target;

  perform public.write_audit('profile.reactivate', 'profiles', p_target::text,
                             null,
                             to_jsonb(v_target_row),
                             jsonb_set(to_jsonb(v_target_row), '{is_active}', 'true'));
end;
$$;

-- ---------------------------------------------------------------------------
-- initiate_super_admin_transfer / confirm_super_admin_transfer — the D-14
-- two-step handover. Step 1: sitting super_admin names a target (markers land
-- on the HOLDER row). Step 2: the PENDING TARGET alone confirms, within one
-- hour; roles swap and the old holder lands as a plain peer-protected admin.
-- Re-initiating overwrites/restarts a stale pending record. No path promotes
-- without a prior initiation — confirmed by suite failure modes.
-- ---------------------------------------------------------------------------

create or replace function public.initiate_super_admin_transfer(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_row public.profiles;
  v_holder     public.profiles;
begin
  if (select public.current_user_role()) <> 'super_admin' then
    raise exception 'initiate_super_admin_transfer only super_admin may initiate the transfer D-14'
      using errcode = insufficient_privilege;
  end if;
  if p_target = (select auth.uid()) then
    raise exception 'initiate_super_admin_transfer cannot transfer to yourself';
  end if;

  select * into v_target_row from public.profiles where id = p_target;
  if v_target_row.id is null then
    raise exception 'initiate_super_admin_transfer target account not found';
  end if;
  if not v_target_row.is_active then
    raise exception 'initiate_super_admin_transfer target must be an active account';
  end if;

  perform set_config('gsd.privileged_mutation', 'on', true);

  select * into v_holder from public.profiles where id = (select auth.uid());
  update public.profiles
     set pending_transfer_to  = p_target,
         transfer_initiated_at = now()
   where id = v_holder.id;

  perform public.write_audit('profile.transfer_initiated', 'profiles',
                             v_holder.id::text, null,
                             to_jsonb(v_holder),
                             jsonb_build_object('pending_transfer_to', p_target,
                                                'transfer_initiated_at', now()));
end;
$$;

create or replace function public.confirm_super_admin_transfer()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     uuid := (select auth.uid());
  v_holder public.profiles;
  v_target uuid;
  v_init   timestamptz;
begin
  if (select public.current_user_role()) is null then
    raise exception 'confirm_super_admin_transfer requires an active caller'
      using errcode = insufficient_privilege;
  end if;

  select * into v_holder
    from public.profiles
   where role = 'super_admin'
     and pending_transfer_to is not null;
  if v_holder.id is null then
    raise exception 'confirm_super_admin_transfer no pending transfer initiation - two-step confirmation requires initiate first D-14';
  end if;

  v_target := v_holder.pending_transfer_to;
  v_init   := v_holder.transfer_initiated_at;

  if v_target is distinct from v_me then
    raise exception 'confirm_super_admin_transfer caller is not the pending transfer target'
      using errcode = insufficient_privilege;
  end if;
  if v_init < now() - interval '1 hour' then
    raise exception 'confirm_super_admin_transfer confirmation window expired - initiation valid for one hour';
  end if;

  perform set_config('gsd.privileged_mutation', 'on', true);

  -- Old holder lands as a regular PEER-PROTECTED admin (D-14), markers cleared.
  update public.profiles
     set role = 'admin',
         pending_transfer_to   = null,
         transfer_initiated_at = null
   where id = v_holder.id;

  update public.profiles
     set role = 'super_admin'
   where id = v_me;

  perform public.write_audit('profile.transfer_confirmed', 'profiles',
                             v_holder.id::text, null,
                             to_jsonb(v_holder),
                             jsonb_build_object('old_holder_role', 'admin',
                                                'new_super_admin', v_me));
end;
$$;

-- ---------------------------------------------------------------------------
-- create_business / archive_business / restore_business — D-15/D-37 business
-- governance is super-admin-only, exercised through audited RPCs (the Plan 01
-- policies already deny direct client writes; these RPCs are the sanctioned
-- write path). Column CHECKs on businesses (gst D-49 uniqueness, D-31 prefix
-- shape) still apply inside the definer insert.
-- ---------------------------------------------------------------------------

create or replace function public.create_business(
  p_legal_name    text,
  p_gstin         text,
  p_trade_name    text default null,
  p_number_format text default 'prefix_fy_seq',
  p_prefix        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_after jsonb;
begin
  if (select public.current_user_role()) <> 'super_admin' then
    raise exception 'create_business is restricted to super_admin D-15'
      using errcode = insufficient_privilege;
  end if;

  insert into public.businesses (legal_name, trade_name, gstin, number_format, prefix)
  values (p_legal_name, p_trade_name, p_gstin, p_number_format, p_prefix)
  returning id into v_id;

  select to_jsonb(b.*) into v_after from public.businesses b where b.id = v_id;
  perform public.write_audit('business.create', 'businesses', v_id::text,
                             v_id, null, v_after);
  return v_id;
end;
$$;

create or replace function public.archive_business(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if (select public.current_user_role()) <> 'super_admin' then
    raise exception 'archive_business is restricted to super_admin D-37'
      using errcode = insufficient_privilege;
  end if;

  select to_jsonb(b.*) into v_before from public.businesses b where b.id = p_business_id;
  if v_before is null then
    raise exception 'archive_business target business not found';
  end if;

  update public.businesses set archived_at = now() where id = p_business_id;

  select to_jsonb(b.*) into v_after from public.businesses b where b.id = p_business_id;
  perform public.write_audit('business.archive', 'businesses', p_business_id::text,
                             p_business_id, v_before, v_after);
end;
$$;

create or replace function public.restore_business(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if (select public.current_user_role()) <> 'super_admin' then
    raise exception 'restore_business is restricted to super_admin D-37'
      using errcode = insufficient_privilege;
  end if;

  select to_jsonb(b.*) into v_before from public.businesses b where b.id = p_business_id;
  if v_before is null then
    raise exception 'restore_business target business not found';
  end if;

  update public.businesses set archived_at = null where id = p_business_id;

  select to_jsonb(b.*) into v_after from public.businesses b where b.id = p_business_id;
  perform public.write_audit('business.restore', 'businesses', p_business_id::text,
                             p_business_id, v_before, v_after);
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE hygiene: every governance RPC reachable by authenticated clients
-- only; anon/PUBLIC revoked. Internal authorization re-checks role per call,
-- so granting EXECUTE confers no unguarded power.
-- ---------------------------------------------------------------------------

revoke execute on function public.unlock_account_profile(uuid)
  from public;
revoke execute on function public.unlock_account_profile(uuid)
  from anon;
revoke execute on function public.unlock_account_profile(uuid)
  from authenticated;
grant execute on function public.unlock_account_profile(uuid)
  to authenticated;

revoke execute on function public.deactivate_staff_account(uuid)
  from public;
revoke execute on function public.deactivate_staff_account(uuid)
  from anon;
revoke execute on function public.deactivate_staff_account(uuid)
  from authenticated;
grant execute on function public.deactivate_staff_account(uuid)
  to authenticated;

revoke execute on function public.reactivate_staff_account(uuid)
  from public;
revoke execute on function public.reactivate_staff_account(uuid)
  from anon;
revoke execute on function public.reactivate_staff_account(uuid)
  from authenticated;
grant execute on function public.reactivate_staff_account(uuid)
  to authenticated;

revoke execute on function public.initiate_super_admin_transfer(uuid)
  from public;
revoke execute on function public.initiate_super_admin_transfer(uuid)
  from anon;
revoke execute on function public.initiate_super_admin_transfer(uuid)
  from authenticated;
grant execute on function public.initiate_super_admin_transfer(uuid)
  to authenticated;

revoke execute on function public.confirm_super_admin_transfer()
  from public;
revoke execute on function public.confirm_super_admin_transfer()
  from anon;
revoke execute on function public.confirm_super_admin_transfer()
  from authenticated;
grant execute on function public.confirm_super_admin_transfer()
  to authenticated;

revoke execute on function public.create_business(text, text, text, text, text)
  from public;
revoke execute on function public.create_business(text, text, text, text, text)
  from anon;
revoke execute on function public.create_business(text, text, text, text, text)
  from authenticated;
grant execute on function public.create_business(text, text, text, text, text)
  to authenticated;

revoke execute on function public.archive_business(uuid)
  from public;
revoke execute on function public.archive_business(uuid)
  from anon;
revoke execute on function public.archive_business(uuid)
  from authenticated;
grant execute on function public.archive_business(uuid)
  to authenticated;

revoke execute on function public.restore_business(uuid)
  from public;
revoke execute on function public.restore_business(uuid)
  from anon;
revoke execute on function public.restore_business(uuid)
  from authenticated;
grant execute on function public.restore_business(uuid)
  to authenticated;
