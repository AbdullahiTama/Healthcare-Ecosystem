-- LEDGER STATUS: APPLIED (by reconciliation). Recorded under this name by the 2026-10-15 ledger reconciliation
--   (version 202608109001), which checked this file's objects against production (all present, or later
--   superseded) and did not re-run the file; see apps/docs/architecture/Migration-Drift-Audit.md.
--   Checked against the live ledger 2026-11-02 (planning/CODE_AUDIT.md A3). Any status wording further down predates this and is kept as written.
--
-- ============================================================================
-- Appointments branch_id
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql.
--
-- Appointments are already scoped by business_id, and in the branch-as-business
-- model each branch IS a business_id. Adding branch_id as an explicit,
-- denormalized column lets the owner's cross-branch appointment query filter
-- by a single id without joining back to businesses. It is kept in sync with
-- business_id by the application layer (the appointment repository).
-- ============================================================================

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES businesses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_branch ON appointments(branch_id);
