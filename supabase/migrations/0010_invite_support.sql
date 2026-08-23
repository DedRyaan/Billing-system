-- Migration 0010: invitation support RPCs — forced password change + pending-invite visibility (Plan 09)
--
-- The database half of AUTH-02's D-09 fallback flow and D-07's visibility half.
-- Pending invites themselves need NO new table: they ARE auth.users rows with
-- invitation_sent_at set and last_sign_in_at still NULL (native tracking).
-- Cancellation deletes the pending auth user outright (frees the email,
-- D-07) and old links then dead-end natively with GoTrue's invite_not_found
-- class error (D-08) — so "cancelled" has no tombstone row by design
-- (RESEARCH anti-pattern: casual deletion must stay a deliberate, audited
-- admin action; the audit half lives in the invite-user Edge Function and
-- these RPCs, never in a rewriteable history table).
--
-- What lands here:
--   mark_must_change_password(uuid)  service/admin-settable D-09 flag writer —
--                                    the fallback-created account is born with
--                                    must_change_password=true so the app
--                                    forces a password set before any access
--   clear_must_change_password()     SELF-service only (no parameter — the
--                                    caller's own auth.uid() is the sole
--                                    possible target); the sanctioned post-
--                                    updateUser({password}) completion step
--   admin_list_invites()             admins-only view-helper over pending
--                                    invites (D-07 visibility half) exposing
--                                    id/email/invited_at/created_at ONLY —
--                                    no mfa factors, no raw metadata leakage
--
-- CONFIG HANDOFF (applied live in Plan 10 Task 2, recorded here per plan):
--   Email OTP Expiration MUST equal 86400 seconds to pin D-06's 24-hour
--   invite-link expiry exactly. Blast radius accepted per RESEARCH Open
--   Question 4: the same setting governs confirmation/recovery links.
--   Native invite links therefore expire per that setting; expired links
--   dead-end with invite_not_found (D-08).
--
-- Conventions inherited from Waves 1-5 (0007/0009): SECURITY DEFINER with
-- fixed search_path = public; authorization resolved INSIDE the definer body
-- via current_user_role() (never client input); system/service contexts (no
-- JWT sub — migrations and the service-role Edge Function paths) are exempt
-- from JWT-derived role checks exactly as in 0007's guard; EXECUTE revoked
-- from PUBLIC/anon before targeted grants; audit appends ride 0006's
-- write_audit() (definer owner scope bypasses its EXECUTE revocation).
-- must_change_password is deliberately NOT a privileged-marker column
-- (contrast role/is_active/locked_at): self-clearing through the definer
-- below must stay marker-free, and admin management of staff flags is
-- legitimate D-17 power. Peer protection (0007 Gate P) still applies to any
-- admin attempting to mark ANOTHER ADMIN — invited targets are born staff.

-- ---------------------------------------------------------------------------
-- mark_must_change_password — D-09 forced-first-login-change writer.
-- Callable by service_role (no JWT sub; the invite-user fallback path) OR
-- admin/super_admin JWT callers. Raises loudly when no profile row exists —
-- the Edge Function mints the profile BEFORE this call (bootstrap mint+
-- profile precedent), so absence is a bug worth failing on, not papering over.
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
      using errcode = insufficient_privilege; -- 42501: staff/anon denied
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

revoke execute on function public.mark_must_change_password(uuid)
  from public;
revoke execute on function public.mark_must_change_password(uuid)
  from anon;
grant execute on function public.mark_must_change_password(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- clear_must_change_password — self-service completion of the D-09 flow.
-- Called by the invitee AFTER supabase.auth.updateUser({password}) succeeds
-- (RESEARCH Pattern 7 lifecycle). Targeting others is impossible by
-- construction: there is no parameter — the only writable row is the
-- caller's own. Service contexts (auth.uid() null) have no target at all.
-- Audits auth.password_changed (D-23 access event); the 0006 capture trigger
-- additionally records the raw before/after row image.
-- ---------------------------------------------------------------------------

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
      using errcode = insufficient_privilege;
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

revoke execute on function public.clear_must_change_password()
  from public;
revoke execute on function public.clear_must_change_password()
  from anon;
revoke execute on function public.clear_must_change_password()
  from service_role;
grant execute on function public.clear_must_change_password()
  to authenticated;

-- ---------------------------------------------------------------------------
-- admin_list_invites — D-07 visibility half. Pending invite = auth.users row
-- with invitation_sent_at set AND last_sign_in_at still NULL (never accepted,
-- never signed in — fallback-created accounts that HAVE signed in drop off
-- automatically). Exposes id/email/invited_at/created_at ONLY: no mfa
-- factors, no phone, no raw_user_meta_data, no confirmation tokens.
--
-- Authorization inside the definer body: JWT callers must resolve
-- admin/super_admin; the no-JWT-sub service context is exempt (same
-- convention as 0007) because the invite-user function's list action calls
-- this through its service-role client AFTER its own admin-JWT gate.
--
-- Ordering deliberately unspecified this phase (flagged edge assumption
-- INVITE-list-ordering — no UI exists yet; Phase 3 may impose one).
-- STABLE: pure read, no writes, no audit (D-23 excludes read telemetry).
-- ---------------------------------------------------------------------------

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
      using errcode = insufficient_privilege; -- 42501: staff denied
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

revoke execute on function public.admin_list_invites()
  from public;
revoke execute on function public.admin_list_invites()
  from anon;
revoke execute on function public.admin_list_invites()
  from service_role;
grant execute on function public.admin_list_invites()
  to authenticated;
