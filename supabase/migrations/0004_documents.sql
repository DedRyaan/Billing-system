-- Migration 0004: invoice document substrate — legal guarantees frozen at schema layer
--
-- The invoice is a point-in-time LEGAL SNAPSHOT (PITFALLS.md Pitfall 8): buyer
-- identity, prices, discounts and tax splits freeze onto the document and are
-- never recomputed from mutable reference data. Issued documents are immutable
-- through every application-reachable path; corrections are void-and-reissue.
--
-- Locked decisions baked in here:
--   D-16       issued -> voided transition restricted to admins/super_admin,
--              enforced by trg_document_transition regardless of client code;
--              void flow itself lands in Phase 4
--   D-22/D-19  created_by / issued_by / voided_by reference profiles, whose rows
--              are never hard-deleted — attribution survives deactivation
--   D-36       no new documents against an archived business (trg_archive_guard);
--              payments stay exempt by design (asymmetry lands in Plan 04)
--   D-41/D-42  drafts are a shared pool: every business member sees and edits
--              every draft — no author restriction in any predicate
--   D-45       unit_price_catalog NULL marks ad-hoc custom-priced lines
--   D-46/D-47  staff discount downward-only vs catalog price, 50% per-line cap,
--              binding staff only (admins own the catalog) — trg_staff_discount_guard
--   D-48       catalog price AND discount stored as separate columns so audits
--              see the original price
--
-- SYSTEM-MAINTENANCE CARVE-OUT (Plan 04 contract): trg_document_transition
-- passes a same-status issued-row UPDATE through UNCHANGED when every changed
-- column falls inside the static registry {paid_amount, payment_status}. That
-- path exists exclusively for Plan 04's SECURITY DEFINER totals maintainer
-- (migration-owner context bypasses RLS but still fires this trigger). Clients
-- can never reach it: their UPDATEs die at RLS/trigger with 42501 first. The
-- registry names future columns so Plan 04 needs no amendment here.
--
-- Conventions inherited from Waves 1-2: FORCE row level security everywhere,
-- TO authenticated policies, SECURITY DEFINER helpers with fixed search_path,
-- integer-paise-safe NUMERIC(14,2) money.

-- ---------------------------------------------------------------------------
-- Document status machine: DRAFT -> ISSUED -> VOIDED (terminal)
-- ---------------------------------------------------------------------------

create type public.invoice_status as enum ('draft', 'issued', 'voided');

-- ---------------------------------------------------------------------------
-- Invoices — header carries the frozen buyer snapshot (Pitfall 8) and the
-- money/tax totals stamped at finalize (Phase 4). seq stays NULL until the
-- finalize path allocates it via allocate_next_number(); a client-visible
-- number exists ONLY on issued rows.
-- ---------------------------------------------------------------------------

create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id), -- D-49 tenant key, non-null (BIZ-03); NO ACTION keeps legal documents alive if a delete is ever attempted
  fy                 text not null,                       -- '26-27' label; derivation is Phase 2's pure engine
  status             public.invoice_status not null default 'draft',
  seq                integer,                             -- populated only at issue by Phase 4 finalize via allocate_next_number()
  issued_at          timestamptz,
  issued_by          uuid references public.profiles(id),
  voided_at          timestamptz,
  voided_by          uuid references public.profiles(id),
  void_reason        text,
  -- Buyer snapshot AS OF issue (Pitfall 8 freeze-at-issue; populated at finalize)
  customer_name      text,
  customer_gstin     text,
  customer_address   jsonb,
  supply_type        text check (supply_type in ('intra_state', 'inter_state')),
  reverse_charge     boolean not null default false,
  registration_type  text check (registration_type in ('regular', 'composition')), -- mirrored from business at issue
  -- Frozen money totals (integer-paise-safe NUMERIC per CLAUDE.md); filled at finalize
  subtotal_amount    numeric(14,2) not null default 0,
  tax_amount         numeric(14,2) not null default 0,
  total_amount       numeric(14,2) not null default 0,
  round_off_amount   numeric(14,2) not null default 0,
  -- Credit-note stub carried from Phase 1 per STATE decision (Phase 8+ wires flow)
  credit_note_of       uuid,
  credit_note_issued_at timestamptz,
  created_by         uuid references public.profiles(id), -- D-22: orphaned-draft attribution survives deactivation
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Pitfall 2 backstop: any allocator bug becomes a loud 23505 instead of a
-- silent duplicate legal number. Partial because drafts hold seq NULL until
-- finalize allocates it.
create unique index invoices_business_fy_seq_backstop
  on public.invoices (business_id, fy, seq)
  where seq is not null;

-- ---------------------------------------------------------------------------
-- Invoice lines — catalog-vs-charged price split (D-48): unit_price_catalog
-- preserves the original menu price for audit while unit_price_charged records
-- what was actually billed; discount_pct sits beside them, never folded into
-- either. Tax splits are snapshot fields filled at finalize.
-- ---------------------------------------------------------------------------

create table public.invoice_lines (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references public.invoices(id) on delete cascade,
  position            integer not null default 0,
  description         text not null,
  hsn_sac             text,
  quantity            numeric(12,3) not null default 1,
  unit_price_catalog  numeric(14,2),           -- NULL marks ad-hoc custom-priced lines (D-45)
  unit_price_charged  numeric(14,2) not null,
  discount_pct        numeric(5,2) not null default 0,  -- stored SEPARATELY from catalog price (D-48)
  gst_rate            numeric(5,2) not null,
  taxable_value       numeric(14,2) not null default 0,
  cgst_amount         numeric(14,2) not null default 0,
  sgst_amount         numeric(14,2) not null default 0,
  igst_amount         numeric(14,2) not null default 0
);

-- ---------------------------------------------------------------------------
-- Privileges + Row Level Security — ENABLE + FORCE (owner included), policies
-- TO authenticated only. Shared-pool predicates carry NO author restriction
-- anywhere (D-41/D-42).
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.invoices to authenticated;
grant select, insert, update, delete on public.invoice_lines to authenticated;

alter table public.invoices enable row level security;
alter table public.invoices force row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_lines force row level security;

-- invoices ------------------------------------------------------------------

create policy "invoices members-read" on public.invoices
  for select to authenticated
  using ((select public.can_access_business(business_id)));

-- Members create documents only in draft status; issuance happens exclusively
-- through the definer-side finalize path which bypasses RLS entirely.
create policy "invoices members-insert-drafts" on public.invoices
  for insert to authenticated
  with check (
    (select public.can_access_business(business_id))
    and status = 'draft'
  );

-- Visibility is membership-only; the draft-status gate lives in WITH CHECK so
-- non-draft rows reach trg_document_transition, which rejects client mutation
-- loudly (42501) instead of filtering silently. Status can never LEAVE draft
-- through this policy: WITH CHECK requires the new row to still be a draft.
create policy "invoices members-update" on public.invoices
  for update to authenticated
  using ((select public.can_access_business(business_id)))
  with check (
    (select public.can_access_business(business_id))
    and status = 'draft'
  );

-- Deletion allowed only while draft; issued/voided rows are filtered out of
-- every client DELETE, and trg_document_delete_guard backstops even definer
-- contexts (legal documents are permanent once numbered).
create policy "invoices members-delete-drafts-only" on public.invoices
  for delete to authenticated
  using (
    (select public.can_access_business(business_id))
    and status = 'draft'
  );

-- invoice_lines -------------------------------------------------------------
-- Line mutations additionally require the PARENT invoice to be a draft, so
-- ad-hoc lines stay staff-writable inside drafts (D-45) while issued documents
-- freeze completely.

create policy "lines members-read" on public.invoice_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and (select public.can_access_business(i.business_id))
    )
  );

create policy "lines members-insert-parent-draft" on public.invoice_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and (select public.can_access_business(i.business_id))
        and i.status = 'draft'
    )
  );

-- Same shape as invoices update: parent visibility in USING, parent-must-be-
-- draft in WITH CHECK, so mutations of lines on issued parents die loudly at
-- WITH CHECK (42501) rather than vanishing silently.
create policy "lines members-update" on public.invoice_lines
  for update to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and (select public.can_access_business(i.business_id))
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and (select public.can_access_business(i.business_id))
        and i.status = 'draft'
    )
  );

create policy "lines members-delete-parent-draft-only" on public.invoice_lines
  for delete to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id
        and (select public.can_access_business(i.business_id))
        and i.status = 'draft'
    )
  );

-- ---------------------------------------------------------------------------
-- trg_document_transition — BEFORE UPDATE state machine on invoices.
--
-- Fires REGARDLESS of role or code path (RESEARCH Pattern 5 discipline). Order
-- of gates:
--   1. Client-context loud denial: any authenticated caller touching a
--      non-draft row is rejected with 42501 semantics immediately — even if a
--      future migration ever widens the UPDATE policy (defense-in-depth per
--      threat T-1-09). Definer contexts run as other roles and skip this gate.
--   2. System-maintenance carve-out: same-status issued row whose changed-key
--      set is a subset of the static registry passes through untouched — the
--      ONLY sanctioned writer is Plan 04's SECURITY DEFINER totals maintainer,
--      which runs as the migration owner and can never be reached by clients.
--   3. Transition matrix: draft->draft edits free; draft->issued requires the
--      finalize-allocated seq; issued->voided admins-only (D-16); everything
--      else raises naming the illegal pair.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_document_transition() returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- Static registry of future system-maintained columns (Plan 04 adds them;
  -- declaring them NOW means that migration never amends this trigger).
  v_system_maintained constant text[] := array['paid_amount', 'payment_status'];
  v_changed text[];
begin
  -- Gate 1: loud client-context denial on non-draft rows (42501 semantics,
  -- matching the RLS denial clients already receive from the policy layer).
  if current_user = 'authenticated' and old.status <> 'draft' then
    raise exception 'documents are editable only in draft status - issued and voided documents are immutable'
      using errcode = insufficient_privilege; -- 42501
  end if;

  -- Diff OLD vs NEW as jsonb key sets (RESEARCH Pattern 5 capture style).
  select coalesce(array_agg(o.key order by o.key), array[]::text[])
    into v_changed
    from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n on n.key = o.key
   where o.value is distinct from n.value;

  -- Gate 2: system-maintenance carve-out — same-status issued row, changed
  -- keys confined to the registry. Clients cannot reach this branch: their
  -- session role trips Gate 1 first, and no client code path runs as the
  -- definer owner.
  if old.status = 'issued'
     and new.status = 'issued'
     and v_changed <@ v_system_maintained then
    return new;
  end if;

  -- Gate 3: transition matrix.
  if old.status = 'draft' then
    if new.status = 'draft' then
      return new;                                   -- shared-pool field edits (D-41/D-42)
    elsif new.status = 'issued' then
      if new.seq is null then
        raise exception 'transition draft to issued requires an allocated sequence number - finalize owns numbering (allocate_next_number)';
      end if;
      return new;                                   -- finalize path only
    else
      raise exception 'illegal transition draft to voided - issue first, then void (D-16)';
    end if;
  elsif old.status = 'issued' then
    if new.status = 'voided' then
      if (select public.current_user_role()) in ('admin', 'super_admin') then
        return new;                                 -- D-16: admins-only void
      end if;
      raise exception 'voiding an issued invoice is restricted to admins (D-16)';
    elsif new.status = 'draft' then
      raise exception 'illegal transition issued to draft - corrections are void-and-reissue';
    else
      raise exception 'issued documents are immutable - non-system column(s) changed: %',
        array_to_string(v_changed, ', ');
    end if;
  else
    raise exception 'voided documents are frozen - no further transitions in any direction';
  end if;
end;
$$;

create trigger trg_document_transition
  before update on public.invoices
  for each row
  execute function public.enforce_document_transition();

-- ---------------------------------------------------------------------------
-- trg_document_delete_guard — BEFORE DELETE on invoices. Drafts are deletable
-- (pre-issue discard is fine, Pitfall 2); numbered documents are permanent.
-- Client DELETEs of non-draft rows are already filtered to zero rows by the
-- policy layer; this trigger makes the rule hold even for definer contexts.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_document_deletion_rules() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    raise exception 'only draft documents may be deleted - issued and voided documents are permanent (GST retention)'
      using errcode = insufficient_privilege; -- 42501
  end if;
  return old;
end;
$$;

create trigger trg_document_delete_guard
  before delete on public.invoices
  for each row
  execute function public.enforce_document_deletion_rules();

-- ---------------------------------------------------------------------------
-- trg_archive_guard — BEFORE INSERT on invoices (D-36): archived businesses
-- accept no new bills. SECURITY DEFINER so the businesses lookup does not
-- depend on the inserting role's RLS visibility (same rationale as 0003's
-- enforce_prefix_lock). Payments deliberately remain exempt — receivables on
-- archived businesses keep flowing (D-36 asymmetry, Plan 04).
-- ---------------------------------------------------------------------------

create or replace function public.enforce_archive_guard() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.businesses b
    where b.id = new.business_id
      and b.archived_at is not null
  ) then
    raise exception 'new documents are blocked for archived businesses (D-36)';
  end if;
  return new;
end;
$$;

create trigger trg_archive_guard
  before insert on public.invoices
  for each row
  execute function public.enforce_archive_guard();

-- ---------------------------------------------------------------------------
-- trg_staff_discount_guard — BEFORE INSERT OR UPDATE on invoice_lines.
-- Binding STAFF only (current_user_role() = staff): downward-only pricing vs
-- catalog (D-46) and the 50% per-line cap (D-47). Admins and super_admins are
-- exempt — they own the catalog. Zero-discount ad-hoc lines (catalog NULL,
-- discount 0) pass unchanged. Definer/migration contexts resolve to a NULL
-- effective role and are exempt like admins (finalize writes lines).
-- ---------------------------------------------------------------------------

create or replace function public.enforce_staff_discount() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select public.current_user_role()) = 'staff' then
    if new.discount_pct > 50 then
      raise exception 'staff discount cap is 50 percent per line (D-47)';
    end if;
    if new.unit_price_catalog is not null
       and new.unit_price_charged > new.unit_price_catalog then
      raise exception 'staff may only discount below catalog price, never above it (D-46)';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_staff_discount_guard
  before insert or update on public.invoice_lines
  for each row
  execute function public.enforce_staff_discount();

-- ---------------------------------------------------------------------------
-- trg_line_delete_guard — BEFORE DELETE on invoice_lines: lines belonging to a
-- non-draft parent are permanent. The DELETE policy already filters these rows
-- to zero for clients; this backstop closes the definer context so an issued
-- document can never shed lines through ANY path.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_line_deletion_rules() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.invoices i
    where i.id = old.invoice_id
      and i.status <> 'draft'
  ) then
    raise exception 'lines of issued or voided documents are permanent - corrections are void-and-reissue'
      using errcode = insufficient_privilege; -- 42501
  end if;
  return old;
end;
$$;

create trigger trg_line_delete_guard
  before delete on public.invoice_lines
  for each row
  execute function public.enforce_line_deletion_rules();
