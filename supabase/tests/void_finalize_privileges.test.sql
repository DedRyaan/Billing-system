-- F-12 privilege posture for the invoice lifecycle SECURITY DEFINER functions
-- (migration 0023). Both take a caller-supplied p_caller_id, so they must be
-- reachable ONLY through the Edge Functions (service_role) — never via
-- PostgREST RPC from anon/authenticated clients, including through the
-- default PUBLIC execute grant.

begin;
set search_path = public, extensions;
select plan(6);

select ok(
  not has_function_privilege('anon', 'public.void_invoice_fn(uuid, uuid, uuid, text)', 'execute'),
  'anon cannot execute void_invoice_fn'
);
select ok(
  not has_function_privilege('authenticated', 'public.void_invoice_fn(uuid, uuid, uuid, text)', 'execute'),
  'authenticated cannot execute void_invoice_fn'
);
select ok(
  has_function_privilege('service_role', 'public.void_invoice_fn(uuid, uuid, uuid, text)', 'execute'),
  'service_role can execute void_invoice_fn'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_invoice_fn(uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb)', 'execute'),
  'anon cannot execute finalize_invoice_fn'
);
select ok(
  not has_function_privilege('authenticated', 'public.finalize_invoice_fn(uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb)', 'execute'),
  'authenticated cannot execute finalize_invoice_fn'
);
select ok(
  has_function_privilege('service_role', 'public.finalize_invoice_fn(uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb)', 'execute'),
  'service_role can execute finalize_invoice_fn'
);

select * from finish();
rollback;
