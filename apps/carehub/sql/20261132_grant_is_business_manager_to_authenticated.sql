-- Restores the manager-review policies on facilities_cache / rep_added_facilities (and anything else that
-- calls is_business_manager() inside an RLS policy). The function was not executable by authenticated, so
-- confirming or dismissing a rep-added facility failed with 'permission denied' for every signed-in user.
-- APPLIED TO PRODUCTION 2026-10-19; verified in a rolled-back run first (reps still cannot self-confirm,
-- other companies cannot touch the rows, anon still cannot call it).
-- Rollback: REVOKE EXECUTE ON FUNCTION public.is_business_manager(uuid) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.is_business_manager(uuid) TO authenticated;
