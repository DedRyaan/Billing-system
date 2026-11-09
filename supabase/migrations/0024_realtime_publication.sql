-- Migration 0024: realtime publication membership (live multi-device sync)
--
-- Supabase Realtime only streams postgres_changes for tables that belong to
-- the `supabase_realtime` publication. No earlier migration added any table,
-- so every client subscription (businesses/customers/catalog_items since
-- Phase 3, invoices/payments from this change) silently received nothing:
-- co-owners and staff on other devices only saw changes after a refetch.
--
-- Security: Realtime evaluates the subscriber's RLS SELECT policies before
-- delivering a change, so publishing these tables exposes nothing a member
-- could not already read. Clients additionally filter business_id=eq.<id>.
--
-- Idempotent: tables already added by hand in the dashboard are skipped, and
-- the publication is created if a bare Postgres lacks it.

DO $$
DECLARE
  v_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH v_table IN ARRAY ARRAY['businesses', 'customers', 'catalog_items', 'invoices', 'payments'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;
