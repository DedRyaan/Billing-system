-- Ledger + master-data proof suite: Plan 04 onto payments/customers/catalog_items.
--
-- Layering under test:
--   POLICY/GRANT LAYER (role-switched `authenticated` blocks) - append-only
--     payments (zero update/delete paths), derived-totals movement across
--     unpaid->partial->paid boundaries, D-43 staff-writable customers,
--     D-44 admin-only catalog, isolation negatives + positives (Pitfall 1
--     discipline: every block sets BOTH the role and an explicit jwt sub
--     claim; positive controls guard against null-auth.uid() masking).
--   CARVE-OUT PROOFS - direct client UPDATE of an ISSUED invoice's
--     {paid_amount, payment_status} dies with 42501 for staff AND admin,
--     proving the SECURITY DEFINER maintainer is the sole writer that ever
--     touches those columns (Plan 03 x Plan 04 contract).
--
-- Seeding happens as superuser BEFORE any role switch. Negatives use
-- throws_ok with SQLSTATE plus regex-safe message substrings; deletion
-- denials that Postgres enforces by silent row filtering (customers
-- retention) use count-based assertions per plan instruction.
--
-- Runtime evidence: authored alongside Windows-local execution where the
-- Docker daemon is unavailable (WINDOWS.md convention) - suite must run
-- green via `supabase test db` in CI/Wave-7 before sign-off.

begin;
set search_path = public, extensions;
select plan(56);

-- ---------------------------------------------------------------------------
-- Fixtures (superuser context)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'staff-a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'staff-b@test.local'),
  ('55555555-5555-5555-5555-555555555555', 'admin@test.local'),
  ('66666666-6666-6666-6666-666666666666', 'super-admin@test.local'),
  ('77777777-7777-7777-7777-777777777777', 'arch-member@test.local'),
  ('88888888-8888-8888-8888-888888888888', 'empty-user@test.local');

insert into public.profiles (id, email, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'staff-a@test.local',      'Staff A',       'staff'),
  ('22222222-2222-2222-2222-222222222222', 'staff-b@test.local',      'Staff B',       'staff'),
  ('55555555-5555-5555-5555-555555555555', 'admin@test.local',        'The Admin',     'admin'),
  ('66666666-6666-6666-6666-666666666666', 'super-admin@test.local',  'The Owner',     'super_admin'),
  ('77777777-7777-7777-7777-777777777777', 'arch-member@test.local',  'Arch Member',   'staff'),
  ('88888888-8888-8888-8888-888888888888', 'empty-user@test.local',   'Empty User',    'staff');

insert into public.businesses (id, legal_name, gstin, archived_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Business A',      '29AAAAA0000A1Z0', null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Business B',      '27BBBBB0000B1Z3', null),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Archived Biz',    '24CCCCC0000C1Z6', null),   -- D-36 target: archived BELOW, after its issued document is seeded
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Brand New Biz',   '07DDDDD0000D1Z9', null);   -- emptiness control

insert into public.business_members (business_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'), -- staffA -> A
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222'), -- staffB -> B
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '77777777-7777-7777-7777-777777777777'), -- arch member -> C
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '88888888-8888-8888-8888-888888888888'); -- empty user -> D

-- Issued documents with known frozen totals (definer-seeded; clients cannot
-- create issued rows). inv-A1 carries the boundary-transition story
-- (1000.00); inv-B1 the staff-B positive surface; inv-C1 the D-36
-- archived-business payment target.
insert into public.invoices
  (id, business_id, fy, status, seq, issued_at, issued_by,
   customer_name, customer_gstin, supply_type, registration_type, total_amount, created_by)
values
  ('c0000000-0000-0000-0000-000000000101', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '26-27', 'issued', 1, now(),
   '55555555-5555-5555-5555-555555555555', 'Buyer A Pvt Ltd', '29AAAAA0000A1Z0', 'intra_state', 'regular', 1000.00,
   '55555555-5555-5555-5555-555555555555'),
  ('c0000000-0000-0000-0000-000000000201', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '26-27', 'issued', 1, now(),
   '55555555-5555-5555-5555-555555555555', 'Buyer B LLP',     '27BBBBB0000B1Z3', 'inter_state', 'regular', 800.00,
   '55555555-5555-5555-5555-555555555555'),
  ('c0000000-0000-0000-0000-000000000301', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '26-27', 'issued', 1, now(),
   '55555555-5555-5555-5555-555555555555', 'Buyer C Traders', '24CCCCC0000C1Z6', 'intra_state', 'regular', 600.00,
   '55555555-5555-5555-5555-555555555555');

-- NOW archive business C: trg_archive_guard blocks NEW documents into an
-- already-archived business (fixtures included), so the issued document must
-- exist first. Block 8 proves both archived-state halves from here on.
update public.businesses set archived_at = now()
 where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- Draft WITH a seeded non-zero total proves the draft-or-issued payment path
-- (money can arrive pre-issue; totals maintenance is status-blind).
insert into public.invoices
  (id, business_id, fy, status, customer_name, total_amount, created_by)
values
  ('c0000000-0000-0000-0000-000000000102', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '26-27', 'draft',
   'Draft Buyer', 400.00, '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- Block 1: positive controls (Pitfall 1 - emptiness must never mask auth bugs)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$select count(*) from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000101'::uuid$$,
  ARRAY[1::bigint],
  'positive control: staff A DOES see own-business issued invoice (null-auth masking guard)');

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select results_eq(
  $$select count(*) from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000201'::uuid$$,
  ARRAY[1::bigint],
  'positive control: staff B DOES see own-business issued invoice');

-- ---------------------------------------------------------------------------
-- Block 2: derived totals - PAY-empty baseline + unpaid->partial->paid
-- boundaries + overpayment guard + operation-id idempotency backstop
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  (select paid_amount || '|' || payment_status from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000101'::uuid),
  '0.00|unpaid',
  'invoice with zero payments shows paid_amount 0 and status unpaid (PAY-empty)');

select lives_ok(
  $$insert into public.payments (invoice_id, business_id, amount, method, recorded_by, operation_id)
    values ('c0000000-0000-0000-0000-000000000101'::uuid,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 400.00, 'upi',
            '11111111-1111-1111-1111-111111111111'::uuid,
            'f0000000-0000-0000-0000-000000000001')$$,
  'staff records first part-payment against own-business issued invoice');

select is(
  (select paid_amount || '|' || payment_status from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000101'::uuid),
  '400.00|partial',
  'ledger insert moves derived fields to 400.00/partial');

select lives_ok(
  $$insert into public.payments (invoice_id, business_id, amount, recorded_by, operation_id)
    values ('c0000000-0000-0000-0000-000000000101'::uuid,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 599.99,
            '11111111-1111-1111-1111-111111111111'::uuid,
            'f0000000-0000-0000-0000-000000000002')$$,
  'second part-payment brings ledger sum to 999.99');

select is(
  (select paid_amount || '|' || payment_status from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000101'::uuid),
  '999.99|partial',
  'still partial below the total (999.99 < 1000.00)');

select lives_ok(
  $$insert into public.payments (invoice_id, business_id, amount, recorded_by, operation_id)
    values ('c0000000-0000-0000-0000-000000000101'::uuid,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 0.01,
            '11111111-1111-1111-1111-111111111111'::uuid,
            'f0000000-0000-0000-0000-000000000003')$$,
  'exact-balance payment (paise-precise 0.01) accepted');

select is(
  (select paid_amount || '|' || payment_status from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000101'::uuid),
  '1000.00|paid',
  'payment exactly equal to balance flips status to paid (PAY-boundary)');

select throws_ok(
  $$insert into public.payments (invoice_id, business_id, amount, recorded_by, operation_id)
    values ('c0000000-0000-0000-0000-000000000101'::uuid,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 0.01,
            '11111111-1111-1111-1111-111111111111'::uuid,
            'f0000000-0000-0000-0000-000000000009')$$,
  'P0001', 'payment exceeds invoice balance - total 1000.00, ledger sum 1000.01 (overpayment rejected)',
  'overpayment attempt rejected by the totals-maintainer guard');

select throws_ok(
  $$insert into public.payments (invoice_id, business_id, amount, recorded_by, operation_id)
    values ('c0000000-0000-0000-0000-000000000101'::uuid,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 400.00,
            '11111111-1111-1111-1111-111111111111'::uuid,
            'f0000000-0000-0000-0000-000000000001')$$,
  '23505', 'duplicate key value violates unique constraint "payments_business_operation_backstop"',
  'duplicate sync delivery with same operation_id collapses at the idempotency backstop');

select results_eq(
  $$select count(*) from public.payments
    where invoice_id = 'c0000000-0000-0000-0000-000000000101'::uuid$$,
  ARRAY[3::bigint],
  'exactly three ledger rows survived the rejected fourth + duplicate attempts');

select is(
  (select coalesce(sum(amount), 0) from public.payments
     where invoice_id = 'c0000000-0000-0000-0000-000000000101'::uuid)
   = (select paid_amount from public.invoices
      where id = 'c0000000-0000-0000-0000-000000000101'::uuid),
  true,
  'denormalized paid_amount reconciles with SUM-over-ledger (derived, not incremented)');

-- ---------------------------------------------------------------------------
-- Block 3: NEGATIVE carve-out proof - direct client UPDATE of an ISSUED
-- invoice's system-maintained columns dies with 42501 for staff AND admin
-- AND super_admin; the SECURITY DEFINER maintainer is the sole writer
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$update public.invoices set paid_amount = 0
    where id = 'c0000000-0000-0000-0000-000000000101'::uuid$$,
  '42501', null,
  'staff direct UPDATE of paid_amount on ISSUED row raises 42501');

select throws_ok(
  $$update public.invoices set payment_status = 'unpaid'
    where id = 'c0000000-0000-0000-0000-000000000101'::uuid$$,
  '42501', null,
  'staff direct UPDATE of payment_status on ISSUED row raises 42501');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select throws_ok(
  $$update public.invoices set paid_amount = 0
    where id = 'c0000000-0000-0000-0000-000000000101'::uuid$$,
  '42501', null,
  'admin direct UPDATE of paid_amount on ISSUED row ALSO raises 42501 - no role exemption');

select throws_ok(
  $$update public.invoices set payment_status = 'paid'
    where id = 'c0000000-0000-0000-0000-000000000101'::uuid$$,
  '42501', null,
  'admin direct UPDATE of payment_status raises 42501 too');

set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';

select throws_ok(
  $$update public.invoices set paid_amount = 42
    where id = 'c0000000-0000-0000-0000-000000000101'::uuid$$,
  '42501', null,
  'super_admin direct UPDATE of paid_amount raises 42501 - definer trigger is the ONLY writer');

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  (select paid_amount || '|' || payment_status from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000101'::uuid),
  '1000.00|paid',
  'system-maintained columns byte-identical after every direct client attempt');

-- ---------------------------------------------------------------------------
-- Block 4: draft-or-issued payment path + append-only universality
-- (every application role denied on payment mutations)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.payments (invoice_id, business_id, amount, recorded_by, operation_id)
    values ('c0000000-0000-0000-0000-000000000102'::uuid,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 400.00,
            '11111111-1111-1111-1111-111111111111'::uuid,
            'f0000000-0000-0000-0000-000000000004')$$,
  'payment against a DRAFT invoice (with seeded total) accepted - draft-or-issued path');

select is(
  (select paid_amount || '|' || payment_status from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000102'::uuid),
  '400.00|paid',
  'draft totals maintenance crosses the same paid boundary (status-blind derivation)');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select throws_ok(
  $$update public.payments set amount = 999999
    where operation_id = 'f0000000-0000-0000-0000-000000000001'::uuid$$,
  '42501', null,
  'admin UPDATE on a payment row raises 42501 (append-only universal, grants layer)');

select throws_ok(
  $$delete from public.payments
    where operation_id = 'f0000000-0000-0000-0000-000000000001'::uuid$$,
  '42501', null,
  'admin DELETE on a payment row raises 42501 (append-only universal)');

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$update public.payments set amount = 1
    where operation_id = 'f0000000-0000-0000-0000-000000000001'::uuid$$,
  '42501', null,
  'staff UPDATE on own payment row raises 42501 - even the recording member cannot edit');

select throws_ok(
  $$delete from public.payments
    where operation_id = 'f0000000-0000-0000-0000-000000000001'::uuid$$,
  '42501', null,
  'staff DELETE on own payment row raises 42501');

set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';

select throws_ok(
  $$update public.payments set note = 'owner adjustment'
    where operation_id = 'f0000000-0000-0000-0000-000000000001'::uuid$$,
  '42501', null,
  'super_admin UPDATE on a payment row raises 42501 - corrections are future reversal entries');

-- ---------------------------------------------------------------------------
-- Block 5: isolation - staff B gets zero rows and 42501 on business A
-- (payments, customers, catalog), with positive own-business controls
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is_empty(
  $$select * from public.payments
    where business_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid$$,
  'staff B sees ZERO payment rows from business A (T-1-15)');

select is_empty(
  $$select * from public.customers
    where business_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid$$,
  'staff B sees ZERO customer rows from business A (T-1-15)');

select is_empty(
  $$select * from public.catalog_items
    where business_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid$$,
  'staff B sees ZERO catalog rows from business A (T-1-15)');

select throws_ok(
  $$insert into public.payments (invoice_id, business_id, amount, operation_id)
    values ('c0000000-0000-0000-0000-000000000101'::uuid,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 10.00,
            'f0000000-0000-0000-0000-000000000007')$$,
  '42501', null,
  'staff B cannot forge a payment INTO business A');

select throws_ok(
  $$insert into public.payments (invoice_id, business_id, amount, operation_id)
    values ('c0000000-0000-0000-0000-000000000101'::uuid,
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 10.00,
            'f0000000-0000-0000-0000-000000000008')$$,
  '23503', 'insert or update on table "payments" violates foreign key constraint "payments_invoice_scope_fk"',
  'scope-mismatch forgery (own tenant key, A''s invoice) dies at the composite scope FK');

select lives_ok(
  $$insert into public.payments (invoice_id, business_id, amount, recorded_by, operation_id)
    values ('c0000000-0000-0000-0000-000000000201'::uuid,
            'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 300.00,
            '22222222-2222-2222-2222-222222222222'::uuid,
            'f0000000-0000-0000-0000-000000000005')$$,
  'positive control: staff B records a payment against OWN business B invoice');

select is(
  (select paid_amount || '|' || payment_status from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000201'::uuid),
  '300.00|partial',
  'own-business payment moved B''s derived totals correctly');

select is(
  (select coalesce(sum(amount), 0) from public.payments
     where invoice_id = 'c0000000-0000-0000-0000-000000000201'::uuid)
   = (select paid_amount from public.invoices
      where id = 'c0000000-0000-0000-0000-000000000201'::uuid),
  true,
  'business B ledger reconciles with its denormalized paid_amount');

-- ---------------------------------------------------------------------------
-- Block 6: customers - D-43 staff add/edit within assigned businesses,
-- DELETE denied everywhere (retention, soft-delete via is_active)
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select lives_ok(
  $$insert into public.customers (business_id, name, state, gstin)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Alpha Traders', 'Karnataka', '29ALPHA1234F1Z5')$$,
  'staff A adds a customer in own business (D-43)');

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select lives_ok(
  $$insert into public.customers (business_id, name, phone)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Beta Enterprises', '+91 90000 00000')$$,
  'staff B adds a customer in own business (D-43)');

select is(
  (select name from public.customers
    where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),
  'Beta Enterprises',
  'customer insert landed');

select lives_ok(
  $$update public.customers set phone = '+91 91111 11111'
    where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
      and name = 'Beta Enterprises'$$,
  'staff B EDITS the customer (D-43 edit half)');

-- DELETE denial is enforced at the GRANTS layer (authenticated holds no
-- DELETE privilege on customers), so the attempt dies loudly with 42501
-- before RLS row filtering could ever return zero rows - same loud-denial
-- shape the payments append-only proofs use above.
select throws_ok(
  $$delete from public.customers
    where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
      and name = 'Beta Enterprises'$$,
  '42501', null,
  'staff DELETE of a customer denied at the grants layer (retention - soft-delete via is_active)');

select results_eq(
  $$select count(*) from public.customers
    where name = 'Beta Enterprises'$$,
  ARRAY[1::bigint],
  'customer row survives the denied delete (nothing was lost)');

select throws_ok(
  $$insert into public.customers (business_id, name)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Forge')$$,
  '42501', null,
  'staff B cannot forge a customer into business A');

-- ---------------------------------------------------------------------------
-- Block 7: catalog - D-44 admin-only management, staff read-only;
-- denial/success pair on IDENTICAL writes
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.catalog_items (business_id, name, hsn_sac, gst_rate, unit, price)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Staff Item', '998314', 18.00, 'nos', 100.00)$$,
  '42501', null,
  'staff INSERT into catalog raises 42501 (D-44 - fixed price menu)');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select lives_ok(
  $$insert into public.catalog_items (business_id, name, hsn_sac, gst_rate, unit, price)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Consulting Hour', '998314', 18.00, 'nos', 500.00)$$,
  'admin performs the IDENTICAL catalog insert successfully (D-44 other half)');

select is(
  (select name from public.catalog_items
    where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),
  'Consulting Hour',
  'admin catalog insert landed');

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$update public.catalog_items set price = 1
    where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid$$,
  '42501', null,
  'staff UPDATE of catalog pricing raises 42501 (T-1-14)');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select lives_ok(
  $$update public.catalog_items set price = 550.00
    where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid$$,
  'admin reprices the identical catalog row freely (owns the menu, D-44/D-46 basis)');

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$delete from public.catalog_items
    where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid$$,
  '42501', null,
  'staff DELETE of catalog rows raises 42501');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select results_eq(
  $$with gone as (
       delete from public.catalog_items
       where business_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
         and name = 'Consulting Hour'
       returning 1
     ) select count(*) from gone$$,
  ARRAY[1::bigint],
  'admin DELETE removes the catalog row (full management rights)');

-- ---------------------------------------------------------------------------
-- Block 8: D-36 archive asymmetry - archived business ACCEPTS money-in while
-- rejecting new documents
-- ---------------------------------------------------------------------------

set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';

select lives_ok(
  $$insert into public.payments (invoice_id, business_id, amount, recorded_by, operation_id)
    values ('c0000000-0000-0000-0000-000000000301'::uuid,
            'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 250.00,
            '77777777-7777-7777-7777-777777777777'::uuid,
            'f0000000-0000-0000-0000-000000000006')$$,
  'payment against ARCHIVED business invoice ACCEPTED (D-36 asymmetry - receivables trickle in)');

select is(
  (select paid_amount || '|' || payment_status from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000301'::uuid),
  '250.00|partial',
  'archived-business payment moved derived totals (reports stay live)');

select throws_ok(
  $$insert into public.invoices (business_id, fy, customer_name)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '26-27', 'Too Late')$$,
  'P0001', 'new documents are blocked for archived businesses (D-36)',
  'asymmetry contrast: NEW documents remain blocked for the archived business (trg_archive_guard)');

set local request.jwt.claim.sub = '';

select is(
  (select coalesce(sum(amount), 0) from public.payments)
    = (select sum(paid_amount) from public.invoices),
  true,
  'GLOBAL reconciliation: every ledger rupee is reflected in exactly one invoice''s paid_amount');

-- ---------------------------------------------------------------------------
-- Block 9: emptiness control - brand-new business, zero money/master data,
-- but D-43 works immediately for its members
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888888';

select is_empty(
  $$select * from public.payments where business_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid$$,
  'brand-new business returns empty payments (BIZ-03-empty-payments)');

select is_empty(
  $$select * from public.customers where business_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid$$,
  'brand-new business returns empty customers');

select is_empty(
  $$select * from public.catalog_items where business_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid$$,
  'brand-new business returns empty catalog');

select lives_ok(
  $$insert into public.customers (business_id, name)
    values ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'First Customer')$$,
  'positive control: member of fresh business creates its first customer (D-43 works from zero)');

select * from finish();
rollback;
