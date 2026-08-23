-- Migration 0002: identity substrate + database-as-gatekeeper isolation
--
-- profiles / businesses / business_members with FORCE row level security,
-- TO authenticated policies, and SECURITY DEFINER helpers (RESEARCH Pattern 1).
--
-- Roles are DATA (D-10): role/is_active/membership resolve per-query from
-- server-controlled columns. No authorization decision ever reads JWT metadata.
-- Deactivation is instant at the data plane (D-19/D-20): helpers return no
-- effective role / false on the very next query after profiles.is_active flips.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null default 'staff'
    check (role in ('super_admin', 'admin', 'staff')), -- D-10 three tiers, non-null forever
  is_active boolean not null default true,             -- D-19 deactivate-not-delete; D-20 gate
  must_change_password boolean not null default false, -- D-09 forced first-login change flag
  created_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text,
  gstin text not null unique,                          -- D-49 one GSTIN per business
  number_format text not null default 'prefix_fy_seq'
    check (number_format in ('prefix_fy_seq', 'prefix_seq', 'seq')), -- D-30 templates
  prefix text check (prefix ~ '^[A-Za-z0-9-]{1,10}$'), -- D-31 letters/digits/hyphens, 1..10
  archived_at timestamptz,                             -- D-35 archive-never-delete
  created_at timestamptz not null default now()
);

-- N businesses per user is primary (D-18): composite PK only — deliberately NO
-- unique constraint on user_id alone.
create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER helpers (fixed search_path; STABLE)
-- Policies reference these — never raw membership/profile tables (no recursion).
-- ---------------------------------------------------------------------------

-- Effective role of the caller, resolved from server-controlled data.
-- Returns NULL when the caller has no profile or is deactivated: an inactive
-- account holds no effective role anywhere (D-20 data-plane death).
create or replace function public.current_user_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles
  where id = (select auth.uid())
    and is_active
$$;

-- Tenant access predicate (BIZ-03 core):
--   active profile AND (admin/super_admin see all businesses [D-11, D-12]
--                       OR explicit membership row exists [D-18]).
create or replace function public.can_access_business(p_business_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active                                    -- D-20: dead account sees nothing
  ) and exists (
    select 1
    where (select public.current_user_role()) in ('super_admin', 'admin')
       or exists (
         select 1 from public.business_members bm
         where bm.business_id = p_business_id
           and bm.user_id = (select auth.uid())
       )
  )
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security — ENABLE + FORCE on every table (owner included)
-- Every policy declares TO authenticated; anon matches no tenant policy.
-- auth.uid() wrapped as (select auth.uid()) for one-shot InitPlan evaluation.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.businesses enable row level security;
alter table public.businesses force row level security;
alter table public.business_members enable row level security;
alter table public.business_members force row level security;

-- profiles ------------------------------------------------------------------

create policy "profiles self-read" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- D-11 peer protection: regular admins manage staff rows only; the folded
-- is_active gate in current_user_role() denies deactivated admins instantly.
create policy "profiles admin-manages-staff" on public.profiles
  for update to authenticated
  using (
    (select public.current_user_role()) = 'admin'
    and role = 'staff'
  )
  with check (
    (select public.current_user_role()) = 'admin'
    and role = 'staff'
  );

-- Super admin manages everyone including admins (D-11), all operations.
create policy "profiles super-admin-all" on public.profiles
  for all to authenticated
  using ((select public.current_user_role()) = 'super_admin')
  with check ((select public.current_user_role()) = 'super_admin');

-- businesses ----------------------------------------------------------------

create policy "businesses members-read" on public.businesses
  for select to authenticated
  using ((select public.can_access_business(id)));

-- D-15 business creation is super-admin-only.
create policy "businesses super-admin-insert" on public.businesses
  for insert to authenticated
  with check ((select public.current_user_role()) = 'super_admin');

-- Archive/restore and edits stay super-admin-only (D-37 groundwork).
create policy "businesses super-admin-update" on public.businesses
  for update to authenticated
  using ((select public.current_user_role()) = 'super_admin')
  with check ((select public.current_user_role()) = 'super_admin');

-- business_members ----------------------------------------------------------

create policy "business members read" on public.business_members
  for select to authenticated
  using ((select public.can_access_business(business_id)));

create policy "business members manage" on public.business_members
  for all to authenticated
  using ((select public.current_user_role()) in ('super_admin', 'admin'))
  with check ((select public.current_user_role()) in ('super_admin', 'admin'));
