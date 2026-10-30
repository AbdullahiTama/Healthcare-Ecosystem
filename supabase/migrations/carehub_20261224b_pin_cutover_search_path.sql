-- Pin the search_path of sale_ledger_cutover (carehub_20261224_sale_stock_ledger).
-- 2026-10-30. The security advisor flagged it (function_search_path_mutable).
-- It only returns a constant, so there was no exploitable path, but every
-- function here pins its search_path. Idempotent; the 20261224 file now
-- creates it pinned, so a fresh replay needs no separate step.
ALTER FUNCTION public.sale_ledger_cutover() SET search_path = pg_catalog, pg_temp;
