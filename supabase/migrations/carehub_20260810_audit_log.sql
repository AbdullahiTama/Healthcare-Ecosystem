-- ============================================================================
-- Owner action audit log
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql.
--
-- When the owner operates inside a branch (recording a sale, adjusting stock,
-- editing a client), the action is recorded here with actor_type = 'owner'.
-- Branch managers can review the audit log for their branch to see what the
-- owner changed. This is the transparency mechanism that makes the owner's
-- full powers at a branch accountable.
--
-- This table is append-only. Nothing ever updates or deletes audit rows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL, -- the user who acted (owner or staff)
  actor_type text NOT NULL DEFAULT 'staff', -- 'owner' | 'staff'
  branch_id uuid NOT NULL REFERENCES businesses(id),
  action text NOT NULL, -- e.g. 'sale.created', 'stock.adjusted', 'client.updated'
  target_type text, -- 'sale' | 'product' | 'client' | 'appointment' | 'stock'
  target_id uuid, -- the row that was affected
  metadata jsonb DEFAULT '{}'::jsonb, -- before/after snapshot or context
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_branch ON audit_log(branch_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- RLS: branch members can read their branch's audit log; owner sees all.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_log' AND policyname = 'audit_log tenant visibility') THEN
    CREATE POLICY "audit_log tenant visibility" ON audit_log
    FOR SELECT USING (branch_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  -- Inserts are service-role only (the application writes audit rows on behalf
  -- of the acting user, never directly from the client).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_log' AND policyname = 'audit_log service insert') THEN
    CREATE POLICY "audit_log service insert" ON audit_log
    FOR INSERT WITH CHECK (is_platform_admin()); -- service role bypasses RLS anyway
  END IF;
END $$;
