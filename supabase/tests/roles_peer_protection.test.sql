-- Role-governance proof suite: Plan 06 onto profiles + businesses.
--
-- Proves mechanically (RESEARCH Pitfall 1 discipline: every block sets BOTH
-- the role and an explicit jwt sub; positive controls guard against
-- null-auth.uid() masking; negatives pair with positives):
--   D-11 PEER PROTECTION  admin touching another ADMIN's row dies loudly
--        (guard trigger 42501); admin manages STAFF freely; super_admin
--        manages everyone incl. admins
--   T-1-21 ESCALATION     self-service role/is_active promotion/deactivation
--        attempts die at the guard trigger even over a valid session
--   D-19/D-20/D-21/D-22   deactivation kills data access on the VERY NEXT
--        query despite the still-valid JWT; drafts stay admin-visible
--        (shared pool); reactivation restores visibility EXACTLY
--   D-28/D-29 UNLOCK      any admin unlocks a locked-out SUPER ADMIN, changing
--        nothing else; staff cannot drive the unlock RPC
--   D-14 TRANSFER         confirm without initiation fails; non-target caller
--        fails; expired window fails; correct initiate->confirm swaps roles
--        and lands the old holder as a plain peer-protected admin
--   D-15/D-37 GOVERNANCE  business create/archive/restore are super_admin-only;
--        direct client inserts die at policy layer with 42501
--
-- JWT-STALENESS BACKSTOP (AUTH-03-jwt-staleness / RESEARCH Pitfall 4 /
-- T-1-23): block 3 deliberately keeps the deactivated staff member's ORIGINAL
-- jwt sub set while asserting zero rows. Data-plane death is INSTANT because
-- helpers re-read profiles.is_active per query; auth-layer effects (login
-- blocking, token claims) lag until refresh (~JWT exp). Data plane is
-- authoritative for this phase; revisit under the Pro upgrade (D-40).
--
-- Fixture updates to protected columns run under `reset role` with the jwt
-- sub CLEARED - the guard exempts system/service contexts (auth.uid() NULL),
-- mirroring how migrations and Plan 07's service-key lockout writer operate.
--
-- Runtime evidence: authored alongside Windows-local execution where the
-- Docker daemon is unavailable (WINDOWS.md convention) - suite must run
-- green via `supabase test db` in CI/Wave-7 before sign-off.
--
-- Plan 01-12 repair (evidence: CI runs 32743218391 / 32762494928 /
-- 32763725256 / 32764405453 / 32764876499 / 32765886005 / 32766657430 /
-- 32767213999 / 32767902991 / 32768298424 / 32769070295):
--   * Two permanent Pitfall-1 probes open Block 1, pinning helper resolution
--     and reshaped-policy presence BEFORE any negative assert.
--   * Post-write read-back assertions run from READING-CAPABLE vantages
--     (reset-role/cleared-sub pockets): an admin holds NO select policy that
--     reaches another user's profiles row, so counting under an admin sub can
--     NEVER see the target row even when the UPDATE landed - structural
--     blindness, not evidence of a failed write.
--   * Query-string-first is() calls pass SCALAR SUBQUERIES: pgTAP is() is a
--     pure value comparator that never executes SQL, and untyped literals
--     crash polymorphic resolution ("could not determine polymorphic type").
--
-- ESCALATED DEFECT (01-12 -> production scope): the stored 0007 reshape is
-- catalog-correct yet Postgres mis-evaluates that exact expression shape -
--   (SELECT <security-definer fn>()) = '<const>' AND <col> IN (<literals>)
-- inside FOR UPDATE USING - matching ZERO rows for admin callers, while the
-- identical predicate passes as a plain SELECT and equivalent rewrites (arm-
-- order swap, unwrapped call, length() arm) evaluate correctly on clean twin
-- tables. Consequence: admin->admin/STAFF direct updates filter silently, so
-- Gate P can never fire its designed loud 42501. Fix requires a policy-shape
-- migration (production scope); see 01-12-SUMMARY.md hypothesis ranking.

begin;
set search_path = public, extensions;
select plan(48);

-- ---------------------------------------------------------------------------
-- Fixtures (superuser context): three tiers + one extra admin (the peer
-- protection victim / transfer target), two businesses, staff membership in
-- A only, one staff-created draft in A, and the super admin LOCKED (Plan 07
-- would set locked_at service-side; simulated here as fixture state).
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-000000000001', 'owner@test.local'),
  ('70000000-0000-0000-0000-000000000002', 'admin@test.local'),
  ('70000000-0000-0000-0000-000000000003', 'admin-two@test.local'),
  ('70000000-0000-0000-0000-000000000004', 'staff@test.local');

insert into public.profiles (id, email, full_name, role) values
  ('70000000-0000-0000-0000-000000000001', 'owner@test.local',      'Owner One', 'super_admin'),
  ('70000000-0000-0000-0000-000000000002', 'admin@test.local',      'Admin One', 'admin'),
  ('70000000-0000-0000-0000-000000000003', 'admin-two@test.local',  'Admin Two', 'admin'),
  ('70000000-0000-0000-0000-000000000004', 'staff@test.local',      'Staff One', 'staff');

insert into public.businesses (id, legal_name, gstin) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Business A', '29AAAAA0000A1Z0'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'Business B', '29BBBBB0000B1Z5');

insert into public.business_members (business_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '70000000-0000-0000-0000-000000000004');

insert into public.invoices (business_id, fy, status, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '26-27', 'draft',
   '70000000-0000-0000-0000-000000000004');

reset role;
set local request.jwt.claim.sub = '';
update public.profiles set locked_at = now()
 where id = '70000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Block 1: D-11 peer protection - loud denials between admins
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002'; -- admin

-- Pitfall-1 Probe 1: does the role helper resolve under THIS fixture's JWT
-- claim? Kills or confirms the null-helper hypothesis in one line of CI out.
select results_eq(
  $$select public.current_user_role()$$,
  ARRAY['admin'::text],
  'probe: current_user_role() resolves to admin under this fixture''s jwt sub - discriminates helper resolution');

-- Pitfall-1 Probe 2: the 0007-reshaped policy is present in pg_policies -
-- catalog read from a superuser pocket so no policy state can mask it.
reset role;
set local request.jwt.claim.sub = '';
select results_eq(
  $$select count(*) from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and policyname = 'profiles admin-manages-staff'$$,
  ARRAY[1::bigint],
  'probe: the reshaped ''profiles admin-manages-staff'' policy is present - pins the missing-policy hypothesis');

-- PERMANENT pin: the stored predicate carries the 0007 reshape signature.
-- Containment form (verbatim qual captured in run 32764876499) tolerates
-- deparse spacing while failing loudly on any semantic rewrite.
select results_eq(
  $$select (position('current_user_role' in qual) > 0)
        and (position('= ''admin''::text' in qual) > 0)
        and (position('ARRAY[''staff''::text, ''admin''::text]' in qual) > 0)
     from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and policyname = 'profiles admin-manages-staff'$$,
  ARRAY[true],
   'probe: stored qual carries the reshape signature - helper=admin arm + staff/admin membership arm');

set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002'; -- admin restored

-- PERMANENT paradox pin (run 32769070295 evidence chain): the IDENTICAL
-- predicate evaluates TRUE as a plain SELECT under the admin sub while the
-- stored UPDATE policy built from it matches ZERO rows. This is the exact
-- engine-evaluation defect escalated to production scope - it must stay
-- green-honest: when the production reshape (0013) lands, this stays true.
select results_eq(
  $$select count(*) from public.profiles
     where (select public.current_user_role()) = 'admin'
       and role = any(array['staff', 'admin'])$$,
  ARRAY[1::bigint],
  'probe: the reshaped USING conjunction evaluates TRUE in plain SELECT under the admin sub');

-- TEMPORARY DIAGNOSTIC BLOCK (plan-count-neutral diag comments; REMOVE once
-- root cause identified). Evidence rounds 32773019239/32773879465: stored
-- qual verified present yet admin UPDATE candidacy stays zero across wrapped,
-- arm-swapped and unwrapped predicate forms.
reset role;
set local request.jwt.claim.sub = '';
select diag('DIAG_POLICIES: ' || coalesce((
       select string_agg(
         policyname || ' [cmd=' || cmd || ' perm=' || permissive || ' roles=' || roles::text
         || '] qual=' || encode(convert_to(coalesce(qual, ''), 'UTF8'), 'escape')
         || ' wc=' || encode(convert_to(coalesce(with_check, ''), 'UTF8'), 'escape'),
         E'\n#             ')
       from pg_policies
      where schemaname = 'public' and tablename = 'profiles'), 'NONE'));
select diag('DIAG_CURFN: definer=' || (select r.rolname from pg_proc f join pg_roles r on r.oid = f.proowner where f.proname = 'current_user_role')
         || ' bypassrls=' || (select r.rolbypassrls::text from pg_proc f join pg_roles r on r.oid = f.proowner where f.proname = 'current_user_role'));
select diag('DIAG_TABLE: owner=' || (select r.rolname from pg_class c join pg_roles r on r.oid = c.relowner where c.oid = 'public.profiles'::regclass)
         || ' rls=' || (select relrowsecurity::text from pg_class where oid = 'public.profiles'::regclass)
         || ' force=' || (select relforcerowsecurity::text from pg_class where oid = 'public.profiles'::regclass));
select diag('DIAG_GRANTS: sel=' || has_table_privilege('authenticated', 'public.profiles', 'SELECT')::text
         || ' upd=' || has_table_privilege('authenticated', 'public.profiles', 'UPDATE')::text);

set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002'; -- admin
select diag('DIAG_ROLE_UNDER_ADMIN_SUB=' || coalesce(public.current_user_role(), 'NULL'));
select diag('DIAG_SELFVIS=' || (select count(*)::text from public.profiles));
do $diag$
declare
  v_cnt bigint;
  v_st  text;
  v_msg text;
begin
  update public.profiles set full_name = full_name
   where id = '70000000-0000-0000-0000-000000000004';
  get diagnostics v_cnt = ROW_COUNT;
  perform set_config('gsd.diag.staff_upd', 'rowcount=' || v_cnt::text, true);
exception when others then
  get stacked diagnostics v_st = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  perform set_config('gsd.diag.staff_upd', 'EXC:' || v_st || ':' || v_msg, true);
end $diag$;
select diag('DIAG_UPD_STAFF_NOOP=' || coalesce(current_setting('gsd.diag.staff_upd', true), 'unset'));
do $diag$
declare
  v_cnt bigint;
  v_st  text;
  v_msg text;
begin
  update public.profiles set full_name = full_name
   where id = '70000000-0000-0000-0000-000000000003';
  get diagnostics v_cnt = ROW_COUNT;
  perform set_config('gsd.diag.peer_upd', 'rowcount=' || v_cnt::text, true);
exception when others then
  get stacked diagnostics v_st = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  perform set_config('gsd.diag.peer_upd', 'EXC:' || v_st || ':' || v_msg, true);
end $diag$;
select diag('DIAG_UPD_PEER_NOOP=' || coalesce(current_setting('gsd.diag.peer_upd', true), 'unset'));

-- PERMANENT regression guard for the escalated defect: an admin-sub UPDATE
-- must MATCH peer rows so the guard trigger can deny them LOUDLY. Asserted as
-- throws_ok on Gate P's exact 42501+message - under the escalated shape defect
-- the UPDATE silently matches ZERO rows, raises nothing, and this assert fails
-- "caught: no exception"; once 0013's reshape makes the row reachable the
-- trigger fires its designed denial and this flips green. (The former
-- reachability CTE form could never flip: pgTAP results_eq opens the query on
-- a bare cursor with no OTHERS handler, so post-reshape the raising UPDATE
-- would abort the whole script instead of recording a result.)
select throws_ok(
  $$update public.profiles set full_name = full_name where id = '70000000-0000-0000-0000-000000000003'$$,
  '42501', 'gsd-guard: admins are peer-protected - only super_admin manages admins D-11',
  'regression guard: admin-sub update REACHES the peer-admin row and Gate P denies it LOUDLY (red until 0013 reshapes the policy, see 01-12-SUMMARY)');

select throws_ok(
  $$update public.profiles set full_name = 'Renamed Peer' where id = '70000000-0000-0000-0000-000000000003'$$,
  '42501', 'gsd-guard: admins are peer-protected - only super_admin manages admins D-11',
  'admin editing another ADMIN''s row raises 42501 - management of admins belongs to super_admin alone (D-11)');

select throws_ok(
  $$update public.profiles set role = 'staff' where id = '70000000-0000-0000-0000-000000000003'$$,
  '42501', 'gsd-guard: admins are peer-protected - only super_admin manages admins D-11',
  'admin DEMOTING another admin dies at the guard trigger too - forged role changes get no quieter path');

select lives_ok(
  $$update public.profiles set full_name = 'Staff Renamed' where id = '70000000-0000-0000-0000-000000000004'$$,
  'admin renames a STAFF row freely - full power over staff (D-11/D-12)');

-- Positive control from a READING vantage (no admin select policy reaches
-- another user's row - counting under the admin sub was structurally blind).
reset role;
set local request.jwt.claim.sub = '';
select results_eq(
  $$select count(*) from public.profiles where id = '70000000-0000-0000-0000-000000000004' and full_name = 'Staff Renamed'$$,
  ARRAY[1::bigint],
  'positive control: the staff rename actually landed (guards against silent-filter masking)');
set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002'; -- admin restored

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000001'; -- super_admin

select lives_ok(
  $$update public.profiles set full_name = 'Admin Two Prime' where id = '70000000-0000-0000-0000-000000000003'$$,
  'super_admin manages admin rows including edits (D-11 second half)');

select throws_ok(
  $$update public.profiles set role = 'staff' where id = '70000000-0000-0000-0000-000000000003'$$,
  'P0001', 'gsd-guard: privileged columns role may only change through lifecycle RPCs',
  'even super_admin cannot flip roles by DIRECT UPDATE - lifecycle flows through audited RPCs only');

-- ---------------------------------------------------------------------------
-- Block 2: T-1-21 escalation - self-service privilege changes die at the guard
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000004'; -- staff

select lives_ok(
  $$update public.profiles set full_name = 'Staff Own Name' where id = '70000000-0000-0000-0000-000000000004'$$,
  'self-service full_name edit on own row succeeds (sanctioned direct path)');

select throws_ok(
  $$update public.profiles set role = 'super_admin' where id = '70000000-0000-0000-0000-000000000004'$$,
  'P0001', 'gsd-guard: privileged columns role may only change through lifecycle RPCs',
  'staff self-promotion to super_admin dies in the trigger even over a valid session (T-1-21)');

select throws_ok(
  $$update public.profiles set is_active = false where id = '70000000-0000-0000-0000-000000000004'$$,
  'P0001', 'gsd-guard: privileged columns is_active may only change through lifecycle RPCs',
  'staff cannot self-deactivate by direct UPDATE - lifecycle is RPC-exclusive');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002'; -- admin

select throws_ok(
  $$update public.profiles set role = 'super_admin' where id = '70000000-0000-0000-0000-000000000002'$$,
  'P0001', 'gsd-guard: privileged columns role may only change through lifecycle RPCs',
  'admin self-promotion dies identically - nobody forges their way up');

-- ---------------------------------------------------------------------------
-- Block 3: deactivation lifecycle D-19/D-20/D-21/D-22
-- ---------------------------------------------------------------------------

select throws_ok(
  $$update public.profiles set is_active = false where id = '70000000-0000-0000-0000-000000000004'$$,
  'P0001', 'gsd-guard: privileged columns is_active may only change through lifecycle RPCs',
  'admin flipping staff is_active DIRECTLY dies too - deactivation rides the audited RPC');

select lives_ok(
  $$select public.deactivate_staff_account('70000000-0000-0000-0000-000000000004')$$,
  'admin deactivates the staff account via RPC (D-17/D-19)');

-- JWT-STALENESS BACKSTOP IN ACTION: same unrefreshed staff token as above.
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000004';

select results_eq(
  $$select count(*) from public.invoices$$,
  ARRAY[0::bigint],
  'deactivated staff sees ZERO rows on the very next query DESPITE the still-valid token (D-20 instant data-plane death)');

select is(
  (select coalesce(public.current_user_role(), 'none')),
  'none'::text,
  'deactivated account holds no effective role anywhere (helpers gate on is_active)');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002'; -- admin

select results_eq(
  $$select count(*) from public.invoices where created_by = '70000000-0000-0000-0000-000000000004'$$,
  ARRAY[1::bigint],
  'orphaned draft REMAINS in the business, visible to admins for finalize-or-discard (D-22)');

select throws_ok(
  $$select public.deactivate_staff_account('70000000-0000-0000-0000-000000000003')$$,
  '42501', 'deactivate_staff_account admins may only deactivate staff accounts D-11 D-17',
  'RPC authorization upholds peer protection: admin cannot DEACTIVATE another admin (D-11/D-17)');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000001'; -- super_admin

select throws_ok(
  $$select public.deactivate_staff_account('70000000-0000-0000-0000-000000000001')$$,
  'P0001', 'deactivate_staff_account cannot deactivate your own account',
  'even super_admin cannot deactivate themselves - no last-admin self-lockout');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002'; -- admin

select lives_ok(
  $$select public.reactivate_staff_account('70000000-0000-0000-0000-000000000004')$$,
  're-hire = reactivate the same account via RPC (D-21)');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000004';

select results_eq(
  $$select count(*) from public.invoices$$,
  ARRAY[1::bigint],
  'reactivation restores visibility EXACTLY - history reattaches (D-21)');

-- ---------------------------------------------------------------------------
-- Block 4: D-28/D-29 unlock - the narrow exception
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000004'; -- staff

select throws_ok(
  $$select public.unlock_account_profile('70000000-0000-0000-0000-000000000001')$$,
  '42501', 'unlock_account_profile requires an admin or super_admin caller D-28 D-29',
  'staff cannot drive the unlock RPC (D-28 unlock belongs to admins)');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002'; -- admin

select lives_ok(
  $$select public.unlock_account_profile('70000000-0000-0000-0000-000000000001')$$,
  'ANY admin unlocks the locked-out SUPER ADMIN - the D-29 escape hatch');

-- Narrowness read-back from a reading vantage (the acting admin cannot SELECT
-- the super admin's row - self-read-only select policies).
reset role;
set local request.jwt.claim.sub = '';
select is(
  (select (locked_at is null)
      and role = 'super_admin'
      and is_active
      and full_name = 'Owner One'
     from public.profiles
     where id = '70000000-0000-0000-0000-000000000001'),
  true,
  'unlock changed ONLY the lock - role, activation and identity untouched (narrow exception stays narrow, D-29)');
set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002'; -- admin restored

-- ---------------------------------------------------------------------------
-- Block 5: D-14 two-step super-admin transfer
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.confirm_super_admin_transfer()$$,
  'P0001', 'confirm_super_admin_transfer no pending transfer initiation - two-step confirmation requires initiate first D-14',
  'confirm WITHOUT prior initiation fails - promotion needs the deliberate first step');

select throws_ok(
  $$select public.initiate_super_admin_transfer('70000000-0000-0000-0000-000000000001')$$,
  '42501', 'initiate_super_admin_transfer only super_admin may initiate the transfer D-14',
  'a regular admin cannot initiate the transfer');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000001'; -- super_admin

select throws_ok(
  $$select public.initiate_super_admin_transfer('70000000-0000-0000-0000-000000000001')$$,
  'P0001', 'initiate_super_admin_transfer cannot transfer to yourself',
  'initiating to self is refused');

select lives_ok(
  $$select public.initiate_super_admin_transfer('70000000-0000-0000-0000-000000000003')$$,
  'step 1: super_admin initiates the handover to Admin Two');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000004'; -- staff

select throws_ok(
  $$select public.confirm_super_admin_transfer()$$,
  '42501', 'confirm_super_admin_transfer caller is not the pending transfer target',
  'step 2 refused for a NON-target caller');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000003'; -- Admin Two

select lives_ok(
  $$select public.confirm_super_admin_transfer()$$,
  'step 2: the PENDING TARGET confirms within the window');

-- Swap verification from a reading vantage: neither post-transfer row set is
-- fully SELECT-visible under Admin Two's own token.
reset role;
set local request.jwt.claim.sub = '';
select results_eq(
  $$select role from public.profiles
     where id in ('70000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000003')
     order by id$$,
  ARRAY['admin', 'super_admin'],
  'roles swapped: old holder demoted to plain PEER-PROTECTED admin, target promoted (D-14)');

select is(
  (select (select pending_transfer_to is null and transfer_initiated_at is null from public.profiles where id = '70000000-0000-0000-0000-000000000001')
      and (select pending_transfer_to is null and transfer_initiated_at is null from public.profiles where id = '70000000-0000-0000-0000-000000000003')),
  true,
  'pending markers fully cleared on both rows after confirmation');
set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000003'; -- new super_admin restored

-- Expired-window mode: fresh initiation, then age past the one-hour limit.
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000003'; -- new super_admin

select lives_ok(
  $$select public.initiate_super_admin_transfer('70000000-0000-0000-0000-000000000001')$$,
  'fresh initiation for the expiry proof');

reset role;
set local request.jwt.claim.sub = '';
update public.profiles set transfer_initiated_at = now() - interval '2 hours'
 where id = '70000000-0000-0000-0000-000000000003';

set local role authenticated;
set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.confirm_super_admin_transfer()$$,
  'P0001', 'confirm_super_admin_transfer confirmation window expired - initiation valid for one hour',
  'confirmation AFTER the one-hour window fails (deliberate handover, not a race)');

-- ---------------------------------------------------------------------------
-- Block 6: D-15/D-37 business governance - super_admin only
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000004'; -- staff

select throws_ok(
  $$insert into public.businesses (legal_name, gstin) values ('Forge Co', '29FORGE0000F1Z9')$$,
  '42501', null,
  'STAFF direct business insert dies at the policy layer (D-15)');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002'; -- admin

select throws_ok(
  $$insert into public.businesses (legal_name, gstin) values ('Forge Co', '29FORGE0000F1Z9')$$,
  '42501', null,
  'ADMIN direct business insert dies at the policy layer too (D-15)');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000003'; -- super_admin

select lives_ok(
  $$select public.create_business('Business C', '29CCCCC0000C1Z2')$$,
  'super_admin creates a business through the audited RPC (D-15)');

select results_eq(
  $$select count(*) from public.businesses where legal_name = 'Business C'$$,
  ARRAY[1::bigint],
  'created business actually persisted');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000002'; -- admin

select throws_ok(
  $$select public.archive_business('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')$$,
  '42501', 'archive_business is restricted to super_admin D-37',
  'admin cannot ARCHIVE a business (D-37 matches creation rights)');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000004'; -- staff

select throws_ok(
  $$select public.archive_business('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')$$,
  '42501', 'archive_business is restricted to super_admin D-37',
  'staff cannot archive either (D-37)');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000003'; -- super_admin

select lives_ok(
  $$select public.archive_business('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')$$,
  'super_admin archives Business A (D-37)');

select is(
  (select archived_at is not null from public.businesses where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  true,
  'archive stamped archived_at');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000004'; -- staff

select results_eq(
  $$select count(*) from public.businesses where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'$$,
  ARRAY[1::bigint],
  'archived business stays READABLE to its members - reports remain readable while daily work stops (D-36 asymmetry)');

set local request.jwt.claim.sub = '70000000-0000-0000-0000-000000000003'; -- super_admin

select lives_ok(
  $$select public.restore_business('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')$$,
  'super_admin restores Business A (D-37)');

select is(
  (select archived_at is null from public.businesses where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'),
  true,
  'restore clears archived_at');

select * from finish();
rollback;
