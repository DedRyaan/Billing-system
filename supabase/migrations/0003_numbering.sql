-- Migration 0003: legal document numbering — locked-counter allocator
--
-- Roadmap SC-4: requesting numbers yields 1, 2, 3… consecutively per business
-- per FY per series — gapless and duplicate-free even under concurrent callers,
-- and a transaction that allocates then ROLLBACKs burns nothing (the number is
-- handed out again on the next attempt).
--
-- Postgres SEQUENCE objects are PROHIBITED for legal series: they are
-- non-transactional and burn numbers on rollback (PITFALLS.md Pitfall 2 /
-- RESEARCH Pattern 4). No sequence object may ever back a document series here.
--
-- Locked decisions baked in here:
--   D-30/D-33  three number templates rendered by format_document_number(),
--              sequence zero-padded to 4 digits at render time only
--   D-16       voided numbers stay consumed — the counter only increments;
--              reissue draws the next fresh number (Phase 4 void flow)
--   D-32       business prefix/number_format lock at first issue of each FY
--              (trigger trg_prefix_lock below)
--   D-34       invoice / estimate / credit_note count independently per scope
--
-- Conventions inherited from Wave 1: FORCE row level security, application
-- roles denied by default, SECURITY DEFINER functions with fixed search_path.

-- ---------------------------------------------------------------------------
-- Counter table — API-invisible under FORCE RLS default-deny (no policies).
-- Allocation happens ONLY inside the SECURITY DEFINER allocator (T-1-06);
-- counter rows carry no grants to application roles, so silent manual edits
-- are unreachable from the API surface (T-1-07). Only migrations touch them.
-- ---------------------------------------------------------------------------

create table public.invoice_counters (
  business_id   uuid not null references public.businesses(id) on delete cascade,
  fy            text not null, -- label only ('26-27'); FY derivation logic is Phase 2's pure engine
  series_type   text not null default 'invoice'
                check (series_type in ('invoice', 'estimate', 'credit_note')), -- D-34 independent series
  last_number   integer not null default 0,
  prefix_locked text,          -- copied from businesses.prefix at first issue of the scope (D-32)
  primary key (business_id, fy, series_type)
);

alter table public.invoice_counters enable row level security;
alter table public.invoice_counters force row level security;

-- Belt-and-braces with T-1-07: application roles hold no table privileges at
-- all. FORCE RLS would already filter every row for them; revoking privileges
-- turns any stray client query into a loud permission error instead.
revoke all on public.invoice_counters from anon;
revoke all on public.invoice_counters from authenticated;

-- ---------------------------------------------------------------------------
-- Gapless allocator (RESEARCH Pattern 4): update-first + insert-on-conflict.
--
-- The single UPDATE takes an implicit row lock held to commit/rollback, so
-- concurrent callers serialize per (business, fy, series) scope while different
-- scopes never contend. First-of-scope creation rides ON CONFLICT DO UPDATE so
-- concurrent bootstrap attempts cannot double-create or lose an increment.
--
-- D-32 first-issue copy: when v_num becomes 1 the business's current prefix is
-- frozen into prefix_locked. v_num = 1 happens exactly once per scope (the row
-- lock serializes contenders), so the freeze is deterministic.
--
-- SECURITY DEFINER + fixed search_path (Phase-1 convention). EXECUTE revoked
-- from anon/authenticated/public — production callers are definer-side finalize
-- code (Phase 4) reaching it via service_role. Direct allocation from clients
-- would let them mint or burn legal numbers (T-1-06).
-- ---------------------------------------------------------------------------

create or replace function public.allocate_next_number(
  p_business_id uuid,
  p_fy          text,
  p_series      text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num integer;
begin
  update public.invoice_counters
     set last_number = last_number + 1
   where business_id = p_business_id
     and fy          = p_fy
     and series_type = p_series
  returning last_number into v_num;

  if v_num is null then
    insert into public.invoice_counters as c
      (business_id, fy, series_type, last_number)
    values
      (p_business_id, p_fy, p_series, 1)
    on conflict (business_id, fy, series_type)
    do update set last_number = c.last_number + 1
    returning last_number into v_num;
  end if;

  if v_num = 1 then
    update public.invoice_counters
       set prefix_locked = (
             select b.prefix from public.businesses b where b.id = p_business_id
           )
     where business_id = p_business_id
       and fy          = p_fy
       and series_type = p_series;
  end if;

  return v_num;
end;
$$;

revoke execute on function public.allocate_next_number(uuid, text, text) from public;
revoke execute on function public.allocate_next_number(uuid, text, text) from anon;
revoke execute on function public.allocate_next_number(uuid, text, text) from authenticated;
grant  execute on function public.allocate_next_number(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Document-number formatter (D-30 templates, D-33 padding discretion).
--
-- Renders the number for the CURRENT state of a scope (last issued seq) using
-- the LOCKED prefix when one exists, falling back to the live prefix before
-- first issue. Sequence is presentation-only: integers stored, lpad-4 at render.
--
-- SECURITY DEFINER so definer-side code can render numbers without holding
-- privileges on invoice_counters; EXECUTE is likewise restricted to
-- service_role — letting any authenticated caller format arbitrary business ids
-- would leak other tenants' prefixes/formats across the isolation boundary.
-- ---------------------------------------------------------------------------

create or replace function public.format_document_number(
  p_business_id uuid,
  p_fy          text,
  p_series      text
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_format text;
  v_prefix text;
  v_last   integer;
begin
  select b.number_format, coalesce(c.prefix_locked, b.prefix), c.last_number
    into v_format, v_prefix, v_last
    from public.businesses b
    left join public.invoice_counters c
      on c.business_id = b.id
     and c.fy          = p_fy
     and c.series_type = p_series
   where b.id = p_business_id;

  if v_format is null then
    raise exception 'business % not found', p_business_id;
  end if;

  if coalesce(v_last, 0) < 1 then
    raise exception 'no number issued yet for business % in FY % series %', p_business_id, p_fy, p_series;
  end if;

  if v_format <> 'seq' and coalesce(v_prefix, '') = '' then
    raise exception 'business % has no prefix but number_format % requires one', p_business_id, v_format;
  end if;

  case v_format
    when 'prefix_fy_seq' then                                 -- {PREFIX}/{FY}/{SEQ}
      return v_prefix || '/' || p_fy || '/' || lpad(v_last::text, 4, '0');
    when 'prefix_seq' then                                    -- {PREFIX}-{SEQ}
      return v_prefix || '-' || lpad(v_last::text, 4, '0');
    when 'seq' then                                           -- bare {SEQ}
      return lpad(v_last::text, 4, '0');
    else
      raise exception 'unknown number_format % for business %', v_format, p_business_id;
  end case;
end;
$$;

revoke execute on function public.format_document_number(uuid, text, text) from public;
revoke execute on function public.format_document_number(uuid, text, text) from anon;
revoke execute on function public.format_document_number(uuid, text, text) from authenticated;
grant  execute on function public.format_document_number(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- D-32 prefix lock trigger on businesses.
--
-- Once the CURRENT-FY counter has issued at least one number (last_number > 0),
-- neither prefix nor number_format may change until the next April; edits stay
-- free while the counter is zero. FY membership is a calendar-date question in
-- IST (PITFALLS.md Pitfall 4): derive the label from today in Asia/Kolkata.
-- This inline derivation is Phase-1 scaffolding — Phase 2 owns the shared pure
-- FY engine and this trigger should consume it then.
--
-- SECURITY DEFINER is REQUIRED: authenticated businesses-updaters hold no
-- privileges on invoice_counters, so a plain invoker-rights exists() subquery
-- would silently see zero rows and never fire — the lock would be decorative.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_prefix_lock() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'Asia/Kolkata')::date;
  v_fy_start   int  := case
                       when extract(month from v_today) >= 4
                         then extract(year from v_today)::int
                         else extract(year from v_today)::int - 1
                     end;
  v_current_fy text := right(v_fy_start::text, 2) || '-' || right((v_fy_start + 1)::text, 2);
begin
  if (old.prefix is distinct from new.prefix
      or old.number_format is distinct from new.number_format)
     and exists (
       select 1
         from public.invoice_counters
        where business_id = new.id
          and fy          = v_current_fy
          and last_number > 0    -- D-32: locks at FIRST ISSUE; free while zero
     ) then
    raise exception 'numbering identity is locked for FY % once numbers have been issued (D-32)', v_current_fy;
  end if;

  return new;
end;
$$;

create trigger trg_prefix_lock
  before update on public.businesses
  for each row
  execute function public.enforce_prefix_lock();
