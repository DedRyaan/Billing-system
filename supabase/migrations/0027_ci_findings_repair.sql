-- Migration 0027: repairs surfaced by the first green-setup pgTAP run in CI
-- since 2026-08 (the suite had not executed since 5c13b11). Additive-only.
--
-- 1. enforce_document_transition() (0019) wrote `USING errcode =
--    insufficient_privilege` unquoted. PL/pgSQL evaluates that as an
--    expression, so every client edit of an issued/voided invoice died with
--    42703 "column insufficient_privilege does not exist" instead of the
--    intended loud 42501 (same defect class 0012 repaired in Phase 1). The
--    edit was still refused; only the error contract was wrong.
--
-- 2. 0026 pinned draft payment totals to 0/'unpaid'. That broke the
--    status-blind ledger derivation (a payment may target a draft carrying
--    a total; ledger_masterdata tests 21 + 52). Replace it with the correct
--    closure of T-05-04: whenever a draft row is written, and on the
--    draft -> issued transition, paid_amount / payment_status are re-derived
--    from the payments ledger. A client-written value can never survive,
--    and the ledger stays the single source of truth.
--
-- 3. Supabase's default privileges granted anon/authenticated far more than
--    the migrations intended (verified against the linked project):
--    TRUNCATE (which bypasses RLS) on every app table, every privilege to
--    anon, and DELETE on customers/businesses which have no delete policy
--    (soft delete / archive only). Not reachable through PostgREST, but the
--    grants layer is meant to deny loudly (ledger_masterdata test 39).

-- ---------------------------------------------------------------------------
-- 1. Document transition guard with a quoted errcode
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_document_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_system_maintained constant text[] := array['paid_amount', 'payment_status'];
  v_changed text[];
BEGIN
  -- Gate 1: loud client-context denial on non-draft rows (42501).
  IF current_user = 'authenticated' AND old.status <> 'draft' THEN
    RAISE EXCEPTION 'documents are editable only in draft status - issued and voided documents are immutable'
      USING errcode = 'insufficient_privilege'; -- 42501
  END IF;

  -- Gate 1b: service-role void path (admin check lives in void_invoice_fn).
  IF current_user = 'service_role' AND old.status = 'issued' AND new.status = 'voided' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(array_agg(o.key ORDER BY o.key), array[]::text[])
    INTO v_changed
    FROM jsonb_each(to_jsonb(old)) o
    JOIN jsonb_each(to_jsonb(new)) n ON n.key = o.key
   WHERE o.value IS DISTINCT FROM n.value;

  -- Gate 2: system-maintenance carve-out for the payment-totals trigger.
  IF old.status = 'issued'
     AND new.status = 'issued'
     AND v_changed <@ v_system_maintained THEN
    RETURN NEW;
  END IF;

  -- Gate 3: transition matrix.
  IF old.status = 'draft' THEN
    IF new.status = 'draft' THEN
      RETURN NEW;
    ELSIF new.status = 'issued' THEN
      IF new.seq IS NULL THEN
        RAISE EXCEPTION 'transition draft to issued requires an allocated sequence number - finalize owns numbering (allocate_next_number)';
      END IF;
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'illegal transition draft to voided - issue first, then void (D-16)';
    END IF;
  ELSIF old.status = 'issued' THEN
    IF new.status = 'voided' THEN
      IF (SELECT public.current_user_role()) IN ('admin', 'super_admin') THEN
        RETURN NEW;
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

-- ---------------------------------------------------------------------------
-- 2. Draft payment totals derive from the ledger (replaces 0026's pinning)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reset_draft_payment_totals() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid numeric(14,2);
BEGIN
  -- Only drafts and the draft -> issued transition are re-derived; issued
  -- rows are maintained by maintain_invoice_payment_totals().
  IF NOT (NEW.status = 'draft' OR (TG_OP = 'UPDATE' AND OLD.status = 'draft')) THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(p.amount), 0) INTO v_paid
    FROM public.payments p
   WHERE p.invoice_id = NEW.id;

  NEW.paid_amount    := v_paid;
  NEW.payment_status := CASE
                          WHEN v_paid <= 0 THEN 'unpaid'
                          WHEN v_paid >= NEW.total_amount THEN 'paid'
                          ELSE 'partial'
                        END;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reset_draft_payment_totals() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_draft_payment_totals_reset ON public.invoices;
CREATE TRIGGER trg_draft_payment_totals_reset
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_draft_payment_totals();

-- ---------------------------------------------------------------------------
-- 3. Grants back to the intended posture
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.businesses, public.business_members, public.profiles,
              public.customers, public.catalog_items, public.invoices,
              public.invoice_lines, public.payments, public.audit_log
  FROM anon;

REVOKE TRUNCATE ON public.businesses, public.business_members, public.profiles,
                   public.customers, public.catalog_items, public.invoices,
                   public.invoice_lines
  FROM authenticated;

-- No delete policy exists for these (customers: soft delete via is_active;
-- businesses: archive), so DELETE must die at the grants layer.
REVOKE DELETE ON public.customers, public.businesses FROM authenticated;
