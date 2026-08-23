-- Migration 0005: money-in ledger + master data substrate (Plan 04)
--
-- Append-only payments ledger (PITFALLS.md Pitfall 7): payments are INSERT-only
-- rows; an invoice's paid_amount / payment_status are DERIVED denormalized
-- fields maintained by a SECURITY DEFINER trigger from SUM-over-ledger
-- (ARCHITECTURE.md Pattern 4). Corrections are future reversal entries — no
-- application role, admin included, can ever UPDATE or DELETE a payment row
-- (threat T-1-13).
--
-- Locked decisions baked in here:
--   Pitfall 7  append-only ledger + derived balances; idempotent client
--              operation IDs so duplicate sync deliveries collapse at a
--              unique violation instead of double-counting money
--   D-36       NO archive guard on payments — archived businesses keep
--              accepting money-in while receivables trickle in (asymmetry:
--              trg_archive_guard blocks new DOCUMENTS only)
--   D-43       customers: every business member may SELECT/INSERT/UPDATE
--              within assigned businesses; DELETE denied everywhere
--              (retention; soft-delete via is_active)
--   D-44       catalog_items: admin/super_admin-only writes; staff read-only
--              fixed price menu
--
-- SYSTEM-MAINTENANCE CARVE-OUT CONTRACT (migration 0004 cross-plan promise):
-- maintain_invoice_payment_totals() runs SECURITY DEFINER as the migration
-- owner, bypassing FORCE RLS on invoices — REQUIRED and deliberate, because
-- Plan 03 freezes issued rows behind draft-only UPDATE policies. Its UPDATE
-- touches ONLY {paid_amount, payment_status} (never updated_at), so it passes
-- trg_document_transition via the same-status issued-row carve-out whose
-- static registry names exactly these two columns. Clients keep zero direct
-- mutation paths on issued rows: their UPDATEs die at RLS/the transition gate
-- with 42501. The definer is the ONLY writer of these two columns.
--
-- Conventions inherited from Waves 1-2: ENABLE + FORCE row level security,
-- TO authenticated policies, SECURITY DEFINER helpers with fixed search_path,
-- EXECUTE revoked from PUBLIC on sensitive functions, integer-paise-safe
-- NUMERIC(14,2) money.

-- ---------------------------------------------------------------------------
-- Invoices gain the system-maintained payment columns. These are the ONLY two
-- columns permitted to change on an issued row (0004 carve-out registry); the
-- ledger — not these fields — remains the truth and they are recomputable
-- from payments at any time.
-- ---------------------------------------------------------------------------

alter table public.invoices
  add column paid_amount numeric(14,2) not null default 0,
  add column payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'partial', 'paid'));

-- Scope-typed target for payments' composite FK below: pins every payment to
-- (invoice, business) as an ATOMIC pair, so a forged row can never point an
-- invoice of business A at business B's tenant key — structurally, for every
-- writer including definer contexts (isolation correctness, T-1-15).
alter table public.invoices
  add constraint invoices_id_business_key unique (id, business_id);

-- ---------------------------------------------------------------------------
-- Payments — append-only ledger. INSERT-only by construction:
--   grants layer   authenticated holds SELECT+INSERT only; update/delete/
--                  truncate revoked from anon AND authenticated
--   policy layer   exactly two TO authenticated policies (read + insert);
--                  under FORCE RLS the ABSENCE of update/delete policies
--                  denies those operations by default for EVERY role
--   ledger layer   ON DELETE RESTRICT — a payment row outlives any attempt
--                  to remove its invoice (money history is permanent)
-- ---------------------------------------------------------------------------

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null,                       -- scope-typed FK below
  business_id   uuid not null references public.businesses(id), -- denormalized for admin-scoped reads + RLS
  amount        numeric(14,2) not null check (amount > 0),
  method        text,
  note          text,
  recorded_by   uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

-- Composite scope FK (strengthens plain invoice_id referencing): the
-- (invoice_id, business_id) pair must exist as a unit on invoices.
alter table public.payments
  add constraint payments_invoice_scope_fk
  foreign key (invoice_id, business_id)
  references public.invoices (id, business_id)
  on delete restrict;

-- Pitfall 7 idempotency: clients generate one operation ID per logical
-- payment; duplicate sync deliveries/retries collapse harmlessly at this
-- backstop (23505) instead of double-counting money.
create unique index payments_business_operation_backstop
  on public.payments (business_id, operation_id);

grant select, insert on public.payments to authenticated;
revoke update, delete on public.payments from anon;
revoke update, delete on public.payments from authenticated;
revoke truncate on public.payments from anon;
revoke truncate on public.payments from authenticated;

alter table public.payments enable row level security;
alter table public.payments force row level security;

create policy "payments members-read" on public.payments
  for select to authenticated
  using ((select public.can_access_business(business_id)));

create policy "payments members-insert" on public.payments
  for insert to authenticated
  with check ((select public.can_access_business(business_id)));

-- Deliberately NO "for update" / "for delete" policy exists on payments —
-- append-only by omission, denied by default under FORCE RLS for every
-- application role (Pitfall 7 / T-1-13).

-- ---------------------------------------------------------------------------
-- maintain_invoice_payment_totals — AFTER INSERT on payments.
--
-- SECURITY DEFINER owned by the migration owner with a fixed set search_path
-- = public: the SOLE sanctioned writer of invoices.paid_amount /
-- payment_status (system-maintained columns), bypassing FORCE RLS by design
-- (clients have no path here; their own UPDATE attempts die with 42501).
--
-- Recomputes paid_amount as a SUM aggregate over the invoice's ledger rows —
-- never increments a scalar — so the denormalized fields always reconcile
-- with the ledger and can be rebuilt from it at any time (Pattern 4 truth).
-- Status: paid when paid_amount >= total_amount, partial when 0 < paid <
-- total, unpaid otherwise.
--
-- Overpayment guard: raises (aborting the whole statement, insert included)
-- when the post-insert ledger sum exceeds the invoice's frozen total.
--
-- The invoices UPDATE rides 0004's system-maintenance carve-out: same-status
-- issued row, changed keys confined to {paid_amount, payment_status}.
-- updated_at is deliberately NOT touched (it sits outside the registry).
-- Incidental protection: against VOIDED invoices the transition trigger's
-- terminal-freeze rule rejects the totals update, so voided documents can
-- never receive money through any path.
--
-- NO archive guard lives here (D-36 asymmetry): archived businesses accept
-- payment recording.
-- ---------------------------------------------------------------------------

create or replace function public.maintain_invoice_payment_totals() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(14,2);
  v_paid  numeric(14,2);
begin
  -- Ledger is the truth: derive from ALL rows, not a running scalar.
  select coalesce(sum(p.amount), 0)
    into v_paid
    from public.payments p
   where p.invoice_id = new.invoice_id;

  select i.total_amount
    into v_total
    from public.invoices i
   where i.id = new.invoice_id;

  if v_total is null then
    raise exception 'payment references unknown invoice %', new.invoice_id;
  end if;

  -- Overpayment guard: the new row pushed the ledger past the legal total.
  if v_paid > v_total then
    raise exception 'payment exceeds invoice balance - total %, ledger sum % (overpayment rejected)',
      v_total, v_paid
      using errcode = 'P0001';
  end if;

  update public.invoices
     set paid_amount    = v_paid,
         payment_status = case
                            when v_paid <= 0      then 'unpaid'
                            when v_paid >= v_total then 'paid'
                            else                        'partial'
                          end
   where id = new.invoice_id;

  return new;
end;
$$;

-- Trigger functions are not directly callable, but EXECUTE hygiene stays
-- explicit per Wave-1 convention (revoked from PUBLIC and application roles).
revoke execute on function public.maintain_invoice_payment_totals()
  from public;
revoke execute on function public.maintain_invoice_payment_totals()
  from anon;
revoke execute on function public.maintain_invoice_payment_totals()
  from authenticated;

create trigger trg_payment_totals
  after insert on public.payments
  for each row
execute function public.maintain_invoice_payment_totals();
