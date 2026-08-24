-- Migration 0012: guard/errcode repair — quote every bare RAISE error-code literal (Plan 11 gap closure)
--
-- Diagnosing evidence: CI run 32743218391 (master@72b2a18), where
-- rls_isolation aborted 9-of-10 with "column \"raise_exception\" does not
-- exist" raised INSIDE public.guard_profile_privileged_columns() — the first
-- observed crash of a SYSTEMIC migration bug.
--
-- Root cause: twenty-four RAISE sites across eighteen PL/pgSQL functions
-- defined by five applied migrations (0004, 0005, 0007, 0009, 0010) write
--   USING errcode = <unquoted condition-name identifier>
-- In PL/pgSQL the value after `USING errcode =` is evaluated as an
-- EXPRESSION, so Postgres resolves each bare identifier as a COLUMN reference
-- and crashes with SQLSTATE 42703 the moment that RAISE path executes. The
-- defect silently poisons every suite exercising these functions — CI caught
-- the guard's Gate-M path; document_state (enforce_document_transition) and
-- ledger_masterdata (block_payment_mutation) would have crashed on their next
-- run anyway once their Class-2 authoring fixes let execution reach those
-- gates.
--
-- This migration is ADDITIVE forward repair per the replace-in-new-migration
-- precedent established by 0011: no applied migration file is edited; every
-- function below is CREATE OR REPLACE'd so its body keeps the same OID and
-- all trigger bindings plus the 0007 EXECUTE revocations/grants survive
-- untouched. No grants, revokes or triggers are re-issued here.
--
-- EIGHTEEN functions replaced (origin migration — signature as defined there):
--   0004_documents.sql            enforce_document_transition()
--                                 enforce_document_deletion_rules()
--                                 enforce_line_deletion_rules()          [security definer]
--   0005_ledger_masterdata.sql    block_payment_mutation()
--                                 enforce_catalog_role_guard()
--   0007_role_governance.sql      guard_profile_privileged_columns()     [definer-free trigger fn]
--                                 unlock_account_profile(uuid)           [security definer]
--                                 deactivate_staff_account(uuid)         [security definer]
--                                 reactivate_staff_account(uuid)         [security definer]
--                                 initiate_super_admin_transfer(uuid)    [security definer]
--                                 confirm_super_admin_transfer()         [security definer]
--                                 create_business(text,text,text,text,text) [security definer]
--                                 archive_business(uuid)                 [security definer]
--                                 restore_business(uuid)                 [security definer]
--   0009_setup_code.sql           rotate_setup_code_digest(text)         [security definer]
--   0010_invite_support.sql       mark_must_change_password(uuid)        [security definer]
--                                 clear_must_change_password()           [security definer]
--                                 admin_list_invites()                   [stable, security definer]
--
-- Attribute preservation: language plpgsql everywhere; STABLE only where the
-- origin declares it (admin_list_invites); SECURITY DEFINER present EXACTLY
-- where each origin has it (adding it where absent would be a privilege
-- escalation; omitting it where present breaks definer semantics);
-- set search_path = public everywhere; signatures and defaults byte-identical.
--
-- Messages are preserved byte-for-byte with ONLY the error-code right-hand
-- side corrected to the QUOTED five-character literal, so the designed
-- loud-denial contract holds: '42501' carrying each function's original
-- denial wording at the twenty-three Gate-P-class sites, 'P0001' carrying the
-- privileged-columns wording at the guard's single Gate-M site.

-- ---------------------------------------------------------------------------
-- 0004_documents.sql — document state machine + deletion guards
-- ---------------------------------------------------------------------------

create or replace function public.enforce_document_transition() returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- Static registry of future system-maintained columns (Plan 04 adds them;
  -- declaring them NOW means that migration never amends this trigger).
  v_system_maintained constant text[] := array['paid_amount', 'payment_status'];
  v_changed text[];
begin
  -- Gate 1: loud client-context denial on non-draft rows (42501 semantics,
  -- matching the RLS denial clients already receive from the policy layer).
  if current_user = 'authenticated' and old.status <> 'draft' then
    raise exception 'documents are editable only in draft status - issued and voided documents are immutable'
      using errcode = '42501'; -- 42501
  end if;

  -- Diff OLD vs NEW as jsonb key sets (RESEARCH Pattern 5 capture style).
  select coalesce(array_agg(o.key order by o.key), array[]::text[])
    into v_changed
    from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n on n.key = o.key
   where o.value is distinct from n.value;

  -- Gate 2: system-maintenance carve-out — same-status issued row, changed
  -- keys confined to the registry. Clients cannot reach this branch: their
  -- session role trips Gate 1 first, and no client code path runs as the
  -- definer owner.
  if old.status = 'issued'
     and new.status = 'issued'
     and v_changed <@ v_system_maintained then
    return new;
  end if;

  -- Gate 3: transition matrix.
  if old.status = 'draft' then
    if new.status = 'draft' then
      return new;                                   -- shared-pool field edits (D-41/D-42)
    elsif new.status = 'issued' then
      if new.seq is null then
        raise exception 'transition draft to issued requires an allocated sequence number - finalize owns numbering (allocate_next_number)';
      end if;
      return new;                                   -- finalize path only
    else
      raise exception 'illegal transition draft to voided - issue first, then void (D-16)';
    end if;
  elsif old.status = 'issued' then
    if new.status = 'voided' then
      if (select public.current_user_role()) in ('admin', 'super_admin') then
        return new;                                 -- D-16: admins-only void
      end if;
      raise exception 'voiding an issued invoice is restricted to admins (D-16)';
    elsif new.status = 'draft' then
      raise exception 'illegal transition issued to draft - corrections are void-and-reissue';
    else
      raise exception 'issued documents are immutable - non-system column(s) changed: %',
        array_to_string(v_changed, ', ');
    end if;
  else
    raise exception 'voided documents are frozen - no further transitions in any direction';
  end if;
end;
$$;

create or replace function public.enforce_document_deletion_rules() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    raise exception 'only draft documents may be deleted - issued and voided documents are permanent (GST retention)'
      using errcode = '42501'; -- 42501
  end if;
  return old;
end;
$$;

create or replace function public.enforce_line_deletion_rules() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.invoices i
    where i.id = old.invoice_id
      and i.status <> 'draft'
  ) then
    raise exception 'lines of issued or voided documents are permanent - corrections are void-and-reissue'
      using errcode = '42501'; -- 42501
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 0005_ledger_masterdata.sql — append-only ledger + catalog role backstop
-- ---------------------------------------------------------------------------

create or replace function public.block_payment_mutation() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% on % is append-only - corrections are reversal entries (Pitfall 7)',
    TG_OP, TG_TABLE_NAME
    using errcode = '42501'; -- 42501
end;
$$;

create or replace function public.enforce_catalog_role_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select public.current_user_role()) = 'staff' then
    raise exception 'catalog management is restricted to admins (D-44)'
      using errcode = '42501'; -- 42501
  end if;
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- 0007_role_governance.sql — privileged-column guard + lifecycle/business RPCs
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
      using errcode = '42501'; -- 42501
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
      using errcode = 'P0001'; -- P0001, distinct from policy 42501
  end if;

  return new;
end;
$$;

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
      using errcode = '42501'; -- staff denied; D-29 admits admins
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
      using errcode = '42501'; -- deactivated/deleted caller: no effective role
  end if;
  if v_caller not in ('admin', 'super_admin') then
    raise exception 'deactivate_staff_account requires an admin or super_admin caller'
      using errcode = '42501';
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
      using errcode = '42501'; -- peer protection holds inside RPCs too
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
      using errcode = '42501';
  end if;
  if v_caller not in ('admin', 'super_admin') then
    raise exception 'reactivate_staff_account requires an admin or super_admin caller'
      using errcode = '42501';
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
      using errcode = '42501';
  end if;

  perform set_config('gsd.privileged_mutation', 'on', true);

  update public.profiles set is_active = true where id = p_target;

  perform public.write_audit('profile.reactivate', 'profiles', p_target::text,
                             null,
                             to_jsonb(v_target_row),
                             jsonb_set(to_jsonb(v_target_row), '{is_active}', 'true'));
end;
$$;

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
      using errcode = '42501';
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
      using errcode = '42501';
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
      using errcode = '42501';
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
      using errcode = '42501';
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
      using errcode = '42501';
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
      using errcode = '42501';
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
-- 0009_setup_code.sql — setup-code rotation
-- ---------------------------------------------------------------------------

create or replace function public.rotate_setup_code_digest(p_new_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select public.current_user_role()) <> 'super_admin' then
    raise exception 'rotate_setup_code_digest is restricted to super_admin D-13 D-03'
      using errcode = '42501'; -- 42501: admins/staff/anon denied
  end if;

  if p_new_code is null or length(p_new_code) < 12 then
    raise exception 'rotate_setup_code_digest requires a setup code of at least 12 characters';
  end if;

  insert into public.setup_code as sc (id, code_hash, created_at, rotated_at)
  values (1, digest(p_new_code, 'sha256'), now(), now())
  on conflict (id) do update
    set code_hash  = excluded.code_hash,
        rotated_at = now();

  perform public.write_audit('setup_code.rotated', 'setup_code', '1',
                             null, null,
                             jsonb_build_object('rotated_at', now()));
end;
$$;

-- ---------------------------------------------------------------------------
-- 0010_invite_support.sql — forced password change + pending-invite visibility
-- ---------------------------------------------------------------------------

create or replace function public.mark_must_change_password(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null
     and (select public.current_user_role()) not in ('admin', 'super_admin') then
    raise exception 'mark_must_change_password is restricted to admin/super_admin or service context D-09'
      using errcode = '42501'; -- 42501: staff/anon denied
  end if;

  update public.profiles
     set must_change_password = true
   where id = p_target;

  if not found then
    raise exception 'mark_must_change_password target profile not found';
  end if;

  perform public.write_audit('auth.must_change_password_set', 'profiles',
                             p_target::text, null, null,
                             jsonb_build_object('must_change_password', true));
end;
$$;

create or replace function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'clear_must_change_password requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.profiles
     set must_change_password = false
   where id = v_me;

  if not found then
    raise exception 'clear_must_change_password caller profile not found';
  end if;

  perform public.write_audit('auth.password_changed', 'profiles',
                             v_me::text, null, null,
                             jsonb_build_object('must_change_password', false));
end;
$$;

create or replace function public.admin_list_invites()
returns table (
  user_id    uuid,
  email      text,
  invited_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null
     and (select public.current_user_role()) not in ('admin', 'super_admin') then
    raise exception 'admin_list_invites is restricted to admin/super_admin D-07'
      using errcode = '42501'; -- 42501: staff denied
  end if;

  return query
    select u.id,
           u.email::text,
           u.invitation_sent_at,
           u.created_at
      from auth.users u
     where u.invitation_sent_at is not null
       and u.last_sign_in_at is null;
end;
$$;
