-- Migration 0019: billing core loop schema additions
--
-- Adds the structural prerequisites for the invoice lifecycle:
--   1. customer_id FK on invoices (nullable draft→finalize customer reference)
--   2. catalog_item_id FK on invoice_lines (nullable stock-decrement traceability)
--   3. CHECK (stock_qty >= 0) on catalog_items (R-48 safety net)
--   4. Service-role void path on trg_document_transition (R-46/R-50)
--
-- All statements are ADDITIVE-ONLY (Phase 1 convention): no applied file is
-- edited. The trigger replacement uses CREATE OR REPLACE (not DROP+CREATE) to
-- preserve existing trigger dependencies.

-- 1. invoices.customer_id — nullable FK into customers
--    Set during draft creation; the finalize function reads the customer row at
--    finalize time to snapshot buyer details (Pitfall 8 freeze-at-issue).
--    NOT cascade-delete: issued invoices retain their snapshot if a customer is
--    deactivated.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS customer_id uuid
  REFERENCES public.customers(id);

-- Partial index for draft-lookup performance (customer picker on bill-entry).
CREATE INDEX IF NOT EXISTS idx_invoices_draft_customer
  ON public.invoices (customer_id)
  WHERE status = 'draft' AND customer_id IS NOT NULL;

-- 2. invoice_lines.catalog_item_id — nullable FK into catalog_items
--    Ad-hoc custom-priced lines (D-45, unit_price_catalog IS NULL) have no
--    catalog source; catalog_item_id stays NULL and is skipped during stock
--    decrement (MSTR-06).
ALTER TABLE public.invoice_lines
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid
  REFERENCES public.catalog_items(id);

-- 3. Stock floor constraint (R-48): the DB-level backstop that rejects any
--    UPDATE setting stock_qty below zero. The finalize function's atomic
--    UPDATE ... WHERE stock_qty >= $1 catches the race first with a
--    user-friendly error; this constraint is the safety net.
ALTER TABLE public.catalog_items
  ADD CONSTRAINT catalog_items_stock_nonnegative CHECK (stock_qty >= 0);

-- 4. trg_document_transition: add service-role void path.
--    The current trigger (migration 0004) blocks voids from service_role
--    because current_user_role() returns NULL for service_role contexts.
--    Gate 1b: after the client-context denial (Gate 1), allow service_role
--    to perform issued→voided transitions. The admin role check is enforced
--    inside the void_invoice_fn() SECURITY DEFINER function before the
--    UPDATE is issued, not by the trigger.
CREATE OR REPLACE FUNCTION public.enforce_document_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- Static registry of future system-maintained columns (Plan 04 adds them;
  -- declaring them NOW means that migration never amends this trigger).
  v_system_maintained constant text[] := array['paid_amount', 'payment_status'];
  v_changed text[];
BEGIN
  -- Gate 1: loud client-context denial on non-draft rows (42501 semantics,
  -- matching the RLS denial clients already receive from the policy layer).
  IF current_user = 'authenticated' AND old.status <> 'draft' THEN
    RAISE EXCEPTION 'documents are editable only in draft status - issued and voided documents are immutable'
      USING errcode = insufficient_privilege; -- 42501
  END IF;

  -- Gate 1b: service-role void path — the void Edge Function runs as
  -- service_role (current_user = 'service_role') and must be allowed to
  -- perform issued→voided transitions. The admin role check is enforced
  -- inside the Postgres void_invoice_fn() SECURITY DEFINER function BEFORE
  -- the UPDATE is issued, not by this trigger.
  IF current_user = 'service_role' AND old.status = 'issued' AND new.status = 'voided' THEN
    RETURN NEW;
  END IF;

  -- Diff OLD vs NEW as jsonb key sets (RESEARCH Pattern 5 capture style).
  SELECT coalesce(array_agg(o.key ORDER BY o.key), array[]::text[])
    INTO v_changed
    FROM jsonb_each(to_jsonb(old)) o
    JOIN jsonb_each(to_jsonb(new)) n ON n.key = o.key
   WHERE o.value IS DISTINCT FROM n.value;

  -- Gate 2: system-maintenance carve-out — same-status issued row, changed
  -- keys confined to the registry. Clients cannot reach this branch: their
  -- session role trips Gate 1 first, and no client code path runs as the
  -- definer owner.
  IF old.status = 'issued'
     AND new.status = 'issued'
     AND v_changed <@ v_system_maintained THEN
    RETURN NEW;
  END IF;

  -- Gate 3: transition matrix.
  IF old.status = 'draft' THEN
    IF new.status = 'draft' THEN
      RETURN NEW;                                   -- shared-pool field edits (D-41/D-42)
    ELSIF new.status = 'issued' THEN
      IF new.seq IS NULL THEN
        RAISE EXCEPTION 'transition draft to issued requires an allocated sequence number - finalize owns numbering (allocate_next_number)';
      END IF;
      RETURN NEW;                                   -- finalize path only
    ELSE
      RAISE EXCEPTION 'illegal transition draft to voided - issue first, then void (D-16)';
    END IF;
  ELSIF old.status = 'issued' THEN
    IF new.status = 'voided' THEN
      IF (SELECT public.current_user_role()) IN ('admin', 'super_admin') THEN
        RETURN NEW;                                 -- D-16: admins-only void
      END IF;
      RAISE EXCEPTION 'voiding an issued invoice is restricted to admins (D-16)';
    ELSIF new.status = 'draft' THEN
      RAISE EXCEPTION 'illegal transition issued to draft - corrections are void-and-reissue';
    ELSE
      RAISE EXCEPTION 'issued documents are immutable - non-system column(s) changed: %',
        array_to_string(v_changed, ', ');
    END IF;
  ELSE
    RAISE EXCEPTION 'voided documents are frozen - no further transitions in any direction';
  END IF;
END;
$$;
