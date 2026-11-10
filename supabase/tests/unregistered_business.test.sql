-- 0028: businesses without a GSTIN.
begin;
select plan(5);

insert into public.businesses (legal_name, gstin, registration_type, state)
values ('No GST Traders', null, 'unregistered', '27');
select pass('an unregistered business can be created without a GSTIN');

select throws_ok(
  $$insert into public.businesses (legal_name, gstin, registration_type, state)
    values ('Missing GSTIN', null, 'regular', '27')$$,
  '23514', null,
  'a regular business still needs a GSTIN'
);

select throws_ok(
  $$insert into public.businesses (legal_name, gstin, registration_type, state)
    values ('Contradiction', '27AAPFU0939F1ZV', 'unregistered', '27')$$,
  '23514', null,
  'an unregistered business cannot carry a GSTIN'
);

select lives_ok(
  $$insert into public.businesses (legal_name, gstin, registration_type, state)
    values ('Second No GST', null, 'unregistered', '29')$$,
  'two unregistered businesses do not collide on the GSTIN unique constraint'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'invoices_registration_type_check'
      and pg_get_constraintdef(oid) like '%unregistered%'
  ),
  'invoices accept the unregistered registration type'
);

select * from finish();
rollback;
