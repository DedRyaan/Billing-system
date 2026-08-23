-- Migration 0008: brute-force lockout machinery — private attempt ledger +
-- counting/ban helpers (Plan 07, D-28/D-29).
--
-- The Supabase Password Verification Hook is Teams/Enterprise-only (RESEARCH
-- critical finding), so on the Free tier (D-39) failed-attempt counting lives
-- HERE, application-side, behind SECURITY DEFINER helpers that ONLY the
-- auth-sign-in Edge Function reaches through its service key:
--
--   D-28       five consecutive failed password attempts lock the account
--              against further sign-ins — INCLUDING with the correct password.
--              Restoration flows EXCLUSIVELY through the audited admin unlock
--              path (Plan 06 unlock_account_profile + Plan 07 GoTrue ban
--              clearing): there is NO auto-unlock timer anywhere in this
--              schema — no expiry column, no purge job, nothing to expire.
--   D-29       any admin can unlock any locked account (incl. a super admin)
--              through that one narrow path; this migration adds nothing that
--              widens it.
--   D-23       every attempt lands in login_attempts AND the Edge Function
--              writes auth.login / auth.login_failed / auth.lockout audit
--              entries through write_audit() (0006).
--
-- PRIVILEGED-MUTATION MARKER CONTRACT (0007): profiles.locked_at changes
-- exclusively inside marker'd RPCs/helpers. set_locked_at() sets the
-- transaction-local flag before mutating — the 0007 guard would reject the
-- change otherwise whenever a JWT sub is present, and honoring the contract
-- keeps that guarantee structural rather than incidental.
--
-- API INVISIBILITY: login_attempts is ENABLE + FORCE row level security with
-- ZERO policies — invisible to every application role — AND every table
-- privilege is revoked from anon/authenticated/service_role so the ledger is
-- reachable ONLY through the definer helpers below (defense-in-depth: RLS
-- denies rows, grants deny the table outright). Reads happen exclusively
-- inside SECURITY DEFINER functions running as the migration owner.
--
-- Conventions inherited from Waves 1-5: SECURITY DEFINER with fixed
-- search_path = public, EXECUTE revoked from PUBLIC (and anon/authenticated)
-- on sensitive helpers, explicit intent-pinning revokes.

-- ---------------------------------------------------------------------------
-- login_attempts — the append-only attempt ledger (private).
--
-- One row per password-grant attempt routed through auth-sign-in. id is
-- generated always as identity: identity sequence order IS attempt order,
-- so consecutive-failure counting keys on id comparisons and can never be
-- confused by identical attempted_at timestamps.
-- ---------------------------------------------------------------------------

create table public.login_attempts (
  id           bigint generated always as identity primary key,
  email        text        not null,          -- lower(trim()) canonical form, matching zod input normalization
  user_id      uuid        references public.profiles(id),  -- resolved profile attribution; NULL when unknown-email
  success      boolean     not null,
  attempted_at timestamptz not null default now()
);

-- Counting helper hot path: latest rows for one email, newest first.
create index login_attempts_email_id_idx
  on public.login_attempts (email, id desc);

alter table public.login_attempts enable row level security;
alter table public.login_attempts force row level security;

-- Deliberately NO policies of any kind. Under FORCE RLS the absence denies
-- every operation to every non-BYPASSRLS role; the grant layer below removes
-- the table from the API surface entirely.

revoke all on public.login_attempts from anon;
revoke all on public.login_attempts from authenticated;
revoke all on public.login_attempts from service_role;

-- ---------------------------------------------------------------------------
-- count_consecutive_failures(p_email) — failures AFTER the most recent
-- successful attempt row for the email (0 when none/no successes). Id-based
-- ordering: everything inserted later than the last success counts; the next
-- success resets the streak by construction.
-- SECURITY DEFINER: the ledger is API-invisible; only definer contexts read
-- it. STABLE: pure read, safe inside larger expressions.
-- ---------------------------------------------------------------------------

create or replace function public.count_consecutive_failures(p_email text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(case when la.success then 0 else 1 end), 0)::int
    from public.login_attempts la
   where la.email = lower(btrim(p_email))
     and la.id > coalesce((
           select max(prev.id)
             from public.login_attempts prev
            where prev.email = la.email
              and prev.success = true
         ), 0)
$$;

-- ---------------------------------------------------------------------------
-- record_login_attempt(p_email, p_user_id, p_success) — the single sanctioned
-- append path. Inserts the ledger row and returns the resulting consecutive-
-- failure count (always 0 after a success — the streak is reset). Email is
-- normalized identically to the Edge Function's zod pipeline so counting
-- cannot be split by case/whitespace variants.
-- ---------------------------------------------------------------------------

create or replace function public.record_login_attempt(
  p_email   text,
  p_user_id uuid,
  p_success boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email    text := lower(btrim(p_email));
  v_attempts integer;
begin
  insert into public.login_attempts (email, user_id, success)
  values (v_email, p_user_id, p_success);

  if p_success then
    v_attempts := 0;
  else
    select public.count_consecutive_failures(v_email) into v_attempts;
  end if;

  return v_attempts;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_locked_at(p_user_id) — Plan 07's companion writer for the fifth strike.
-- Sets profiles.locked_at = now() inside the privileged-mutation marker
-- (0007 contract). Clearing remains unlock_account_profile()'s exclusive job
-- (Plan 06) — this helper deliberately CANNOT clear a lock.
-- ---------------------------------------------------------------------------

create or replace function public.set_locked_at(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('gsd.privileged_mutation', 'on', true);

  update public.profiles
     set locked_at = now()
   where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE hygiene: the whole lockout surface is service-role-only. No client
-- role (anon/authenticated/PUBLIC) may count attempts, write ledger rows, or
-- flip locked_at outside the sanctioned Edge Function boundary.
-- ---------------------------------------------------------------------------

revoke execute on function public.count_consecutive_failures(text)
  from public;
revoke execute on function public.count_consecutive_failures(text)
  from anon;
revoke execute on function public.count_consecutive_failures(text)
  from authenticated;
grant execute on function public.count_consecutive_failures(text)
  to service_role;

revoke execute on function public.record_login_attempt(text, uuid, boolean)
  from public;
revoke execute on function public.record_login_attempt(text, uuid, boolean)
  from anon;
revoke execute on function public.record_login_attempt(text, uuid, boolean)
  from authenticated;
grant execute on function public.record_login_attempt(text, uuid, boolean)
  to service_role;

revoke execute on function public.set_locked_at(uuid)
  from public;
revoke execute on function public.set_locked_at(uuid)
  from anon;
revoke execute on function public.set_locked_at(uuid)
  from authenticated;
grant execute on function public.set_locked_at(uuid)
  to service_role;
