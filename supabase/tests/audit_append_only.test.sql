-- Audit immutability + visibility + capture proof suite: Plan 05 onto audit_log.
--
-- Layering under test:
--   GRANT LAYER - role-switched `authenticated` blocks: staff AND admin
--     UPDATE/DELETE attempts raise 42501 (privileges revoked regardless of
--     policy scope); client INSERT fails closed (no insert policy exists
--     under FORCE RLS); staff SELECT sees ZERO rows despite live entries
--     (Pitfall 1 discipline: every block sets BOTH the role and an explicit
--     jwt sub claim; positive controls guard against null-auth.uid() masking).
--   TRIGGER LAYER - proven INDEPENDENT of grants: the mutation runs under
--     the migration-owner (true-superuser) execution context, where grant
--     checks are bypassed entirely and only block_mutation() can refuse.
--     HONEST CAVEAT (RESEARCH Pattern 5 / T-1-19): that same superuser could
--     ALTER TABLE ... DISABLE TRIGGER - accepted residual; tamper-EVIDENCE
--     hash chain deferred to Phase 8 (additive columns reserved).
--   CAPTURE LAYER - fixture writes fire trg_audit_capture in this same
--     rollback-wrapped transaction; admin positive control counts them;
--     a profiles.role flip must produce before_val/after_val differing
--     EXACTLY on the role key (D-23/D-26); no-JWT write_audit appends the
--     actor_id NULL + actor_type 'system' row (AUDIT-service-actor).
--
-- Seeding happens as superuser BEFORE any role switch. Negatives use
-- throws_ok with SQLSTATE plus regex-safe message substrings.
--
-- Runtime evidence: authored alongside Windows-local execution where the
-- Docker daemon is unavailable (WINDOWS.md convention) - suite must run
-- green via `supabase test db` in CI/Wave-7 before sign-off.

begin;
set search_path = public, extensions;
select plan(15);

-- ---------------------------------------------------------------------------
-- Fixtures (superuser context - these writes themselves fire trg_audit_capture)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'staff-a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'target-staff@test.local'),
  ('55555555-5555-5555-5555-555555555555', 'admin@test.local');

insert into public.profiles (id, email, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'staff-a@test.local',      'Staff A',      'staff'),
  ('22222222-2222-2222-2222-222222222222', 'target-staff@test.local', 'Target Staff', 'staff'),  -- role-flip subject
  ('55555555-5555-5555-5555-555555555555', 'admin@test.local',        'The Admin',    'admin');

insert into public.businesses (id, legal_name, gstin) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Business A', '29AAAAA0000A1Z0');

insert into public.business_members (business_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- Block 1: GRANT LAYER - staff AND admin UPDATE/DELETE die 42501 at the ACL,
-- before any policy or trigger evaluation (T-1-17 gate one)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$update public.audit_log set action = 'tampered'$$,
  '42501', null,
  'staff UPDATE on audit_log raises 42501 at the grants layer regardless of policies');

select throws_ok(
  $$delete from public.audit_log$$,
  '42501', null,
  'staff DELETE on audit_log raises 42501 at the grants layer');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select throws_ok(
  $$update public.audit_log set before_val = '{"role": "staff"}'::jsonb$$,
  '42501', null,
  'admin UPDATE on audit_log raises 42501 too - even the reading role holds no mutation grant');

select throws_ok(
  $$delete from public.audit_log$$,
  '42501', null,
  'admin DELETE on audit_log raises 42501 - D-25 binds admins identically');

-- ---------------------------------------------------------------------------
-- Block 2: TRIGGER LAYER independent of grants - run mutations under the
-- migration-owner (true-superuser) context, where grant checks are bypassed
-- entirely and ONLY the unconditional statement triggers can refuse.
-- Caveat documented in header: superuser COULD disable these triggers
-- (T-1-19 residual; Phase 8 hash-chain evidence deferred).
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claim.sub = '';

select throws_ok(
  $$update public.audit_log set action = 'rewritten by owner'$$,
  'P0001', 'UPDATE on audit_log is append-only (D-25)',
  'trigger layer refuses UPDATE even under elevated privileges, naming the operation (audit_no_update)');

select throws_ok(
  $$delete from public.audit_log$$,
  'P0001', 'DELETE on audit_log is append-only (D-25)',
  'trigger layer refuses DELETE under elevated privileges (audit_no_delete)');

select throws_ok(
  $$truncate public.audit_log$$,
  'P0001', 'TRUNCATE on audit_log is append-only (D-25)',
  'trigger layer refuses TRUNCATE - bulk erasure is equally impossible (D-24 forever retention)');

-- ---------------------------------------------------------------------------
-- Block 3: CLIENT INSERT fails closed + staff zero-row visibility (D-27)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$insert into public.audit_log (action) values ('forged.entry')$$,
  '42501', null,
  'client-role INSERT into audit_log fails closed - NO insert policy exists (write path is definer-only)');

select is_empty(
  $$select * from public.audit_log$$,
  'staff sees ZERO audit rows although entries already exist in this transaction (T-1-18)');

-- ---------------------------------------------------------------------------
-- Block 4: ADMIN positive control + permission-change before/after capture
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select results_eq(
  $$select count(*) from public.audit_log where action = 'profiles.insert'$$,
  ARRAY[3::bigint],
  'positive control: admin DOES see the three profile rows captured during this test''s own fixtures');

-- Permission-change event (D-23 access half): flip the target's role under a
-- no-JWT service/migration-style context.
reset role;
set local request.jwt.claim.sub = '';
update public.profiles set role = 'admin'
 where id = '22222222-2222-2222-2222-222222222222';

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select is(
  $$select a.action || '|' || (a.before_val ->> 'role') || '|' || (a.after_val ->> 'role')
      from public.audit_log a
     where a.action = 'profiles.update'
       and a.target_table = 'profiles'
       and a.target_id = '22222222-2222-2222-2222-222222222222'
     order by a.id desc limit 1$$,
  'profiles.update|staff|admin'::text,
  'role flip captured with before_val/after_val differing exactly on the role key (D-23/D-26)');

-- ---------------------------------------------------------------------------
-- Block 5: sanctioned writer contract + system-context semantics + probe
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.write_audit('forged.direct', 'audit_log', null, null, null, null)$$,
  '42501', null,
  'clients hold zero EXECUTE on write_audit - the sanctioned append path cannot be driven directly');

reset role;
set local request.jwt.claim.sub = '';

select lives_ok(
  $$select public.write_audit('system.selftest', 'audit_log', null, null, null, null)$$,
  'definer-owned write_audit appends successfully without any JWT context');

select results_eq(
  $$select count(*) from public.audit_log
     where action = 'system.selftest'
       and actor_id is null
       and actor_type = 'system'$$,
  ARRAY[1::bigint],
  'no-JWT append stores actor_id NULL + actor_type system (AUDIT-service-actor semantics)');

select is(
  $$(select public.health_check())$$,
  'ok'::text,
  'health_check RPC returns the constant ok - free-tier keep-alive target (D-39)');

select * from finish();
rollback;
