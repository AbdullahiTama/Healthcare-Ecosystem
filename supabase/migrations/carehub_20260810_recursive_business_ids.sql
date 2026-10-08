-- ============================================================================
-- Recursive current_business_ids() — multi-branch owner visibility
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql.
--
-- The original current_business_ids() returned only the single business row
-- whose email matched the user's, plus any businesses where they had an active
-- staff row. That meant a parent-business owner could NOT see their branches'
-- rows — every RLS policy gates on `business_id IN (SELECT current_business_ids())`,
-- so branches were invisible to the people who own them.
--
-- This migration:
--   1. Adds `branch_depth_limit` to businesses (how deep the owner can see).
--   2. Rewrites current_business_ids() as a recursive CTE that walks
--      `parent_business_id`, returning the owner's business AND all descendants
--      up to branch_depth_limit levels deep.
--
-- The recursive CTE is bounded by the per-business depth limit, so a malformed
-- parent_business_id cycle cannot loop indefinitely — the level counter stops
-- it. search_path is pinned to `public` to close the SECURITY DEFINER hijack
-- risk, same as the original.
-- ============================================================================

-- Depth limit: how many levels of branches an owner can see. Default 5 covers
-- HQ -> region -> city -> store -> sub-store. Platform admins are unbounded.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS branch_depth_limit integer DEFAULT 5;

CREATE OR REPLACE FUNCTION current_business_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE visible AS (
    -- Base: businesses the user directly owns or works at.
    SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth
    FROM businesses b
    WHERE lower(b.email) = lower(auth.email())
    UNION
    SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth
    FROM businesses b
    INNER JOIN staff s ON s.business_id = b.id
    WHERE lower(s.email) = lower(auth.email()) AND s.status = 'active'

    UNION ALL

    -- Recursive: children of anything we can already see, while the level
    -- counter stays under that business's depth limit.
    SELECT child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1
    FROM businesses child
    INNER JOIN visible ON child.parent_business_id = visible.id
    WHERE visible.depth < visible.branch_depth_limit
  )
  SELECT DISTINCT id FROM visible
$$;
