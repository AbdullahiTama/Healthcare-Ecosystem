-- Server-side expense aggregation for the Expenses page
-- Returns monthly totals and category breakdown without fetching all rows
CREATE OR REPLACE FUNCTION public.get_expense_summary(
  p_business_id uuid,
  p_month text DEFAULT NULL
)
RETURNS TABLE (
  total_amount numeric,
  transaction_count bigint,
  category text,
  category_amount numeric,
  category_count bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(e.amount) OVER (), 0) as total_amount,
    COUNT(*) OVER () as transaction_count,
    e.category,
    e.amount as category_amount,
    1 as category_count
  FROM expenses e
  WHERE e.business_id = p_business_id
    AND (p_month IS NULL OR e.created_at >= (p_month || '-01')::date)
    AND (p_month IS NULL OR e.created_at < ((p_month || '-01')::date + interval '1 month'))
  ORDER BY e.amount DESC;
END;
$$;

-- Simpler: get total and count for a month (used by budget tracker)
CREATE OR REPLACE FUNCTION public.get_expense_totals(
  p_business_id uuid,
  p_month text DEFAULT NULL
)
RETURNS TABLE (
  total_amount numeric,
  transaction_count bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(e.amount), 0)::numeric as total_amount,
    COUNT(*)::bigint as transaction_count
  FROM expenses e
  WHERE e.business_id = p_business_id
    AND (p_month IS NULL OR e.created_at >= (p_month || '-01')::date)
    AND (p_month IS NULL OR e.created_at < ((p_month || '-01')::date + interval '1 month'));
END;
$$;

-- Paginated expense list (for the table display)
CREATE OR REPLACE FUNCTION public.get_expenses_page(
  p_business_id uuid,
  p_month text DEFAULT NULL,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  category text,
  description text,
  amount numeric,
  date text,
  staff_name text,
  created_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.category,
    e.description,
    e.amount,
    e.date,
    e.staff_name,
    e.created_at
  FROM expenses e
  WHERE e.business_id = p_business_id
    AND (p_month IS NULL OR e.created_at >= (p_month || '-01')::date)
    AND (p_month IS NULL OR e.created_at < ((p_month || '-01')::date + interval '1 month'))
  ORDER BY e.created_at DESC
  OFFSET p_offset
  LIMIT p_limit;
END;
$$;

-- Grant execute permissions
REVOKE ALL ON FUNCTION public.get_expense_summary(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expense_summary(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_expense_totals(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expense_totals(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_expenses_page(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_expenses_page(uuid, text, integer, integer) TO authenticated;
