-- SNAPSHOT, NOT A MIGRATION. Do not run except to roll back.
-- save_stock_validation_session as it was live on 2026-10-30, before
-- carehub_20261226_stock_count_ledger moved stock counts onto the stock ledger.
-- No migration in this repository defined it. The body is byte for byte the live
-- prosrc (md5 03cf6395985d4ee3344ab39d0fa4c21c; it uses CRLF line endings).
-- To roll back: DROP FUNCTION public.save_stock_validation_session(uuid, uuid, text, integer, integer, jsonb, text);
-- then run this file. Grants were PUBLIC-default: anon, authenticated, service_role.

CREATE OR REPLACE FUNCTION public.save_stock_validation_session(p_business_id uuid, p_user_id uuid, p_user_name text, p_products_checked integer, p_products_adjusted integer, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session_id uuid;
  v_item jsonb;
BEGIN
  INSERT INTO stock_validation_sessions (business_id, user_id, user_name, products_checked, products_adjusted)
  VALUES (p_business_id, p_user_id, p_user_name, p_products_checked, p_products_adjusted)
  RETURNING id INTO v_session_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO stock_validation_items (
      session_id,
      product_id,
      product_name,
      shelf_label,
      previous_stock,
      adjustment_qty,
      adjustment_direction,
      new_stock,
      reason,
      unit_price
    ) VALUES (
      v_session_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      v_item->>'shelf_label',
      (v_item->>'previous_stock')::int,
      (v_item->>'adjustment_qty')::int,
      v_item->>'adjustment_direction',
      (v_item->>'new_stock')::int,
      v_item->>'reason',
      COALESCE((v_item->>'unit_price')::numeric, 0)
    );

    UPDATE products
       SET stock = (v_item->>'new_stock')::int
     WHERE id = (v_item->>'product_id')::uuid
       AND business_id = p_business_id;
  END LOOP;

  RETURN v_session_id;
END;
$function$;

COMMENT ON FUNCTION public.save_stock_validation_session(uuid, uuid, text, integer, integer, jsonb) IS
  'Atomic stock validation: inserts a session with its item rows and updates each product stock in a single transaction. SECURITY INVOKER — products RLS enforces the tenant boundary.';
