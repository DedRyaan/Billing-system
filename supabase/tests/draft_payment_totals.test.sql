-- T-05-04 closure (migration 0026): payment totals written onto a draft are
-- discarded, so a bill can never be issued pre-marked as paid.

begin;
set search_path = public, extensions;
select plan(4);

insert into public.businesses (id, legal_name, gstin, number_format, prefix) values
  ('dddddd26-0000-0000-0000-000000000001', 'Draft Totals Co', '29DRAFT0000A1Z9', 'seq', null);

insert into public.invoices (id, business_id, fy, status, paid_amount, payment_status) values
  ('dddddd26-0000-0000-0000-0000000000a1', 'dddddd26-0000-0000-0000-000000000001', '26-27', 'draft', 999, 'paid');

select is((select paid_amount from public.invoices where id = 'dddddd26-0000-0000-0000-0000000000a1'), 0::numeric(14,2),
  'paid_amount supplied on draft insert is reset to 0');
select is((select payment_status from public.invoices where id = 'dddddd26-0000-0000-0000-0000000000a1'), 'unpaid'::text,
  'payment_status supplied on draft insert is reset to unpaid');

update public.invoices set paid_amount = 500, payment_status = 'partial'
 where id = 'dddddd26-0000-0000-0000-0000000000a1';

select is((select paid_amount from public.invoices where id = 'dddddd26-0000-0000-0000-0000000000a1'), 0::numeric(14,2),
  'paid_amount written by a draft update is reset to 0');
select is((select payment_status from public.invoices where id = 'dddddd26-0000-0000-0000-0000000000a1'), 'unpaid'::text,
  'payment_status written by a draft update is reset to unpaid');

select * from finish();
rollback;
