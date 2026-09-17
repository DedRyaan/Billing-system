-- Migration 0022: serialize ledger-derived invoice payment totals (T-05-01).
-- Additive replacement: keep 0005 applied history and its definer/denial contract.
-- Lock before the SUM so a waiting READ COMMITTED trigger recomputes using
-- the preceding payment transaction's committed ledger rows.
create or replace function public.maintain_invoice_payment_totals() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(14,2);
  v_paid  numeric(14,2);
begin
  perform 1 from public.invoices i where i.id = new.invoice_id for update;

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

revoke execute on function public.maintain_invoice_payment_totals() from public;
revoke execute on function public.maintain_invoice_payment_totals() from anon;
revoke execute on function public.maintain_invoice_payment_totals() from authenticated;
