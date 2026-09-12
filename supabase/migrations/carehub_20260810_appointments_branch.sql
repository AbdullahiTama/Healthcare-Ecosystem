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
