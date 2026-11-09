-- Live sync prerequisite (migration 0024): every table the desktop app
-- subscribes to must be a member of the supabase_realtime publication,
-- otherwise postgres_changes subscriptions receive nothing.

begin;
set search_path = public, extensions;
select plan(5);

select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'businesses'), 'businesses is published for realtime');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customers'), 'customers is published for realtime');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'catalog_items'), 'catalog_items is published for realtime');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoices'), 'invoices is published for realtime');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments'), 'payments is published for realtime');

select * from finish();
rollback;
