-- ============================================================================
-- Inter-branch stock transfers
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql.
--
-- The owner can move stock from one branch to another. The transfer starts as
-- 'pending' and the source branch manager must approve before stock actually
-- moves. On approval, the source branch's product quantity is decremented and
-- the destination's is incremented (handled by the application layer in a
-- single transaction). Rejection leaves both branches untouched.
--
-- This is a workflow table, not a stock ledger — the actual quantity changes
-- are written to the branch `products` table by the transfer service.
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_branch_id uuid NOT NULL REFERENCES businesses(id),
  to_branch_id uuid NOT NULL REFERENCES businesses(id),
  product_id uuid NOT NULL, -- references the source branch's products row
  product_name text NOT NULL DEFAULT '', -- snapshot at request time
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  requested_by uuid NOT NULL, -- owner who initiated
  approved_by uuid, -- source branch manager who approved/rejected
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON stock_transfers(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to ON stock_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(status);

-- RLS: both branches involved can see the transfer; owner sees all via
-- recursive current_business_ids().
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'stock_transfers' AND policyname = 'stock_transfers tenant visibility') THEN
    CREATE POLICY "stock_transfers tenant visibility" ON stock_transfers
    USING (from_branch_id IN (SELECT current_business_ids())
           OR to_branch_id IN (SELECT current_business_ids())
           OR is_platform_admin());
  END IF;
END $$;
