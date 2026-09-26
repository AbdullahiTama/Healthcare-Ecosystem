-- ============================================================================
-- Enable RLS on the `roles` table (custom business-defined roles)
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql.
--
-- Why: the `roles` table (business_id, name, permissions jsonb) is used by
-- the custom role feature in Staff.jsx. A live probe confirmed it currently
-- has NO RLS at all: the anon key can read and INSERT roles for ANY business,
-- including other companies' rows. Before the feature ships, the table must
-- be scoped the same way as staff/patients (phase2_rls_pilot.sql's
-- current_business_ids()/is_platform_admin() helpers — those functions
-- already exist in production, this file does not redefine them).
--
-- NOTE: the app writes through the real auth session (see
-- 20260802_backfill_confirmed_auth_users.sql), so owners/staff with a
-- session pass current_business_ids() by email match.
-- ============================================================================

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all roles" ON roles;
DROP POLICY IF EXISTS "roles of own business" ON roles;

CREATE POLICY "roles of own business" ON roles
  FOR ALL
  USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin())
  WITH CHECK (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
