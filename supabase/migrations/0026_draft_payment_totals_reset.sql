-- Migration 0026: drafts can never carry payment totals (closes T-05-04).
--
-- The 0004/0019 draft policies let clients write any draft column, including
-- the derived paid_amount / payment_status. finalize_invoice_fn freezes the
-- draft row into an issued invoice without touching those columns, and
-- maintain_invoice_payment_totals only re-derives them when a payment row is
-- inserted. A client could therefore issue a bill already marked 'paid' with
-- an empty ledger, hiding it from Outstandings.
--
-- Payments cannot exist on drafts (amount > 0 and a draft's total is 0, so the
-- payment trigger rejects them), so a draft's true totals are always zero.
-- This BEFORE trigger pins them on every draft insert/update; finalize then
-- issues from a row whose totals are already 0/'unpaid'. The ledger stays the
-- only path to a non-zero paid_amount.

CREATE OR REPLACE FUNCTION public.reset_draft_payment_totals() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.paid_amount    := 0;
  NEW.payment_status := 'unpaid';
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reset_draft_payment_totals() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_draft_payment_totals_reset ON public.invoices;
CREATE TRIGGER trg_draft_payment_totals_reset
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  WHEN (NEW.status = 'draft')
  EXECUTE FUNCTION public.reset_draft_payment_totals();

-- Normalise any existing drafts (draft -> draft passes the transition trigger).
UPDATE public.invoices
   SET paid_amount = 0, payment_status = 'unpaid'
 WHERE status = 'draft'
   AND (paid_amount <> 0 OR payment_status <> 'unpaid');
