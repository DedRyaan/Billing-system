-- Migration 0023: void/finalize hardening (audit findings F-04..F-07, F-12)
--
-- Additive-only (Phase 1 convention): 0020/0021 are not edited; both
-- functions are replaced in place with CREATE OR REPLACE (same signatures,
-- so existing grants carry over and are then tightened below).
--
-- void_invoice_fn():
--   F-12  EXECUTE was never revoked from PUBLIC (0021 revoked only anon and
--         authenticated, which leaves the default PUBLIC grant in force). Any
--         client could call it over PostgREST RPC with an admin's id as
--         p_caller_id and void arbitrary invoices. Revoke from PUBLIC and
--         grant to service_role only, matching finalize_invoice_fn.
--   F-04  write_audit() takes p_target_id text; passing the uuid without a
--         cast has no implicit-cast match, so every void raised
--         "function write_audit(...) does not exist" at runtime.
--   F-05  The business_members check rejected admins/super_admins without a
--         membership row — but only those roles may void, and they see every
--         business by design (D-11/D-12, can_access_business). The owner
--         could not void their own invoices. Role check alone now gates.
--   F-07  Stock decremented at finalize was never restored on void, so
--         void-and-reissue decremented catalog stock twice. Catalog lines
--         are now restocked when the invoice is voided.
--
-- finalize_invoice_fn():
--   F-06  customer_id / catalog_item_id carry single-column FKs, so a draft
--         could reference another business's customer (whose name, GSTIN and
--         address were then snapshotted onto this invoice) or catalog item
--         (whose stock was then decremented). Both lookups are now scoped to
--         p_business_id and reject foreign references.

-- ---------------------------------------------------------------------------
-- void_invoice_fn
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.void_invoice_fn(
  p_caller_id uuid,
  p_invoice_id uuid,
  p_business_id uuid,
  p_void_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice RECORD;
  v_caller_role text;
  v_line RECORD;
  v_new_draft_id uuid;
BEGIN
  -- 1. Verify caller is an active admin (D-16). Admins and super_admins see
  --    every business (D-11/D-12), so no membership row is required (F-05).
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = p_caller_id AND is_active = true;
  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'caller not found or inactive' USING errcode = 'invalid_parameter_value';
  END IF;
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'voiding an issued invoice is restricted to admins (D-16)'
      USING errcode = 'insufficient_privilege';
  END IF;

  -- 2. Read (and lock) the issued invoice
  SELECT * INTO v_invoice FROM public.invoices
    WHERE id = p_invoice_id AND business_id = p_business_id AND status = 'issued'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice not found or not issued' USING errcode = 'no_data_found';
  END IF;

  -- 3. Void the invoice (trigger allows service_role void via migration 0019)
  UPDATE public.invoices SET
    status = 'voided',
    voided_at = now(),
    voided_by = p_caller_id,
    void_reason = p_void_reason
  WHERE id = p_invoice_id AND business_id = p_business_id;

  -- 4. Restock catalog-sourced lines (F-07) — mirror of the finalize
  --    decrement, scoped to this business.
  UPDATE public.catalog_items ci
     SET stock_qty = ci.stock_qty + agg.qty
    FROM (
      SELECT il.catalog_item_id, sum(il.quantity) AS qty
        FROM public.invoice_lines il
       WHERE il.invoice_id = p_invoice_id
         AND il.catalog_item_id IS NOT NULL
         AND il.quantity > 0
       GROUP BY il.catalog_item_id
    ) agg
   WHERE ci.id = agg.catalog_item_id
     AND ci.business_id = p_business_id;

  -- 5. Create replacement draft with voided invoice's lines (INV-06)
  v_new_draft_id := gen_random_uuid();
  INSERT INTO public.invoices (id, business_id, fy, status, customer_id, created_by)
    VALUES (v_new_draft_id, p_business_id, v_invoice.fy, 'draft', v_invoice.customer_id, p_caller_id);

  FOR v_line IN
    SELECT * FROM public.invoice_lines WHERE invoice_id = p_invoice_id ORDER BY position
  LOOP
    INSERT INTO public.invoice_lines (
      invoice_id, position, description, hsn_sac, quantity,
      unit_price_catalog, catalog_item_id, unit_price_charged,
      discount_pct, gst_rate
    ) VALUES (
      v_new_draft_id, v_line.position, v_line.description, v_line.hsn_sac, v_line.quantity,
      v_line.unit_price_catalog, v_line.catalog_item_id, v_line.unit_price_charged,
      v_line.discount_pct, v_line.gst_rate
    );
  END LOOP;

  -- 6. Audit trail (F-04: p_target_id is text)
  PERFORM public.write_audit(
    'invoice.void', 'invoices', p_invoice_id::text, p_business_id,
    jsonb_build_object('status', 'issued', 'seq', v_invoice.seq),
    jsonb_build_object('status', 'voided', 'void_reason', p_void_reason, 'new_draft_id', v_new_draft_id)
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'status', 'voided',
    'new_draft_id', v_new_draft_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.void_invoice_fn(uuid, uuid, uuid, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.void_invoice_fn(uuid, uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.void_invoice_fn(uuid, uuid, uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.void_invoice_fn(uuid, uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- finalize_invoice_fn — identical to 0020 except the tenant-scoped customer
-- snapshot and catalog stock decrement (F-06).
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

  -- ── 5b. Tenant scope of referenced master data (F-06) ─────────────────
  IF v_invoice.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers
     WHERE id = v_invoice.customer_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'customer not found in business'
      USING errcode = 'invalid_parameter_value';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoice_lines il
     WHERE il.invoice_id = p_invoice_id
       AND il.catalog_item_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.catalog_items ci
          WHERE ci.id = il.catalog_item_id AND ci.business_id = p_business_id
       )
  ) THEN
    RAISE EXCEPTION 'catalog item not found in business'
      USING errcode = 'invalid_parameter_value';
  END IF;

  -- ── 6. Derive FY from IST calendar (R-47) ────────────────────────────
  v_fy := public.derive_fy_at_finalize();

  -- ── 7. Allocate gapless number (atomic via row lock) ──────────────────
  v_seq := public.allocate_next_number(p_business_id, v_fy, 'invoice');

  -- ── 8. Format document number ─────────────────────────────────────────
  v_doc_number := public.format_document_number(p_business_id, v_fy, 'invoice');

  -- ── 9. Read customer for buyer snapshot (Pitfall 8), tenant-scoped ────
  IF v_invoice.customer_id IS NOT NULL THEN
    SELECT name, gstin, address, state INTO v_customer
      FROM public.customers
     WHERE id = v_invoice.customer_id
       AND business_id = p_business_id;
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

  -- ── 12. Decrement stock for catalog-sourced lines (tenant-scoped) ─────
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
        SELECT stock_qty INTO v_current_stock
          FROM public.catalog_items
         WHERE id = v_catalog_item_id
           AND business_id = p_business_id;

        UPDATE public.catalog_items
           SET stock_qty = stock_qty - v_quantity
         WHERE id = v_catalog_item_id
           AND business_id = p_business_id
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
