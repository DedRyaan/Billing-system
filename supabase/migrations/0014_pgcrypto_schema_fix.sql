-- Migration 0014: relocate pgcrypto into public (UAT bootstrap fix)
--
-- Root cause (found via live UAT, 2026-08-24): hosted Supabase installs
-- pgcrypto into the `extensions` schema, but the D-01..D-04 setup-code
-- helpers (0009: get/rotate/seed_setup_code_digest) are SECURITY DEFINER
-- with `set search_path = public` — so unqualified digest() raised 42883
-- ("function digest(text, unknown) does not exist") and bootstrap failed
-- with seed_failed.
--
-- ALTER EXTENSION SET SCHEMA moves every pgcrypto object into public,
-- making digest() visible to the definer helpers without touching their
-- byte-exact bodies (0012 discipline: prefer data-side repair over
-- function-body rewrites). No pgcrypto objects existed in public, so the
-- move is conflict-free. gen_random_uuid() callers are unaffected (it
-- also lives in pg_catalog).

alter extension pgcrypto set schema public;
