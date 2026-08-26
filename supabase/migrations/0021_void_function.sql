-- Migration 0021: void_invoice_fn — SECURITY DEFINER post void function (Plan 04-03)
--
-- Server-side void that transitions issued invoices to voided status.
-- The admin role check is inside this function (not the trigger), because
-- the Edge Function runs as service_role and the trigger's current_user_role()
-- returns NULL for that context. Migration 0019 added the service-role void
-- path on trg_document_transition to allow the UPDATE through.
--
-- Design:
--   1. Verify caller is admin/super_admin via profiles table (D-16)
--   2. Read the issued invoice (status = 'issued' only)
--   3. Verify business membership via can_access_business()
--   4. Void the invoice (UPDATE status -> voided, populate voided_at/by/reason)
--   5. Create replacement draft with copied lines (INV-06 void-and-reissue)
--   6. Write audit trail via write_audit()
--   7. Return JSONB with invoice_id, status, new_draft_id
--
-- The voided invoice retains its consumed sequence number permanently (INV-06).
-- The replacement draft copies lines WITHOUT tax breakup columns — taxes are
-- recomputed at the replacement's own finalize. The replacement draft's FY is
-- the SAME as the voided invoice's FY; a fresh number is allocated at finalize.
--
-- EXECUTE revoked from authenticated/anon: the Edge Function calls this via
-- service_role RPC, never through the client.

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
  -- 1. Verify caller is admin (D-16)
  SELECT role INTO v_caller_role FROM profiles WHERE id = p_caller_id AND is_active = true;
  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'caller not found or inactive' USING errcode = 'invalid_parameter_value';
  END IF;
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'voiding an issued invoice is restricted to admins (D-16)'
      USING errcode = 'insufficient_privilege';
  END IF;

  -- 2. Read the issued invoice
  SELECT * INTO v_invoice FROM invoices
    WHERE id = p_invoice_id AND business_id = p_business_id AND status = 'issued';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice not found or not issued' USING errcode = 'no_data_found';
  END IF;

  -- 3. Verify business membership
  IF NOT can_access_business(p_business_id) THEN
    RAISE EXCEPTION 'no business access' USING errcode = 'insufficient_privilege';
  END IF;

  -- 4. Void the invoice (trigger allows service_role void via migration 0019)
  UPDATE invoices SET
    status = 'voided',
    voided_at = now(),
    voided_by = p_caller_id,
    void_reason = p_void_reason
  WHERE id = p_invoice_id AND business_id = p_business_id;

  -- 5. Create replacement draft with voided invoice's lines (INV-06)
  v_new_draft_id := gen_random_uuid();
  INSERT INTO invoices (id, business_id, fy, status, customer_id, created_by)
    VALUES (v_new_draft_id, p_business_id, v_invoice.fy, 'draft', v_invoice.customer_id, p_caller_id);

  -- Copy lines from voided invoice to new draft
  FOR v_line IN
    SELECT * FROM invoice_lines WHERE invoice_id = p_invoice_id ORDER BY position
  LOOP
    INSERT INTO invoice_lines (
      invoice_id, position, description, hsn_sac, quantity,
      unit_price_catalog, catalog_item_id, unit_price_charged,
      discount_pct, gst_rate
    ) VALUES (
      v_new_draft_id, v_line.position, v_line.description, v_line.hsn_sac, v_line.quantity,
      v_line.unit_price_catalog, v_line.catalog_item_id, v_line.unit_price_charged,
      v_line.discount_pct, v_line.gst_rate
    );
  END LOOP;

  -- 6. Audit trail
  PERFORM write_audit(
    'invoice.void', 'invoices', p_invoice_id, p_business_id,
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

REVOKE EXECUTE ON FUNCTION public.void_invoice_fn FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.void_invoice_fn FROM anon;
