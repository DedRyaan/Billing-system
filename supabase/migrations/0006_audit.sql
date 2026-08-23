-- Migration 0006: universal append-only audit trail + keep-alive health probe (Plan 05)
--
-- The trust model rests on nobody being able to rewrite history (D-25 one-way
-- door): audit history is immutable to EVERY application role — staff, admin,
-- super_admin, even service_role — through two independent gates:
--   grants layer   UPDATE/DELETE/TRUNCATE/INSERT revoked from anon,
--                  authenticated AND service_role; only SELECT reaches
--                  authenticated, and only through the admins-only policy
--   trigger layer  statement-level BEFORE guards raise unconditionally,
--                  regardless of role or row visibility — the second gate if a
--                  future migration ever re-grants mutation privileges
--
-- Capture is trigger-based, never app-level (RESEARCH "Don't Hand-Roll"):
-- triggers cannot be forgotten by a future feature the way application logging
-- can, and same-transaction capture gives atomicity free. Generic
-- audit_row_change() attaches AFTER INSERT OR UPDATE OR DELETE to every
-- business-data and identity table (document events + permission events,
-- D-23), storing BEFORE/AFTER values as to_jsonb(OLD)/to_jsonb(NEW) (D-26).
--
-- Locked decisions baked in here:
--   D-23       document events AND access/permission events captured; read/
--              view telemetry deliberately NOT (login-attempt auditing lands
--              with Plan 07's auth wrapper)
--   D-24       retention forever — NO purge, rotation or trim path exists or
--              may ever be added in this schema; log stays small at this scale
--   D-25       append-only against everyone incl. super admin (trigger layer)
--   D-26       actor/action/target/timestamp + BEFORE/AFTER jsonb payloads
--   D-27       visibility admins + super_admin only; staff see nothing;
--              exactly ONE policy on the table (SELECT-only)
--   AUDIT-service-actor (edge assumption): actor_id NULL + actor_type 'system'
--              denotes migration/service contexts — write_audit discriminates
--
-- Honest caveat (RESEARCH Pattern 5 / T-1-19 residual, accepted): a true
-- Postgres superuser can still ALTER TABLE ... DISABLE TRIGGER and edit.
-- Only migrations touch prod SQL routinely here. Tamper-EVIDENCE (sha256
-- prev_hash/row_hash chain) is DEFERRED to Phase 8 per RESEARCH Open
-- Question 2 — this schema leaves additive room (new columns only); no
-- retro-fit churn needed now.
--
-- Keep-alive (D-39): public.health_check() SECURITY DEFINER returns a
-- constant so the GitHub Actions ping counts as DB activity without tripping
-- RLS 401s (RESEARCH Pattern 8). Plan 10 wires the cron workflow.
--
-- Conventions inherited from Waves 1-3: ENABLE + FORCE row level security,
-- TO authenticated policies, SECURITY DEFINER helpers with fixed
-- search_path = public, EXECUTE revoked from PUBLIC on sensitive functions,
-- NUMERIC(14,2)-safe money elsewhere (no money columns here).

-- ---------------------------------------------------------------------------
-- audit_log — the append-only substrate itself
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,                                   -- auth.uid() where a JWT context exists; NULL = system/service/migration context
  actor_type   text not null default 'user',           -- 'user' | 'system' discriminator (AUDIT-service-actor)
  action       text not null,                          -- dot-namespaced: invoice.update, auth.login_failed, profile.role_changed ...
  target_table text,
  target_id    text,                                   -- uuid-as-text: generic across id shapes (composite keys NULL)
  business_id  uuid,                                   -- denormalized from NEW/OLD for scoped admin reads (Phase 8 viewer)
  before_val   jsonb,                                  -- to_jsonb(OLD) on UPDATE/DELETE; NULL on INSERT
  after_val    jsonb                                   -- to_jsonb(NEW) on INSERT/UPDATE; NULL on DELETE
);

-- Hash-chain room reserved (Phase 8 deferral): additive columns such as
-- prev_hash bytea / row_hash bytea may be appended by a LATER migration —
-- nothing about immutability changes then, and no purge path may be added
-- ever (D-24).

-- ---------------------------------------------------------------------------
-- block_mutation() — Gate 2: unconditional raise, fires REGARDLESS of role
-- (service_role included) as long as triggers are enabled. Statement-level
-- attachment is deliberate (same Postgres semantics class as Plan 04's
-- discovery): with no UPDATE/DELETE policies under FORCE RLS, rows are
-- invisible to clients and row-level triggers would never fire for them —
-- a grant-drift regression would otherwise degrade to SILENT zero-row
-- "successes" instead of loud failures.
-- ---------------------------------------------------------------------------

create or replace function public.block_mutation() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% on % is append-only (D-25)', TG_OP, TG_TABLE_NAME;
end;
$$;

create trigger audit_no_update
  before update on public.audit_log
  for each statement
execute function public.block_mutation();

create trigger audit_no_delete
  before delete on public.audit_log
  for each statement
execute function public.block_mutation();

create trigger audit_no_truncate
  before truncate on public.audit_log
  for each statement
execute function public.block_mutation();

-- ---------------------------------------------------------------------------
-- Grants layer (Gate 1): SELECT reaches authenticated only (the single policy
-- below still scopes rows to admins); every mutation privilege revoked from
-- every application-facing role INCLUDING service_role. Anon gets nothing at
-- all. Revokes on unheld privileges are deliberate no-ops that pin intent.
-- ---------------------------------------------------------------------------

grant select on public.audit_log to authenticated;

revoke insert, update, delete, truncate on public.audit_log from anon;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
revoke insert, update, delete, truncate on public.audit_log from service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security — ENABLE + FORCE. EXACTLY ONE policy exists: SELECT-only,
-- TO authenticated, keyed on effective role (server-controlled profiles.role
-- via current_user_role(), never JWT metadata). Admins/super_admin see all
-- entries (their scope is all businesses per D-11/D-12); staff match no rows.
-- There is deliberately NO insert/update/delete policy: under FORCE RLS the
-- absence denies those operations for every role — client INSERTs fail closed
-- (42501 new-row-violates-policy). Appends happen exclusively through
-- SECURITY DEFINER writers, which bypass RLS as the superuser migration owner.
-- ---------------------------------------------------------------------------

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

create policy "audit admins-read" on public.audit_log
  for select to authenticated
  using ((select public.current_user_role()) in ('admin', 'super_admin'));

-- ---------------------------------------------------------------------------
-- write_audit() — the ONLY sanctioned append path. SECURITY DEFINER with
-- fixed search_path: bypasses FORCE RLS on audit_log (definer owner runs as
-- the migration superuser) while the admins-only SELECT policy stays intact
-- for ordinary readers. Actor attribution reads the caller's JWT claims via
-- auth.uid() — claim settings survive the definer switch, so trigger-driven
-- captures attribute the REAL acting user. No JWT context (migrations,
-- service jobs) resolves auth.uid() to NULL and stores actor_type 'system'.
--
-- EXECUTE hygiene: revoked from PUBLIC/anon/authenticated so clients can
-- never forge arbitrary audit entries directly; granted to service_role for
-- Plan 07's Edge Function audit writes (auth.login_failed / lockout events).
-- Trigger functions call it inside SECURITY DEFINER contexts (owner scope),
-- so revocation never blocks legitimate capture.
-- ---------------------------------------------------------------------------

create or replace function public.write_audit(
  p_action       text,
  p_target_table text,
  p_target_id    text,
  p_business_id  uuid,
  p_before       jsonb,
  p_after        jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log
    (actor_id, actor_type, action, target_table, target_id, business_id, before_val, after_val)
  values
    ((select auth.uid()),
     case when (select auth.uid()) is null then 'system' else 'user' end,
     p_action, p_target_table, p_target_id, p_business_id, p_before, p_after);
end;
$$;

revoke execute on function public.write_audit(text, text, text, uuid, jsonb, jsonb)
  from public;
revoke execute on function public.write_audit(text, text, text, uuid, jsonb, jsonb)
  from anon;
revoke execute on function public.write_audit(text, text, text, uuid, jsonb, jsonb)
  from authenticated;
grant execute on function public.write_audit(text, text, text, uuid, jsonb, jsonb)
  to service_role;

revoke execute on function public.block_mutation()
  from public;
revoke execute on function public.block_mutation()
  from anon;
revoke execute on function public.block_mutation()
  from authenticated;

-- ---------------------------------------------------------------------------
-- health_check() — free-tier keep-alive target (D-39 / RESEARCH Pattern 8).
-- A raw REST SELECT can 401 under strict RLS; this SECURITY DEFINER RPC
-- returns a constant through PostgREST with the anon key, touching zero
-- tenant data. Plan 10's .github/workflows/keep-alive.yml curls it daily.
-- EXECUTE explicitly granted to anon + authenticated (+service_role) because
-- the whole point is unauthenticated-cheap liveness.
-- ---------------------------------------------------------------------------

create or replace function public.health_check() returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'ok'::text
$$;

revoke execute on function public.health_check()
  from public;
grant execute on function public.health_check()
  to anon, authenticated, service_role;
