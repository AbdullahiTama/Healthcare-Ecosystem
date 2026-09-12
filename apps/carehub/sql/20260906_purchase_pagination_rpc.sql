-- Paginated purchase list with search and date filtering
CREATE OR REPLACE FUNCTION public.get_purchases_page(
  p_business_id uuid,
  p_search text DEFAULT NULL,
  p_month text DEFAULT NULL,
  p_year text DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  supplier_name text,
  product_name text,
  quantity integer,
  cost_price numeric,
  total_cost numeric,
  amount_paid numeric,
  balance numeric,
  supply_date text,
  due_date text,
  expiry text,
  batch text,
  status text,
  notes text,
  created_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.supplier_name,
    p.product_name,
    p.quantity,
    p.cost_price,
    p.total_cost,
    p.amount_paid,
    p.balance,
    p.supply_date,
    p.due_date,
    p.expiry,
    p.batch,
    p.status,
    p.notes,
    p.created_at
  FROM purchases p
  WHERE p.business_id = p_business_id
    AND (p_search IS NULL OR p_search = '' OR p.supplier_name ILIKE '%' || p_search || '%' OR p.product_name ILIKE '%' || p_search || '%')
    AND (p_month IS NULL OR p_month = '' OR p.created_at >= (p_month || '-01')::date)
    AND (p_month IS NULL OR p_month = '' OR p.created_at < ((p_month || '-01')::date + interval '1 month'))
    AND (p_year IS NULL OR p_year = '' OR p.created_at >= (p_year || '-01-01')::date)
    AND (p_year IS NULL OR p_year = '' OR p.created_at < ((p_year || '-01-01')::date + interval '1 year'))
  ORDER BY p.created_at DESC
  OFFSET p_offset
  LIMIT p_limit;
END;
$$;

-- Purchase totals (always returns full aggregation regardless of filters)
CREATE OR REPLACE FUNCTION public.get_purchase_totals(
  p_business_id uuid
)
RETURNS TABLE (
  purchase_count bigint,
  total_paid numeric,
  total_owed numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::bigint as purchase_count,
    COALESCE(SUM(p.amount_paid), 0)::numeric as total_paid,
    COALESCE(SUM(p.balance), 0)::numeric as total_owed
  FROM purchases p
  WHERE p.business_id = p_business_id;
END;
$$;

-- Grant execute permissions
REVOKE ALL ON FUNCTION public.get_purchases_page(uuid, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_purchases_page(uuid, text, text, text, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_purchase_totals(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_purchase_totals(uuid) TO authenticated;
