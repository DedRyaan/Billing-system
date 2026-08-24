-- Migration 0013: policy predicate reshape + NULL-safe lifecycle guards
-- (Plan 01-14 gap closure — closes the D-11 escalation)
--
-- EVIDENCE BASE (01-12-SUMMARY.md; terminal run 32770278953, roles 43/48;
-- closure rounds 32773019239 / 32773879465 / 32774682377 / 32775072267):
--
-- THE ESCALATED "ENGINE-EVALUATION DEFECT" WAS A MISDIAGNOSIS - RESOLVED:
-- Postgres applies any SELECT policies that exist for the caller TO THE ROW
-- SCAN of UPDATE/DELETE statements IN ADDITION to the UPDATE policy's USING
-- (CREATE POLICY docs: when SELECT policies exist for a role, rows they do
-- not make visible are invisible to that role's UPDATE/DELETE too). profiles
-- granted admins NO select reach to other users' rows ("profiles self-read"
-- = own row; "profiles super-admin-all" = super only), so every
-- admin->others UPDATE matched zero candidates REGARDLESS of the UPDATE
-- predicate's expression shape. Gate P's loud 42501 was unreachable because
-- candidate rows never existed - not because any predicate mis-evaluated.
--
-- Why nine 01-12 CI runs plus two reshape rounds missed it: the sandbox twins
-- were single-policy tables WITHOUT a SELECT policy layer, so their UPDATEs
-- scanned unfiltered and every equivalent rewrite "passed"; production
-- profiles carries four policies across three command types. Round-3 runtime
-- diagnostics (run 32775072267) nailed it: stored qual catalog-perfect,
-- helper resolves 'admin' under the admin sub, grants present, FORCE flags
-- normal - yet noop UPDATEs on BOTH staff and peer-admin targets returned
-- ROW_COUNT=0 with no exception. Schema-wide correlation confirms the
-- mechanism: every functioning others'-row UPDATE policy in this codebase
-- sits on a table whose members hold a covering SELECT policy
-- (invoices/customers/catalog/business_members), and the only working
-- others'-row path on profiles belongs to super_admin precisely because
-- "super-admin-all" is FOR ALL (covers SELECT too).
--
-- PART 1 therefore ships TWO pieces:
--   1a. the reshaped "profiles admin-manages-staff" UPDATE policy (kept in
--       sublink-free unwrapped-call form - equivalent to the original
--       intent, simpler to reason about), and
--   1b. the MISSING READ ARM "profiles admin-reads-managed": admins gain
--       SELECT on staff and fellow-admin rows - exactly the set the manage
--       contract already covers, nothing more (super_admin rows stay
--       invisible to admins; Gate P keeps protecting them). Without 1b the
--       reshape is inert by standard visibility semantics and D-11's
--       loud-denial contract stays dead. This read surface is also the
--       minimum Phase 3 needs to list/manage staff in a UI.
--
-- TO role and PERMISSIVE semantics are preserved; policies cannot be ALTERed,
-- so Part 1a is a DROP + CREATE pair inside the CLI's single atomic
-- per-migration transaction.
--
-- Sweep audit note retained from earlier rounds: no other live policy carries
-- the originally-suspected conjunction shape, and none needs one - their
-- tables grant members covering SELECT visibility, which is why they always
-- evaluated "fine". History files are untouched; this forward migration
-- supersedes the stored shapes.
--
-- PART 2 closes the demonstrated NULL-swallowing bypass in lifecycle RPC
-- denial paths (01-12 production finding 2, shown live via vacuous passes in
-- run 32769730556): an inactive/NULL-role caller evaluates
-- `NULL <> 'super_admin'` / `NULL NOT IN (...)` to NULL — not TRUE — so the
-- denial never fires and the RPC PROCEEDS. Every denial-path comparison of
-- current_user_role() against a constant now coalesces the helper result to
-- '' so a NULL role is DENIED, never waved through:
--   initiate_super_admin_transfer / create_business / archive_business /
--   restore_business / rotate_setup_code_digest      (`<> 'super_admin'`)
--   unlock_account_profile / mark_must_change_password /
--   admin_list_invites       (`NOT IN ('admin','super_admin')` — same class:
--                             an inactive caller could unlock accounts,
--                             set password flags or list pending invites)
-- Already NULL-safe and deliberately untouched: deactivate/reactivate_staff_
-- account (explicit `v_caller is null` raises), confirm_super_admin_transfer
-- (explicit `is null` raise), guard_profile_privileged_columns (IS DISTINCT
-- FROM treats NULL as distinct = denies).
--
-- All eight functions are CREATE OR REPLACE'd so their OIDs survive and every
-- EXECUTE grant/revocation plus the guard trigger binding remain untouched
-- (0011/0012 additive-repair precedent). Signatures, defaults, language,
-- STABLE/SECURITY DEFINER attributes, messages and errcodes are preserved
-- byte-for-byte from the live 0012 definitions; ONLY the denial predicates
-- gain the coalesce wrap.

-- ---------------------------------------------------------------------------
-- Part 1: reshape the FOR UPDATE policy + add the missing SELECT visibility
-- arm (sublink-free form; see header for the resolved root cause)
-- ---------------------------------------------------------------------------

drop policy "profiles admin-manages-staff" on public.profiles;

-- 1a. UNWRAPPED definer call (plain function expression, no scalar sublink).
-- Kept from round 2: equivalent semantics, simpler to reason about, and
-- per-row evaluation strengthens D-20 instant revocation (is_active re-read
-- per candidate row).
create policy "profiles admin-manages-staff" on public.profiles
  for update to authenticated
  using (
    role in ('staff', 'admin')
    and public.current_user_role() = 'admin'
  )
  with check (
    role = 'staff'
    and public.current_user_role() = 'admin'
  );

-- 1b. THE READ ARM WITHOUT WHICH 1a IS INERT: UPDATE candidacy requires the
-- target rows to be SELECT-visible to the caller whenever SELECT policies
-- exist for that caller (standard Postgres multi-policy rule - the mechanism
-- the 01-12 escalation misattributed to expression shape). Admins may now
-- READ exactly what they may MANAGE: staff and fellow-admin rows. Super_admin
-- rows remain invisible to admins (Gate P's protection surface is unchanged);
-- super_admin keeps full reach via "super-admin-all" (FOR ALL covers SELECT).
create policy "profiles admin-reads-managed" on public.profiles
  for select to authenticated
  using (
    role in ('staff', 'admin')
    and public.current_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- Part 2: NULL-coalesced lifecycle denial paths (0007/0009/0010 lineage,
-- live definitions per 0012's errcode repair)
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
  if coalesce((select public.current_user_role()), '') <> 'super_admin' then
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
  if coalesce((select public.current_user_role()), '') <> 'super_admin' then
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
  if coalesce((select public.current_user_role()), '') <> 'super_admin' then
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
  if coalesce((select public.current_user_role()), '') <> 'super_admin' then
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

create or replace function public.rotate_setup_code_digest(p_new_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select public.current_user_role()), '') <> 'super_admin' then
    raise exception 'rotate_setup_code_digest is restricted to super_admin D-13 D-03'
      using errcode = '42501'; -- 42501: admins/staff/anon/inactive denied
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
  -- coalesce: an inactive/NULL-role caller must be DENIED, not waved through
  -- by NOT IN's three-valued logic (same bypass class as the <> sites above).
  if coalesce((select public.current_user_role()), '') not in ('admin', 'super_admin') then
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

create or replace function public.mark_must_change_password(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is not null
     and coalesce((select public.current_user_role()), '') not in ('admin', 'super_admin') then
    raise exception 'mark_must_change_password is restricted to admin/super_admin or service context D-09'
      using errcode = '42501'; -- 42501: staff/anon/inactive denied
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
     and coalesce((select public.current_user_role()), '') not in ('admin', 'super_admin') then
    raise exception 'admin_list_invites is restricted to admin/super_admin D-07'
      using errcode = '42501'; -- 42501: staff/inactive denied
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
