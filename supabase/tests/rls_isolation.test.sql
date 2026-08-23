-- BIZ-03 core proof suite: RLS-isolated identity substrate.
--
-- Every assertion block switches to `authenticated` with an explicit JWT sub
-- claim (Pitfall 1: a green superuser suite proves nothing). Positive controls
-- guard against null-auth masking; negatives assert cross-business zero-row +
-- 42501 semantics; edges prove union membership and D-20 instant death.
--
-- Seeding happens as superuser BEFORE any role switch (RLS must not block it).
-- Assertions are count/emptiness-based only — no ordering assumptions.

begin;
set search_path = public, extensions;
select plan(10);

-- ---------------------------------------------------------------------------
-- Fixtures (superuser context)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'staff-a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'staff-b@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'dual-member@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'zero-member@test.local'),
  ('55555555-5555-5555-5555-555555555555', 'admin@test.local');

insert into public.profiles (id, email, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'staff-a@test.local',      'Staff A',      'staff'),
  ('22222222-2222-2222-2222-222222222222', 'staff-b@test.local',      'Staff B',      'staff'),
  ('33333333-3333-3333-3333-333333333333', 'dual-member@test.local',  'Dual Member',  'staff'),
  ('44444444-4444-4444-4444-444444444444', 'zero-member@test.local',  'Zero Member',  'staff'),
  ('55555555-5555-5555-5555-555555555555', 'admin@test.local',        'The Admin',    'admin');

insert into public.businesses (id, legal_name, gstin) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Business A', '29AAAAA0000A1Z0'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Business B', '27BBBBB0000B1Z3');

-- staffA -> A only; staffB -> B only; dual -> A AND B; zero-user: none.
insert into public.business_members (business_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

-- ---------------------------------------------------------------------------
-- Block 1: anon-equivalent session (no sub claim) sees zero tenant rows
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '';

select is_empty(
  'select * from public.businesses',
  'session without jwt sub claim matches no tenant policy (anon-equivalent)');

-- ---------------------------------------------------------------------------
-- Block 2: staff A — negatives against Business B
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is_empty(
  $$select * from public.businesses where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid$$,
  'staff A selects ZERO rows for business B (BIZ-03 isolation)');

select throws_ok(
  $$insert into public.business_members (business_id, user_id)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
            '11111111-1111-1111-1111-111111111111'::uuid)$$,
  '42501', null,
  'staff A cannot insert membership into business B');

-- Business B is nonexistent to staff A under RLS, so an UPDATE matches zero
-- rows and silently mutates nothing — the database-as-gatekeeper property.
-- A loud 42501 is proven separately on the insert paths below.
select results_eq(
  $$with attempted as (
       update public.businesses set trade_name = 'forged'
       where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
       returning 1
     ) select count(*) from attempted$$,
  ARRAY[0::bigint],
  'staff A update on business B row mutates ZERO rows (row invisible to them)');

select throws_ok(
  $$insert into public.businesses (legal_name, gstin) values ('Sneaky Ltd', '07CCCCC0000C1Z5')$$,
  '42501', null,
  'staff cannot create businesses - super-admin-only (D-15)');

-- ---------------------------------------------------------------------------
-- Block 3: positive control — null-auth masking guard
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$select count(*) from public.businesses
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid$$,
  ARRAY[1::bigint],
  'positive control: staff A DOES see own business A row');

-- ---------------------------------------------------------------------------
-- Block 4: admin (no memberships) sees every business
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select results_eq(
  'select count(*) from public.businesses',
  ARRAY[2::bigint],
  'admin sees both businesses A and B');

-- ---------------------------------------------------------------------------
-- Block 5: dual membership unions cleanly (BIZ-03 adjacency, D-18)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select results_eq(
  'select count(*) from public.businesses',
  ARRAY[2::bigint],
  'dual member sees exactly A and B - union, neither merged nor duplicated');

-- ---------------------------------------------------------------------------
-- Block 6: zero-membership staff sees zero tenant rows everywhere
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select results_eq(
  'select count(*) from public.businesses',
  ARRAY[0::bigint],
  'zero-membership user sees zero tenant rows');

-- ---------------------------------------------------------------------------
-- Block 7: D-20 data-plane death — flip is_active as superuser, very next
-- role-switched query returns zero rows though the JWT claim is unchanged
-- ---------------------------------------------------------------------------

reset role;

update public.profiles
   set is_active = false
 where id = '11111111-1111-1111-1111-111111111111'; -- staff A

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$select count(*) from public.businesses
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid$$,
  ARRAY[0::bigint],
  'deactivated staff A gets zero rows on next query despite valid-looking JWT (D-20)');

select * from finish();
rollback;
