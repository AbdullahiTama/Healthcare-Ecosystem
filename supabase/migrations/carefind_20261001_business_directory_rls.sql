-- CareFind Hub: Business Directory RLS Policies
-- Migration: carefind_20261001_business_directory_rls.sql
-- Purpose: Enable Row Level Security policies

-- =====================================================
-- Business Directory RLS
-- =====================================================
ALTER TABLE business_directory ENABLE ROW LEVEL SECURITY;

-- Anyone can read active businesses
CREATE POLICY business_directory_select ON business_directory
  FOR SELECT
  USING (is_active = true);

-- Admins can insert businesses
CREATE POLICY business_directory_insert ON business_directory
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

-- Admins can update businesses
CREATE POLICY business_directory_update ON business_directory
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

-- Admins can delete businesses
CREATE POLICY business_directory_delete ON business_directory
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

-- =====================================================
-- Business Categories RLS
-- =====================================================
ALTER TABLE business_categories ENABLE ROW LEVEL SECURITY;

-- Anyone can read categories
CREATE POLICY business_categories_select ON business_categories
  FOR SELECT
  USING (true);

-- Admins can manage categories
CREATE POLICY business_categories_insert ON business_categories
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY business_categories_update ON business_categories
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY business_categories_delete ON business_categories
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

-- =====================================================
-- Business Subcategories RLS
-- =====================================================
ALTER TABLE business_subcategories ENABLE ROW LEVEL SECURITY;

-- Anyone can read subcategories
CREATE POLICY business_subcategories_select ON business_subcategories
  FOR SELECT
  USING (true);

-- Admins can manage subcategories
CREATE POLICY business_subcategories_insert ON business_subcategories
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY business_subcategories_update ON business_subcategories
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY business_subcategories_delete ON business_subcategories
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

-- =====================================================
-- Business Verification RLS
-- =====================================================
ALTER TABLE business_verification ENABLE ROW LEVEL SECURITY;

-- Admins can verify businesses
CREATE POLICY business_verification_insert ON business_verification
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

-- Admins can read verification history
CREATE POLICY business_verification_select ON business_verification
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

-- =====================================================
-- Business Import Batches RLS
-- =====================================================
ALTER TABLE business_import_batches ENABLE ROW LEVEL SECURITY;

-- Admins can manage their import batches
CREATE POLICY business_import_batches_select ON business_import_batches
  FOR SELECT
  USING (
    imported_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY business_import_batches_insert ON business_import_batches
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY business_import_batches_update ON business_import_batches
  FOR UPDATE
  USING (
    imported_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'super_admin')
    )
  );

-- =====================================================
-- Business Import Errors RLS
-- =====================================================
ALTER TABLE business_import_errors ENABLE ROW LEVEL SECURITY;

-- Admins can read import errors
CREATE POLICY business_import_errors_select ON business_import_errors
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_import_batches bib
      WHERE bib.id = batch_id
        AND (
          bib.imported_by = auth.uid() OR
          EXISTS (
            SELECT 1 FROM admin_users
            WHERE id = auth.uid()
              AND is_active = true
              AND role IN ('admin', 'super_admin')
          )
        )
    )
  );

CREATE POLICY business_import_errors_insert ON business_import_errors
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_import_batches bib
      WHERE bib.id = batch_id
        AND (
          bib.imported_by = auth.uid() OR
          EXISTS (
            SELECT 1 FROM admin_users
            WHERE id = auth.uid()
              AND is_active = true
              AND role IN ('admin', 'super_admin')
          )
        )
    )
  );

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Business Directory RLS policies created successfully';
END $$;
