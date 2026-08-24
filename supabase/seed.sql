-- Local-stack dev-parity grants (plan 01-13 round 1).
--
-- Root cause: the local stack configures no default table privileges
-- (see 0002_identity_isolation.sql: "local stack grants no table defaults"),
-- while hosted projects ship stock service_role table grants from the
-- platform. Service-keyed tooling (tests/fixtures) therefore hit 42501
-- permission denied locally but not in the cloud.
--
-- Seeds apply ONLY to local stacks (`supabase db reset`) — they are NEVER
-- part of `supabase db push`, so the production/linked-project posture is
-- unchanged. This mirrors the hosted default for service_role rather than
-- weakening anything: app roles keep exactly the explicit grants authored in
-- the migrations.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
