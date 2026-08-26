-- Migration 0020: finalize_invoice_fn — atomic server-side finalize
--
-- SECURITY DEFINER function that transitions a draft invoice to issued status
-- inside a single Postgres transaction. The Edge Function is a thin
-- JWT-verification shell that computes taxes via @billing/gst (Strategy B)
-- and calls this function with pre-computed totals.
--
-- Sequence inside the transaction:
--   1. Validate caller is active profile with business access
--   2. Validate invoice is draft
--   3. Validate lines exist
--   4. Validate provided totals (defense-in-depth)
--   5. Derive FY from IST calendar date (R-47)
--   6. Allocate gapless number via allocate_next_number()
--   7. Format document number via format_document_number()
--   8. Read customer row for buyer snapshot (Pitfall 8)
--   9. Update invoice: freeze totals, snapshot buyer, set status=issued
--  10. Freeze line tax breakup from pre-computed details
--  11. Decrement stock for catalog-sourced lines only (MSTR-05/MSTR-06)
--  12. Write audit trail via write_audit()
--  13. Return result JSONB
--
-- If ANY step fails, the entire transaction rolls back — no partial
-- finalization. Number allocation is transactional: rollback reclaims the
-- number (unlike sequences which burn on rollback).

-- ---------------------------------------------------------------------------
-- derive_fy_at_finalize() — IST financial year derivation for SQL context
--
-- Mirrors deriveFinancialYear() from @billing/gst but in pure SQL.
-- Format matches invoice_counters.fy: '26-27' (2-digit, hyphenated).
-- Uses the same logic as enforce_prefix_lock() for consistency.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.derive_fy_at_finalize()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT right(v_fy_start::text, 2) || '-' || right((v_fy_start + 1)::text, 2)
  FROM (
    SELECT CASE
      WHEN EXTRACT(MONTH FROM now() AT TIME ZONE 'Asia/Kolkata') >= 4
      THEN EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Kolkata')::int
      ELSE EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Kolkata')::int - 1
    END AS v_fy_start
  ) sub;
$$;

REVOKE EXECUTE ON FUNCTION public.derive_fy_at_finalize() FROM public;
REVOKE EXECUTE ON FUNCTION public.derive_fy_at_finalize() FROM anon;
REVOKE EXECUTE ON FUNCTION public.derive_fy_at_finalize() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.derive_fy_at_finalize() TO service_role;

-- ---------------------------------------------------------------------------
-- finalize_invoice_fn() — the atomic finalize transaction
--
-- Parameters:
--   p_caller_id     — verified JWT user id (Edge Function extracts from token)
--   p_invoice_id    — draft invoice to finalize
--   p_business_id   — business scope (tenant guard)
--   p_subtotal      — pre-computed subtotal in rupees (from totalInvoice())
--   p_tax           — pre-computed total tax in rupees
--   p_total         — pre-computed grand total in rupees
--   p_round_off     — pre-computed round-off in rupees
--   p_supply_type   — 'intra_state' or 'inter_state' (from POS derivation)
--   p_line_details  — JSONB array: [{position, taxable, cgst, sgst, igst}]
--
-- Security:
--   SECURITY DEFINER runs as the database owner (service_role path).
--   Caller identity is verified via p_caller_id (extracted from JWT by
--   the Edge Function). Business membership is checked directly against
--   business_members (cannot use can_access_business() as auth.uid() is
--   NULL in service_role RPC context).
--   EXECUTE revoked from PUBLIC/anon/authenticated — only callable via
--   service_role from Edge Functions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_invoice_fn(
  p_caller_id    uuid,
  p_invoice_id   uuid,
  p_business_id  uuid,
  p_subtotal     numeric,
  p_tax          numeric,
  p_total        numeric,
  p_round_off    numeric,
  p_supply_type  text,
  p_line_details jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice     RECORD;
  v_customer    RECORD;
  v_caller_role text;
  v_fy          text;
  v_seq         integer;
  v_doc_number  text;
  v_detail      jsonb;
  v_i           integer;
  v_line_count  integer;
  v_subtotal_check numeric;
BEGIN
  -- ── 1. Validate caller is active profile ──────────────────────────────
  SELECT role INTO v_caller_role
    FROM public.profiles
   WHERE id = p_caller_id AND is_active = true;

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'caller not found or inactive'
      USING errcode = 'invalid_parameter_value';
  END IF;

  -- ── 2. Verify business membership ─────────────────────────────────────
  --    Cannot use can_access_business() here because auth.uid() returns NULL
  --    in the service_role RPC context. Direct check against business_members.
  IF v_caller_role NOT IN ('super_admin', 'admin') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.business_members
       WHERE business_id = p_business_id AND user_id = p_caller_id
    ) THEN
      RAISE EXCEPTION 'no access to business %', p_business_id
        USING errcode = 'insufficient_privilege';
    END IF;
  END IF;

  -- ── 3. Read draft invoice ─────────────────────────────────────────────
  SELECT * INTO v_invoice
    FROM public.invoices
   WHERE id = p_invoice_id
     AND business_id = p_business_id
     AND status = 'draft';

  IF NOT FOUND THEN
    -- Distinguish not-found from already-issued (race condition / T-4-09)
    IF EXISTS (
      SELECT 1 FROM public.invoices
       WHERE id = p_invoice_id AND business_id = p_business_id AND status = 'issued'
    ) THEN
      RAISE EXCEPTION 'already_issued'
        USING errcode = 'unique_violation';
    END IF;
    RAISE EXCEPTION 'invoice not found or not draft'
      USING errcode = 'invalid_parameter_value';
  END IF;

  -- ── 4. Validate lines exist ───────────────────────────────────────────
  SELECT count(*) INTO v_line_count
    FROM public.invoice_lines
   WHERE invoice_id = p_invoice_id;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'invoice has no lines'
      USING errcode = 'invalid_parameter_value';
  END IF;

  -- ── 5. Validate provided line details ─────────────────────────────────
  --    Defense-in-depth: line count must match, totals must be non-negative.
  IF p_line_details IS NULL
     OR jsonb_array_length(p_line_details) != v_line_count THEN
    RAISE EXCEPTION 'line_details count mismatch: expected % got %',
      v_line_count, COALESCE(jsonb_array_length(p_line_details), 0)
      USING errcode = 'invalid_parameter_value';
  END IF;

  IF p_subtotal < 0 OR p_tax < 0 OR p_total < 0 THEN
    RAISE EXCEPTION 'negative amounts not allowed'
      USING errcode = 'invalid_parameter_value';
  END IF;

  -- ── 6. Derive FY from IST calendar (R-47) ────────────────────────────
  v_fy := public.derive_fy_at_finalize();

  -- ── 7. Allocate gapless number (atomic via row lock) ──────────────────
  v_seq := public.allocate_next_number(p_business_id, v_fy, 'invoice');

  -- ── 8. Format document number ─────────────────────────────────────────
  v_doc_number := public.format_document_number(p_business_id, v_fy, 'invoice');

  -- ── 9. Read customer for buyer snapshot (Pitfall 8) ───────────────────
  IF v_invoice.customer_id IS NOT NULL THEN
    SELECT name, gstin, address, state INTO v_customer
      FROM public.customers
     WHERE id = v_invoice.customer_id;
  END IF;

  -- ── 10. Update invoice: freeze totals, snapshot buyer, set issued ─────
  UPDATE public.invoices SET
    status            = 'issued',
    fy                = v_fy,
    seq               = v_seq,
    issued_at         = now(),
    issued_by         = p_caller_id,
    customer_name     = COALESCE(v_customer.name, invoices.customer_name),
    customer_gstin    = COALESCE(v_customer.gstin, invoices.customer_gstin),
    customer_address  = COALESCE(v_customer.address, invoices.customer_address),
    supply_type       = p_supply_type,
    registration_type = (SELECT registration_type FROM public.businesses WHERE id = p_business_id),
    subtotal_amount   = p_subtotal,
    tax_amount        = p_tax,
    total_amount      = p_total,
    round_off_amount  = p_round_off
  WHERE id = p_invoice_id
    AND business_id = p_business_id
    AND status = 'draft';

  -- Guard: if 0 rows updated, the invoice was modified concurrently
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice modified concurrently during finalization'
      USING errcode = 'serialization_failure';
  END IF;

  -- ── 11. Freeze line tax breakup ───────────────────────────────────────
  FOR v_i IN 0 .. jsonb_array_length(p_line_details) - 1 LOOP
    v_detail := p_line_details->v_i;
    UPDATE public.invoice_lines SET
      taxable_value = (v_detail->>'taxable')::numeric,
      cgst_amount   = (v_detail->>'cgst')::numeric,
      sgst_amount   = (v_detail->>'sgst')::numeric,
      igst_amount   = (v_detail->>'igst')::numeric
    WHERE invoice_id = p_invoice_id
      AND position   = (v_detail->>'position')::integer;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line freeze failed: no line at position %',
        (v_detail->>'position')::integer
        USING errcode = 'invalid_parameter_value';
    END IF;
  END LOOP;

  -- ── 12. Decrement stock for catalog-sourced lines (MSTR-05/MSTR-06) ───
  --    Only lines where catalog_item_id IS NOT NULL trigger decrement.
  --    Ad-hoc lines (catalog_item_id IS NULL) are explicitly skipped (MSTR-06).
  --    Atomic UPDATE with WHERE stock_qty >= quantity catches race first;
  --    CHECK (stock_qty >= 0) constraint is the safety net.
  FOR v_i IN 0 .. jsonb_array_length(p_line_details) - 1 LOOP
    v_detail := p_line_details->v_i;
    DECLARE
      v_line_position integer := (v_detail->>'position')::integer;
      v_catalog_item_id uuid;
      v_quantity numeric;
      v_desc text;
      v_current_stock integer;
    BEGIN
      SELECT il.catalog_item_id, il.quantity, il.description
        INTO v_catalog_item_id, v_quantity, v_desc
        FROM public.invoice_lines il
       WHERE il.invoice_id = p_invoice_id AND il.position = v_line_position;

      IF v_catalog_item_id IS NOT NULL AND v_quantity > 0 THEN
        -- Atomic decrement with guard
        SELECT stock_qty INTO v_current_stock
          FROM public.catalog_items
         WHERE id = v_catalog_item_id;

        UPDATE public.catalog_items
           SET stock_qty = stock_qty - v_quantity
         WHERE id = v_catalog_item_id
           AND stock_qty >= v_quantity;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'insufficient stock for "%": % available, % requested',
            v_desc,
            COALESCE(v_current_stock, 0),
            v_quantity
            USING errcode = 'check_violation';
        END IF;
      END IF;
    END;
  END LOOP;

  -- ── 13. Audit trail ───────────────────────────────────────────────────
  PERFORM public.write_audit(
    'invoice.finalize',
    'invoices',
    p_invoice_id::text,
    p_business_id,
    jsonb_build_object('status', 'draft', 'caller_id', p_caller_id),
    jsonb_build_object(
      'status',     'issued',
      'seq',        v_seq,
      'fy',         v_fy,
      'doc_number', v_doc_number,
      'total',      p_total,
      'caller_id',  p_caller_id
    )
  );

  -- ── 14. Return result ─────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'invoice_id',   p_invoice_id,
    'doc_number',   v_doc_number,
    'status',       'issued',
    'total_amount', p_total
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_invoice_fn(uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.finalize_invoice_fn(uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_invoice_fn(uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.finalize_invoice_fn(uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, jsonb) TO service_role;
