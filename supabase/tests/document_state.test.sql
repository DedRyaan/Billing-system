-- Document state-machine proof suite: BIZ-03 extension onto invoices/invoice_lines.
--
-- Layering under test:
--   POLICY LAYER   (role-switched `authenticated` blocks) - shared-pool drafts,
--     forged cross-business writes, client mutation denials on issued rows,
--     emptiness controls. Pitfall 1 discipline: every block sets BOTH the role
--     and an explicit jwt sub claim; positive controls guard against
--     null-auth.uid() masking.
--   TRIGGER LAYER  (`reset role` blocks running as definer-equivalent context) -
--     the state machine fires regardless of role (RESEARCH Pattern 5). The jwt
--     sub still drives current_user_role(), so the D-16 pair is proven by
--     switching ONLY the claim between otherwise identical definer-context
--     UPDATEs: staff identity raises, super_admin identity succeeds.
--
-- Seeding happens as superuser BEFORE any role switch. Assertions are
-- count/value-based; negatives use throws_ok with SQLSTATE plus message
-- substrings chosen to be regex-safe.

begin;
set search_path = public, extensions;
select plan(36);

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
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Archived Biz',    '24CCCCC0000C1Z6', now()),  -- D-36 target
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Brand New Biz',   '07DDDDD0000D1Z9', null);   -- emptiness control

insert into public.business_members (business_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'), -- staffA -> A
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222'), -- staffB -> B
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '77777777-7777-7777-7777-777777777777'), -- arch member -> C
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '88888888-8888-8888-8888-888888888888'); -- empty user -> D

-- Issued documents (definer-seeded; clients cannot create issued rows).
-- issued1 proves immutability; issued2 becomes the D-16 void target.
insert into public.invoices
  (id, business_id, fy, status, seq, issued_at, issued_by,
   customer_name, customer_gstin, supply_type, registration_type, total_amount, created_by)
values
  ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '26-27', 'issued', 7, now(),
   '55555555-5555-5555-5555-555555555555', 'Original Buyer Pvt Ltd', '29AAAAA0000A1Z0', 'intra_state', 'regular', 1500.00,
   '55555555-5555-5555-5555-555555555555'),
  ('c0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '26-27', 'issued', 8, now(),
   '55555555-5555-5555-5555-555555555555', 'Second Buyer LLP',       '29AAAAA0000A1Z0', 'inter_state', 'regular', 2400.00,
   '55555555-5555-5555-5555-555555555555');

-- Shared-pool drafts. draft1 belongs to staff-b ON PAPER only - D-41/D-42 say
-- attribution never restricts editing. draft2 is the finalize-simulation
-- target; draftB gives staff-b an own-business write surface.
insert into public.invoices
  (id, business_id, fy, status, customer_name, created_by)
values
  ('c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '26-27', 'draft', 'Draft Buyer', '22222222-2222-2222-2222-222222222222'),
  ('c0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '26-27', 'draft', 'Finalize Me', '11111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-000000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '26-27', 'draft', 'B Draft',     '22222222-2222-2222-2222-222222222222');

insert into public.invoice_lines
  (id, invoice_id, position, description, quantity, unit_price_charged, gst_rate)
values
  ('e0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000002', 0, 'Consulting', 3, 500.00, 18.00);

-- A frozen line on an ISSUED document (the normal post-finalize shape).
insert into public.invoice_lines
  (id, invoice_id, position, description, quantity, unit_price_catalog, unit_price_charged, gst_rate)
values
  ('e0000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000001', 0, 'Frozen item', 1, 1500.00, 1500.00, 18.00);

-- ---------------------------------------------------------------------------
-- Block 1: positive control (Pitfall 1 - emptiness must never mask auth bugs)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$select count(*) from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000002'::uuid$$,
  ARRAY[1::bigint],
  'positive control: staff A DOES see own-business draft (null-auth masking guard)');

-- ---------------------------------------------------------------------------
-- Block 2: shared-pool drafts (D-41/D-42) - staff A edits staff B's draft
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select lives_ok(
  $$update public.invoices set customer_name = 'Renamed By Staff A'
    where id = 'c0000000-0000-0000-0000-000000000002'::uuid$$,
  'staff A edits staff B''s draft header - drafts are a shared pool (D-41/D-42)');

select is(
  $$select customer_name from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000002'::uuid$$,
  'Renamed By Staff A'::text,
  'shared-pool edit actually landed despite different created_by');

select lives_ok(
  $$update public.invoice_lines set quantity = 7
    where id = 'e0000000-0000-0000-0000-000000000001'::uuid$$,
  'staff A edits staff B''s ad-hoc line inside the draft');

select results_eq(
  $$select quantity from public.invoice_lines
    where id = 'e0000000-0000-0000-0000-000000000001'::uuid$$,
  ARRAY[7::numeric],
  'line edit landed (D-45: ad-hoc lines stay staff-writable inside drafts)');

-- ---------------------------------------------------------------------------
-- Block 3: client-layer issued immutability (policy + transition-trigger gate)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$update public.invoices set customer_name = 'Tampered'
    where id = 'c0000000-0000-0000-0000-000000000001'::uuid$$,
  '42501', null,
  'staff UPDATE on issued document dies loudly (42501)');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select throws_ok(
  $$update public.invoices set customer_name = 'Tampered'
    where id = 'c0000000-0000-0000-0000-000000000001'::uuid$$,
  '42501', null,
  'admin UPDATE on issued document ALSO dies loudly (42501) - no role exemption');

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$with gone as (
       delete from public.invoices
       where id = 'c0000000-0000-0000-0000-000000000001'::uuid
       returning 1
     ) select count(*) from gone$$,
  ARRAY[0::bigint],
  'staff DELETE on issued document removes ZERO rows (draft-only deletion)');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select results_eq(
  $$with gone as (
       delete from public.invoices
       where id = 'c0000000-0000-0000-0000-000000000001'::uuid
       returning 1
     ) select count(*) from gone$$,
  ARRAY[0::bigint],
  'admin DELETE on issued document removes ZERO rows too');

select is(
  $$select customer_name || '|' || status::text from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000001'::uuid$$,
  'Original Buyer Pvt Ltd|issued'::text,
  'issued document byte-identical after every client attempt (T-1-09)');

-- Clients cannot flip status out of draft even WITH a stolen-looking number:
-- the UPDATE policy WITH CHECK pins new rows to draft status (42501), and the
-- finalize path owns allocation exclusively.
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$update public.invoices set status = 'issued', seq = 99
    where id = 'c0000000-0000-0000-0000-000000000002'::uuid$$,
  '42501', null,
  'client self-issue attempt (forged seq) rejected at policy layer');

select throws_ok(
  $$update public.invoices set status = 'voided'
    where id = 'c0000000-0000-0000-0000-000000000002'::uuid$$,
  '42501', null,
  'client draft-to-voided shortcut rejected at policy layer');

-- ---------------------------------------------------------------------------
-- Block 4: isolation negatives + positive control (staff B vs business A)
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is_empty(
  $$select * from public.invoices where business_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid$$,
  'staff B sees ZERO invoices from business A (BIZ-03)');

select throws_ok(
  $$insert into public.invoices (business_id, fy, customer_name)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '26-27', 'forge')$$,
  '42501', null,
  'staff B cannot forge a document into business A');

select throws_ok(
  $$insert into public.invoice_lines (invoice_id, description, unit_price_charged, gst_rate)
    values ('c0000000-0000-0000-0000-000000000002'::uuid, 'forge', 100.00, 18.00)$$,
  '42501', null,
  'staff B cannot attach a line to business A''s draft');

select lives_ok(
  $$insert into public.invoices (business_id, fy, customer_name)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '26-27', 'Own Business Draft')$$,
  'positive control: staff B creates a draft in OWN business B');

select lives_ok(
  $$insert into public.invoice_lines (invoice_id, description, unit_price_charged, gst_rate)
    values ('c0000000-0000-0000-0000-000000000005'::uuid, 'Own line', 200.00, 18.00)$$,
  'positive control: staff B attaches a line to own-business draft');

-- ---------------------------------------------------------------------------
-- Block 5: archived business (D-36) - no new bills, data stays readable
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';

select throws_ok(
  $$insert into public.invoices (business_id, fy, customer_name)
    values ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, '26-27', 'Too Late')$$,
  'P0001', 'archived businesses',
  'INSERT into an archived business raises the D-36 exception (trg_archive_guard)');

select results_eq(
  $$select count(*) from public.businesses
    where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid$$,
  ARRAY[1::bigint],
  'archived business remains readable to its members (D-36 reports-stay-readable half)');

-- ---------------------------------------------------------------------------
-- Block 6: emptiness control - brand-new business, zero documents
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888888';

select is_empty(
  $$select * from public.invoices where business_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid$$,
  'brand-new business returns an empty invoice set to its member (BIZ-03-empty-docs)');

-- ---------------------------------------------------------------------------
-- Block 7: trigger-layer state machine (definer-equivalent contexts).
-- Runs as superuser (bypasses RLS like Plan 04's SECURITY DEFINER maintainer);
-- jwt sub still drives current_user_role() for the D-16 decision.
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claim.sub = '';

-- Carve-out negative control: same-status issued edit touching a NON-registry
-- column raises even in definer context - registry confinement is real.
select throws_ok(
  $$update public.invoices set customer_name = 'Definer Tamper'
    where id = 'c0000000-0000-0000-0000-000000000001'::uuid$$,
  'P0001', 'immutable',
  'definer-context field edit on issued document raises (carve-out confined to registry columns)');

select throws_ok(
  $$update public.invoices set status = 'issued'
    where id = 'c0000000-0000-0000-0000-000000000003'::uuid$$,
  'P0001', 'allocated sequence number',
  'draft-to-issued without seq rejected - finalize owns allocation');

-- Positive finalize shape: allocated number present -> transition allowed.
select lives_ok(
  $$update public.invoices
     set status = 'issued', seq = 42, issued_at = now(),
         issued_by = '55555555-5555-5555-5555-555555555555'::uuid
   where id = 'c0000000-0000-0000-0000-000000000003'::uuid$$,
  'finalize-shaped issuance (seq allocated) succeeds');

select is(
  $$select status::text from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000003'::uuid$$,
  'issued'::text,
  'draft became issued through the sanctioned path');

-- D-16 PAIR: identical transition, only the identity differs.
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; -- staff A

select throws_ok(
  $$update public.invoices set status = 'voided'
    where id = 'c0000000-0000-0000-0000-000000000004'::uuid$$,
  'P0001', 'restricted to admins',
  'staff attempting issued-to-voided hits the D-16 exception');

set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666'; -- super admin

select lives_ok(
  $$update public.invoices
     set status = 'voided', voided_at = now(),
         voided_by = '66666666-6666-6666-6666-666666666666'::uuid,
         void_reason = 'duplicate issue'
   where id = 'c0000000-0000-0000-0000-000000000004'::uuid$$,
  'super_admin performs the identical void successfully (D-16 other half)');

select is(
  $$select status::text from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000004'::uuid$$,
  'voided'::text,
  'document landed in voided state');

-- Voided documents are frozen in every direction, every context.
set local request.jwt.claim.sub = '';

select throws_ok(
  $$update public.invoices set void_reason = 'second thoughts'
    where id = 'c0000000-0000-0000-0000-000000000004'::uuid$$,
  'P0001', 'frozen',
  'UPDATE on voided document raises - terminal state, no further transitions');

select throws_ok(
  $$delete from public.invoices
    where id = 'c0000000-0000-0000-0000-000000000004'::uuid$$,
  '42501', 'only draft documents may be deleted',
  'DELETE of voided document raises even in definer context (GST retention)');

select throws_ok(
  $$delete from public.invoice_lines
    where id = 'e0000000-0000-0000-0000-000000000002'::uuid$$,
  '42501', 'permanent',
  'lines of an issued document cannot be shed (trg_line_delete_guard)');

-- Client-side mirror: the DELETE policy filters issued-parent lines entirely.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$with gone as (
       delete from public.invoice_lines
       where id = 'e0000000-0000-0000-0000-000000000002'::uuid
       returning 1
     ) select count(*) from gone$$,
  ARRAY[0::bigint],
  'client DELETE of an issued document''s line removes ZERO rows');

-- ---------------------------------------------------------------------------
-- Block 8: staff discount guards (D-46/D-47) - binding staff, exempting admins
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$insert into public.invoice_lines
      (invoice_id, description, unit_price_catalog, unit_price_charged, discount_pct, gst_rate)
    values ('c0000000-0000-0000-0000-000000000002'::uuid, 'Big Discount',
            100.00, 45.00, 51.00, 18.00)$$,
  'P0001', '50 percent',
  'staff line with discount_pct 51 raises the D-47 cap exception');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select lives_ok(
  $$insert into public.invoice_lines
      (invoice_id, description, unit_price_catalog, unit_price_charged, discount_pct, gst_rate)
    values ('c0000000-0000-0000-0000-000000000002'::uuid, 'Admin Discount',
            100.00, 45.00, 51.00, 18.00)$$,
  'admin performs the identical 51-percent line - admins are exempt (D-47)');

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$insert into public.invoice_lines
      (invoice_id, description, unit_price_catalog, unit_price_charged, discount_pct, gst_rate)
    values ('c0000000-0000-0000-0000-000000000002'::uuid, 'Markup',
            100.00, 120.00, 0.00, 18.00)$$,
  'P0001', 'catalog price',
  'staff charging ABOVE catalog price raises the D-46 downward-only exception');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select lives_ok(
  $$insert into public.invoice_lines
      (invoice_id, description, unit_price_catalog, unit_price_charged, discount_pct, gst_rate)
    values ('c0000000-0000-0000-0000-000000000002'::uuid, 'Admin Markup',
            100.00, 120.00, 0.00, 18.00)$$,
  'admin marks up above catalog freely - they own the catalog (D-46)');

-- DISCOUNT-zero-lines edge: zero-discount ad-hoc line (catalog NULL) passes
-- the staff guard untouched.
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select lives_ok(
  $$insert into public.invoice_lines
      (invoice_id, description, unit_price_charged, gst_rate)
    values ('c0000000-0000-0000-0000-000000000002'::uuid, 'Ad-hoc zero discount',
            75.00, 18.00)$$,
  'staff ad-hoc line with 0 discount and NULL catalog price passes unchanged');

select * from finish();
rollback;
