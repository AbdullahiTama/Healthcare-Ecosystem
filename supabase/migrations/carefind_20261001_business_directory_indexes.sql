-- CareFind Hub: Business Directory Indexes
-- Migration: carefind_20261001_business_directory_indexes.sql
-- Purpose: Create indexes for performance

-- =====================================================
-- Business Directory Indexes
-- =====================================================

-- Category filtering
CREATE INDEX IF NOT EXISTS idx_business_directory_category 
ON business_directory(category_id);

-- Geospatial queries (GiST index for ST_DWithin, <-> operator)
CREATE INDEX IF NOT EXISTS idx_business_directory_location 
ON business_directory USING GIST(location);

-- Fuzzy text search on normalized_name (GIN with pg_trgm)
CREATE INDEX IF NOT EXISTS idx_business_directory_name 
ON business_directory USING GIN(normalized_name gin_trgm_ops);

-- Location filtering (state, LGA)
CREATE INDEX IF NOT EXISTS idx_business_directory_state_lga 
ON business_directory(state, lga);

-- Verification status filtering
CREATE INDEX IF NOT EXISTS idx_business_directory_verification 
ON business_directory(verification_status);

-- Active status filtering (partial index for performance)
CREATE INDEX IF NOT EXISTS idx_business_directory_active 
ON business_directory(is_active) WHERE is_active = true;

-- Data source filtering
CREATE INDEX IF NOT EXISTS idx_business_directory_source 
ON business_directory(data_source);

-- Import batch lookup
CREATE INDEX IF NOT EXISTS idx_business_directory_import_batch 
ON business_directory(import_batch_id);

-- Legacy ID lookup (for linking to existing businesses table)
CREATE INDEX IF NOT EXISTS idx_business_directory_legacy 
ON business_directory(legacy_id) WHERE legacy_id IS NOT NULL;

-- Created timestamp for sorting
CREATE INDEX IF NOT EXISTS idx_business_directory_created 
ON business_directory(created_at DESC);

-- =====================================================
-- Business Categories Indexes
-- =====================================================

-- Slug lookup (already unique, but explicit index)
CREATE INDEX IF NOT EXISTS idx_business_categories_slug 
ON business_categories(slug);

-- Active categories
CREATE INDEX IF NOT EXISTS idx_business_categories_active 
ON business_categories(is_active) WHERE is_active = true;

-- Sort order
CREATE INDEX IF NOT EXISTS idx_business_categories_sort 
ON business_categories(sort_order);

-- =====================================================
-- Business Subcategories Indexes
-- =====================================================

-- Category lookup
CREATE INDEX IF NOT EXISTS idx_business_subcategories_category 
ON business_subcategories(category_id);

-- Slug lookup within category
CREATE INDEX IF NOT EXISTS idx_business_subcategories_slug 
ON business_subcategories(category_id, slug);

-- Active subcategories
CREATE INDEX IF NOT EXISTS idx_business_subcategories_active 
ON business_subcategories(is_active) WHERE is_active = true;

-- =====================================================
-- Business Verification Indexes
-- =====================================================

-- Business lookup
CREATE INDEX IF NOT EXISTS idx_business_verification_business 
ON business_verification(business_id);

-- Verifier lookup
CREATE INDEX IF NOT EXISTS idx_business_verification_verifier 
ON business_verification(verifier_id);

-- Status filtering
CREATE INDEX IF NOT EXISTS idx_business_verification_status 
ON business_verification(status);

-- =====================================================
-- Business Import Batches Indexes
-- =====================================================

-- Importer lookup
CREATE INDEX IF NOT EXISTS idx_business_import_batches_importer 
ON business_import_batches(imported_by);

-- Status filtering
CREATE INDEX IF NOT EXISTS idx_business_import_batches_status 
ON business_import_batches(status);

-- Created timestamp for sorting
CREATE INDEX IF NOT EXISTS idx_business_import_batches_created 
ON business_import_batches(created_at DESC);

-- =====================================================
-- Business Import Errors Indexes
-- =====================================================

-- Batch lookup
CREATE INDEX IF NOT EXISTS idx_business_import_errors_batch 
ON business_import_errors(batch_id);

-- Error type filtering
CREATE INDEX IF NOT EXISTS idx_business_import_errors_type 
ON business_import_errors(error_type);

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Business Directory indexes created successfully';
END $$;
