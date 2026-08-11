-- ============================================================================
-- Shared clients across branches with per-branch visit history
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql.
--
-- Each branch still owns its own row in `clients` (sales, debts, and
-- appointments are all scoped to business_id). To recognise that the same
-- person visits multiple branches, we add `global_client_id` — a self-
-- referential link pointing at the "primary" client row for that person.
--
-- `client_visits` records every interaction (sale, appointment, consultation)
-- tagged with the branch it happened at. The owner sees the unified visit
-- history; branch staff see their own visits plus a flag that the person
-- also visits elsewhere.
-- ============================================================================

-- Links a branch-local client row to the canonical global person. NULL means
-- "not yet linked" — the client exists at only one branch so far.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS global_client_id uuid REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_global ON clients(global_client_id);

-- Per-branch visit history for a global client. Each row is one interaction.
CREATE TABLE IF NOT EXISTS client_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  global_client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES businesses(id),
  visit_date date NOT NULL DEFAULT current_date,
  visit_type text NOT NULL DEFAULT 'consultation', -- 'consultation' | 'sale' | 'appointment' | 'other'
  reference_id uuid, -- points at the sale/appointment/consultation_forms row
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_visits_global ON client_visits(global_client_id);
CREATE INDEX IF NOT EXISTS idx_client_visits_branch ON client_visits(branch_id);

-- RLS: scoped by branch_id so each branch sees its own visits; the owner
-- sees all via the recursive current_business_ids().
ALTER TABLE client_visits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'client_visits' AND policyname = 'client_visits tenant visibility') THEN
    CREATE POLICY "client_visits tenant visibility" ON client_visits
    USING (branch_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
END $$;
