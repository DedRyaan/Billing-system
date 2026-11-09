-- F-12 privilege posture for the invoice lifecycle SECURITY DEFINER functions
-- (migration 0023). Both take a caller-supplied p_caller_id, so they must be
-- reachable ONLY through the Edge Functions (service_role) — never via
-- PostgREST RPC from anon/authenticated clients, including through the
-- default PUBLIC execute grant.

begin;
set search_path = public, extensions;
select plan(12);

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

-- Migration 0025: advisor-flagged helpers.
select ok(not has_function_privilege('anon', 'public.can_access_business(uuid)', 'execute'), 'anon cannot execute can_access_business');
select ok(has_function_privilege('authenticated', 'public.can_access_business(uuid)', 'execute'), 'authenticated keeps can_access_business for RLS');
select ok(not has_function_privilege('anon', 'public.current_user_role()', 'execute'), 'anon cannot execute current_user_role');
select ok(has_function_privilege('service_role', 'public.current_user_role()', 'execute'), 'service_role keeps current_user_role for triggers');
select ok(not has_function_privilege('authenticated', 'public.enforce_prefix_lock()', 'execute'), 'trigger function enforce_prefix_lock is off the RPC surface');
select ok(not has_function_privilege('anon', 'public.enforce_archive_guard()', 'execute'), 'trigger function enforce_archive_guard is off the RPC surface');

select * from finish();
rollback;
