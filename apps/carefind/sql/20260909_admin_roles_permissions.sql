-- 20260909_admin_roles_permissions.sql
-- Custom role & permission management for CareFind Admin.
-- Mirrors the CareHub pattern: custom roles with feature-level permissions,
-- enforced at the access/data level (not just UI hiding).

-- ============================================================================
-- 1. admin_roles — custom role definitions
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the built-in system roles (cannot be deleted or renamed by admins).
-- These match the existing hardcoded roles so the migration is non-breaking.
INSERT INTO admin_roles (name, description, is_system) VALUES
  ('super_admin', 'Full platform access — manages all features, staff and roles', true),
  ('moderator', 'Content moderation — posts, reports, stories, news', true),
  ('verification_officer', 'Professional verification requests and appointments', true),
  ('business_manager', 'Business claims and company directory', true),
  ('support_agent', 'User support and notification monitoring', true),
  ('analytics_manager', 'Revenue, withdrawals, search analytics and reports', true)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- 2. admin_role_permissions — feature-level permission checklist per role
--    permissions is a jsonb object: { "tab_key": true, ... }
--    where tab_key matches the AdminPanel TABS keys.
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role_id)
);

-- Seed default permissions for system roles.
-- super_admin gets everything; other roles get their traditional sections.
INSERT INTO admin_role_permissions (role_id, permissions)
SELECT r.id, CASE r.name
  WHEN 'super_admin' THEN '{"overview":true,"verifications":true,"claims":true,"reports":true,"users":true,"posts":true,"revenue":true,"drugs":true,"tasks":true,"teams":true,"withdrawals":true,"businesses":true,"stories":true,"news":true,"promotions":true,"searches":true,"golive":true,"notifications":true,"shop":true}'::jsonb
  WHEN 'moderator' THEN '{"overview":true,"reports":true,"posts":true,"stories":true,"news":true,"notifications":true}'::jsonb
  WHEN 'verification_officer' THEN '{"overview":true,"verifications":true,"notifications":true}'::jsonb
  WHEN 'business_manager' THEN '{"overview":true,"claims":true,"businesses":true,"notifications":true}'::jsonb
  WHEN 'support_agent' THEN '{"overview":true,"users":true,"notifications":true}'::jsonb
  WHEN 'analytics_manager' THEN '{"overview":true,"revenue":true,"withdrawals":true,"searches":true,"businesses":true,"notifications":true}'::jsonb
END
FROM admin_roles r
WHERE r.is_system = true
ON CONFLICT (role_id) DO NOTHING;

-- ============================================================================
-- 3. Extend admin_users with role_id FK (nullable for backward compat)
--    The existing `role` text column is retained for backward compatibility;
--    `role_id` is the new canonical reference.
-- ============================================================================
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES admin_roles(id) ON DELETE SET NULL;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS custom_permissions jsonb DEFAULT NULL;

-- Backfill role_id for existing admin users based on their text role column.
UPDATE admin_users au
SET role_id = ar.id
FROM admin_roles ar
WHERE ar.name = au.role
  AND au.role_id IS NULL;

-- ============================================================================
-- 4. RLS — deny-all for anon/authenticated, service-role only (same as
--    the existing admin_users/admin_teams hardening from 20260815).
-- ============================================================================
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_role_permissions ENABLE ROW LEVEL SECURITY;

-- No policies = deny-all for anon/authenticated. Service-role bypasses RLS.

-- ============================================================================
-- 5. Helper: get_admin_permissions(p_admin_id uuid)
--    Returns the effective permissions jsonb for an admin user.
--    Super admins always get all features regardless of role config.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_admin_permissions(p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_role_id uuid;
  v_perms jsonb;
BEGIN
  SELECT role, role_id INTO v_role, v_role_id
  FROM admin_users WHERE id = p_admin_id;

  IF v_role = 'super_admin' THEN
    RETURN '{"overview":true,"verifications":true,"claims":true,"reports":true,"users":true,"posts":true,"revenue":true,"drugs":true,"tasks":true,"teams":true,"withdrawals":true,"businesses":true,"stories":true,"news":true,"promotions":true,"searches":true,"golive":true,"notifications":true,"shop":true}'::jsonb;
  END IF;

  IF v_role_id IS NOT NULL THEN
    SELECT permissions INTO v_perms
    FROM admin_role_permissions
    WHERE role_id = v_role_id;

    IF v_perms IS NOT NULL THEN
      RETURN v_perms;
    END IF;
  END IF;

  RETURN '{}'::jsonb;
END;
$$;

-- ACL: only service_role and owner can execute (not anon, not authenticated).
REVOKE EXECUTE ON FUNCTION get_admin_permissions(uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 6. updated_at trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION admin_roles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_roles_updated_at ON admin_roles;
CREATE TRIGGER trg_admin_roles_updated_at
  BEFORE UPDATE ON admin_roles
  FOR EACH ROW EXECUTE FUNCTION admin_roles_updated_at();

DROP TRIGGER IF EXISTS trg_admin_role_permissions_updated_at ON admin_role_permissions;
CREATE TRIGGER trg_admin_role_permissions_updated_at
  BEFORE UPDATE ON admin_role_permissions
  FOR EACH ROW EXECUTE FUNCTION admin_role_permissions_updated_at();
