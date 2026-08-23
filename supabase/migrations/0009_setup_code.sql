-- Migration 0009: owner setup-code storage + super-admin-only rotation (Plan 08)
--
-- The D-01..D-04 bootstrap machinery's database half. The owner's secret setup
-- code exists here ONLY as a SHA-256 digest (T-1-30 mitigate): plaintext never
-- persists anywhere, comparison happens against this digest, and the ONLY
-- sanctioned writers are the bootstrap-super-admin Edge Function (first-run
-- seeding via its service-role path) and rotate_setup_code_digest() below
-- (D-03/D-13 regeneration from admin settings).
--
-- Locked decisions baked in here:
--   D-01       code is USER-CHOSEN — the table seeds NOTHING at migration time;
--              the first successful bootstrap call stores the digest of the
--              code the owner presented on the first-run screen
--   D-02/D-04  a still-valid digest guards EVERY mint, so the same row is the
--              eternal emergency-recovery gate after bootstrap
--   D-03       rotation = replacing the single digest row (singleton id=1);
--              the previous code invalidates IMMEDIATELY because there is no
--              history column and no second hash to match against
--   D-13       rotation authorization re-checked INSIDE the definer body via
--              current_user_role() (server-controlled profiles.role) — granting
--              EXECUTE confers no unguarded power
--
-- API invisibility: ENABLE + FORCE RLS with ZERO policies makes every row
-- invisible to anon/authenticated/service REST reads alike; there is also no
-- table-level grant to application roles. Access flows exclusively through the
-- two SECURITY DEFINER functions below (fixed search_path = public).
--
-- Conventions inherited from Waves 1-4 (0006/0007): EXECUTE revoked from
-- PUBLIC on both helpers before targeted grants; audit appends ride 0006's
-- write_audit(), which is granted to service_role for Edge Function callers.

create table public.setup_code (
  id         integer primary key default 1,
  code_hash  bytea not null,                        -- pgcrypto digest(code,'sha256'); plaintext never stored
  created_at timestamptz not null default now(),
  rotated_at timestamptz                            -- NULL until first rotation (created_at marks first seed)
);

-- Singleton guarantee: exactly one row, forever.
alter table public.setup_code
  add constraint setup_code_singleton check (id = 1);

-- API-invisible: FORCE RLS + zero policies (no policy may EVER be created on
-- this table without revisiting D-01/T-1-30 first).
alter table public.setup_code enable row level security;
alter table public.setup_code force row level security;

-- Pin intent: no application-facing role holds ANY table privilege (revokes on
-- unheld privileges are deliberate no-ops). Definer helpers bypass this as the
-- migration owner.
revoke all on public.setup_code from anon;
revoke all on public.setup_code from authenticated;
revoke all on public.setup_code from service_role;

-- ---------------------------------------------------------------------------
-- get_setup_code_digest — read path for the bootstrap Edge Function. Returns
-- NULL while the singleton row does not exist (pre-first-run): the handler
-- treats that as "bootstrap pending" and seeds the digest of the FIRST
-- presented code through its own privileged write path.
--
-- EXECUTE hygiene: revoked from PUBLIC/anon/authenticated, granted to
-- service_role only — the digest value must never be readable by any client
-- context, including future admins (T-1-30).
-- ---------------------------------------------------------------------------

create or replace function public.get_setup_code_digest() returns bytea
language sql
stable
security definer
set search_path = public
as $$
  select code_hash from public.setup_code where id = 1
$$;

revoke execute on function public.get_setup_code_digest()
  from public;
revoke execute on function public.get_setup_code_digest()
  from anon;
revoke execute on function public.get_setup_code_digest()
  from authenticated;
grant execute on function public.get_setup_code_digest()
  to service_role;

-- ---------------------------------------------------------------------------
-- rotate_setup_code_digest — D-03 regeneration from admin settings,
-- super-admin-only (D-13): authorization resolved inside the definer body via
-- current_user_role(), never client input. Minimum length 12 enforced here too
-- (planner discretion strengthening D-03's user-chosen property — mirrored by
-- zod in the Edge Function), so rotation can never weaken an existing code.
--
-- Insert-on-conflict keeps first rotation and every later one on one code path.
-- Audited as a permission event (D-23); write_audit attributes the real acting
-- super admin via JWT claims. Old digest is OVERWRITTEN, not archived — the
-- previous code dies at commit time (D-03 immediacy requirement).
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
      using errcode = insufficient_privilege; -- 42501: admins/staff/anon denied
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

revoke execute on function public.rotate_setup_code_digest(text)
  from public;
revoke execute on function public.rotate_setup_code_digest(text)
  from anon;
grant execute on function public.rotate_setup_code_digest(text)
  to authenticated;
