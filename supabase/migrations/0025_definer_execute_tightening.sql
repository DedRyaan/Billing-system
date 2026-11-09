-- Migration 0025: tighten EXECUTE on SECURITY DEFINER helpers flagged by the
-- Supabase security advisor (lint 0028/0029). Additive-only.
--
-- can_access_business() / current_user_role():
--   RLS helpers. Every policy that calls them is TO authenticated (verified
--   against pg_policies on the linked project), so anon never needs them.
--   They were still reachable as /rest/v1/rpc/* for anon via the default
--   PUBLIC grant. Keep authenticated (policy evaluation) and service_role
--   (triggers fired from Edge Function transactions call current_user_role).
--
-- enforce_archive_guard() / enforce_line_deletion_rules() / enforce_prefix_lock():
--   Trigger functions. PostgreSQL checks EXECUTE only at CREATE TRIGGER time,
--   never when a trigger fires, so revoking from every API role changes no
--   behaviour — it only removes them from the RPC surface (same posture as
--   guard_profile_privileged_columns / block_mutation since Phase 1).
--
-- Accepted, intentionally left callable:
--   health_check()            anon keep-alive target (D-39)
--   other authenticated RPCs  self-gating admin/lifecycle RPCs (role checks
--                             inside the function body, Phase 1 governance)

REVOKE EXECUTE ON FUNCTION public.can_access_business(uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.can_access_business(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.enforce_archive_guard() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_line_deletion_rules() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_prefix_lock() FROM public, anon, authenticated;
