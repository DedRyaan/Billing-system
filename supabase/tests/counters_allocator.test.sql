-- SC-4 allocator proof suite: gapless numbering machinery (migration 0003).
--
-- Assertions run as superuser calling the SECURITY DEFINER allocator directly
-- (superuser executes definer functions regardless of revoked EXECUTE) — this
-- tier proves the SQL-layer guarantees; the wire-level concurrency proof lives
-- in tests/counters.rpc.test.ts. App-role unreachability negatives at the end
-- prove the revoked-grant posture itself (T-1-06/T-1-07).
--
-- Rollback-no-burn uses SAVEPOINT / ROLLBACK TO SAVEPOINT: `supabase test db`
-- runs each file inside one transaction (this file opens BEGIN/ROLLBACK), and a
-- nested START TRANSACTION … ROLLBACK would abort the whole harness. Aborting a
-- savepoint that wraps an allocation undoes the counter increment and releases
-- the row lock — exactly the commit/rollback semantics the guarantee is about.
-- A Postgres sequence object could never pass this block.
--
-- Seeding happens as superuser BEFORE any role switch (Pitfall 1 discipline).
-- FY label '26-27' is the current Indian FY at authoring time (valid through
-- March 2027); Phase 2's pure FY engine replaces the hardcoded label.

begin;
set search_path = public, extensions;
-- plan(22), not 23: the file contains exactly twenty-two authored assertion
-- calls (verified by counting the five assertion-call prefixes); the
-- twenty-third was never written and a planned-23/ran-22 mismatch aborts the
-- harness with "Bad plan" after all assertions pass.
select plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures (superuser context)
-- ---------------------------------------------------------------------------

insert into public.businesses (id, legal_name, gstin, number_format, prefix) values
  ('ccccccc1-0000-0000-0000-000000000001', 'Gapless Proofs Co', '29GAPLA0000A1Z9', 'prefix_fy_seq', 'INVC'),
  ('ccccccc2-0000-0000-0000-000000000002', 'Series Split Co',   '27SERIE0000B1Z2', 'prefix_seq',    'ESTM'),
  ('ccccccc3-0000-0000-0000-000000000003', 'Format FY Co',      '07FORMAT000C1Z5', 'prefix_fy_seq', 'INVF'),
  ('ccccccc4-0000-0000-0000-000000000004', 'Format Dash Co',    '05FORMAT000D1Z7', 'prefix_seq',    'FMTS'),
  ('ccccccc5-0000-0000-0000-000000000005', 'Bare Seq Co',       '24BARESE00E1Z0',  'seq',           'IGNR'),
  ('ccccccc6-0000-0000-0000-000000000006', 'Editable Co',       '33EDITAB000F1Z2', 'prefix_fy_seq', 'EDIT');

-- ---------------------------------------------------------------------------
-- Block A: fresh scope allocates exactly 1, 2, 3 — consecutive integers
-- ---------------------------------------------------------------------------

select is(
  public.allocate_next_number('ccccccc1-0000-0000-0000-000000000001'::uuid, '26-27', 'invoice'),
  1::int,
  'first-ever allocation for a scope returns exactly 1 (SC4-empty bootstrap path)');

select is(
  public.allocate_next_number('ccccccc1-0000-0000-0000-000000000001'::uuid, '26-27', 'invoice'),
  2::int,
  'second allocation returns 2');

select is(
  public.allocate_next_number('ccccccc1-0000-0000-0000-000000000001'::uuid, '26-27', 'invoice'),
  3::int,
  'third allocation returns 3');

select results_eq(
  $$select prefix_locked from public.invoice_counters
     where business_id = 'ccccccc1-0000-0000-0000-000000000001'::uuid
       and fy = '26-27' and series_type = 'invoice'$$,
  ARRAY['INVC'::text],
  'first issue froze the business prefix into prefix_locked (D-32 storage)');

-- ---------------------------------------------------------------------------
-- Block B: transaction allocates then rolls back — NOTHING burns
-- ---------------------------------------------------------------------------

savepoint before_burn;

select is(
  public.allocate_next_number('ccccccc1-0000-0000-0000-000000000001'::uuid, '26-27', 'invoice'),
  4::int,
  'allocation about to be aborted hands out number 4');

rollback to savepoint before_burn;

select is(
  public.allocate_next_number('ccccccc1-0000-0000-0000-000000000001'::uuid, '26-27', 'invoice'),
  4::int,
  'aborted allocation burned nothing - number 4 reissued on next attempt (gapless guarantee)');

-- ---------------------------------------------------------------------------
-- Block C: duplicate-sequence backstop turns allocator bugs into loud 23505
-- (scratch table carries the exact backstop index Phase 4 copies onto documents)
-- ---------------------------------------------------------------------------

create table counter_backstop_scratch (
  id          bigint generated always as identity primary key,
  business_id uuid not null,
  fy          text not null,
  series_type text not null,
  seq         integer not null
);

create unique index counter_backstop_scratch_uq
  on counter_backstop_scratch (business_id, fy, series_type, seq);

insert into counter_backstop_scratch (business_id, fy, series_type, seq)
values ('ccccccc1-0000-0000-0000-000000000001'::uuid, '26-27', 'invoice', 1);

select throws_ok(
  $$insert into counter_backstop_scratch (business_id, fy, series_type, seq)
    values ('ccccccc1-0000-0000-0000-000000000001'::uuid, '26-27', 'invoice', 1)$$,
  '23505', null,
  'duplicate (business, fy, series, seq) violates the backstop with 23505');

-- ---------------------------------------------------------------------------
-- Block D: D-32 prefix lock — free while counter is zero, locked after issue
-- ---------------------------------------------------------------------------

select lives_ok(
  $$update public.businesses set prefix = 'EDTX'
     where id = 'ccccccc6-0000-0000-0000-000000000006'::uuid$$,
  'prefix editable freely while the current-FY counter is zero');

select throws_ok(
  $$update public.businesses set prefix = 'NEWPX'
     where id = 'ccccccc1-0000-0000-0000-000000000001'::uuid$$,
  'P0001', 'numbering identity is locked for FY 26-27 once numbers have been issued (D-32)',
  'prefix edit rejected once the current-FY counter has issued numbers (D-32)');

select throws_ok(
  $$update public.businesses set number_format = 'seq'
     where id = 'ccccccc1-0000-0000-0000-000000000001'::uuid$$,
  'P0001', 'numbering identity is locked for FY 26-27 once numbers have been issued (D-32)',
  'number_format edit equally locked after first issue (D-30/D-32)');

-- ---------------------------------------------------------------------------
-- Block E: D-34 series independence — invoice/estimate/credit_note count
-- separately for the same business + FY
-- ---------------------------------------------------------------------------

select is(
  public.allocate_next_number('ccccccc2-0000-0000-0000-000000000002'::uuid, '26-27', 'invoice'),
  1::int,
  'invoice series starts at 1');

select is(
  public.allocate_next_number('ccccccc2-0000-0000-0000-000000000002'::uuid, '26-27', 'estimate'),
  1::int,
  'estimate series independently starts at 1 (D-34)');

select is(
  public.allocate_next_number('ccccccc2-0000-0000-0000-000000000002'::uuid, '26-27', 'credit_note'),
  1::int,
  'credit_note series independently starts at 1 (D-34)');

select is(
  public.allocate_next_number('ccccccc2-0000-0000-0000-000000000002'::uuid, '26-27', 'invoice'),
  2::int,
  'invoice advances to 2 without disturbing the other series');

-- ---------------------------------------------------------------------------
-- Block F: format_document_number renders all three templates, lpad-4 (D-30/D-33)
-- ---------------------------------------------------------------------------

select is(
  public.allocate_next_number('ccccccc3-0000-0000-0000-000000000003'::uuid, '26-27', 'invoice'),
  1::int, 'format-FY fixture allocated number 1');

select is(
  public.format_document_number('ccccccc3-0000-0000-0000-000000000003'::uuid, '26-27', 'invoice'),
  'INVF/26-27/0001',
  'template {PREFIX}/{FY}/{SEQ} renders PREFIX/FY/lpad-4 SEQ');

select is(
  public.allocate_next_number('ccccccc4-0000-0000-0000-000000000004'::uuid, '26-27', 'invoice'),
  1::int, 'format-dash fixture allocated number 1');

select is(
  public.format_document_number('ccccccc4-0000-0000-0000-000000000004'::uuid, '26-27', 'invoice'),
  'FMTS-0001',
  'template {PREFIX}-{SEQ} renders PREFIX-lpad-4 SEQ');

select is(
  public.allocate_next_number('ccccccc5-0000-0000-0000-000000000005'::uuid, '26-27', 'invoice'),
  1::int, 'bare-seq fixture allocated number 1');

select is(
  public.format_document_number('ccccccc5-0000-0000-0000-000000000005'::uuid, '26-27', 'invoice'),
  '0001',
  'bare {SEQ} template ignores the business prefix entirely');

-- ---------------------------------------------------------------------------
-- Block G: application roles cannot touch the allocator or counter rows
-- (T-1-06 tampering / T-1-07 silent-edit mitigations proven, not assumed)
-- ---------------------------------------------------------------------------

set local role authenticated;

select throws_ok(
  $$select public.allocate_next_number(
       'ccccccc1-0000-0000-0000-000000000001'::uuid, '26-27', 'invoice')$$,
  '42501', null,
  'authenticated holds NO execute on allocate_next_number (T-1-06)');

select throws_ok(
  $$select last_number from public.invoice_counters limit 1$$,
  '42501', null,
  'counter rows unreachable by application roles (T-1-07)');

reset role;

select * from finish();
rollback;
