-- CareFind Hub: Business Directory Tables
-- Migration: carefind_20261001_business_directory_tables.sql
-- Purpose: Create core business directory tables

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =====================================================
-- Table: business_categories
-- Purpose: Category management for businesses
-- =====================================================
CREATE TABLE IF NOT EXISTS business_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  icon TEXT,
  color TEXT DEFAULT '#3b82f6',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_business_categories_updated_at
BEFORE UPDATE ON business_categories
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Table: business_subcategories
-- Purpose: Subcategory hierarchy for businesses
-- =====================================================
CREATE TABLE IF NOT EXISTS business_subcategories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES business_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(category_id, slug)
);

CREATE TRIGGER update_business_subcategories_updated_at
BEFORE UPDATE ON business_subcategories
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Table: business_import_batches
-- Purpose: Track CSV/Excel import batches
-- Must be created before business_directory (FK reference)
-- =====================================================
CREATE TABLE IF NOT EXISTS business_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  file_url TEXT,
  total_records INTEGER,
  successful_records INTEGER DEFAULT 0,
  duplicate_records INTEGER DEFAULT 0,
  invalid_records INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  imported_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  CONSTRAINT valid_import_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

-- =====================================================
-- Table: business_directory
-- Purpose: Core business records
-- =====================================================
CREATE TABLE IF NOT EXISTS business_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic Info
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  
  -- Classification
  category_id UUID REFERENCES business_categories(id),
  subcategory_id UUID REFERENCES business_subcategories(id),
  business_type TEXT,
  
  -- Location
  address TEXT,
  state TEXT,
  lga TEXT,
  city TEXT,
  area TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  location GEOGRAPHY(POINT, 4326),
  
  -- Contact
  phone TEXT,
  email TEXT,
  website TEXT,
  whatsapp TEXT,
  contact_person TEXT,
  
  -- Business Details
  opening_hours JSONB DEFAULT '{}'::jsonb,
  description TEXT,
  logo_url TEXT,
  cover_url TEXT,
  
  -- Verification
  verification_status TEXT DEFAULT 'unverified',
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id),
  
  -- Data Management
  data_source TEXT DEFAULT 'manual',
  import_batch_id UUID REFERENCES business_import_batches(id),
  legacy_id UUID,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  
  -- Constraints
  CONSTRAINT valid_verification_status 
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  CONSTRAINT valid_data_source 
    CHECK (data_source IN ('manual', 'import', 'api', 'crowdsourced'))
);

CREATE TRIGGER update_business_directory_updated_at
BEFORE UPDATE ON business_directory
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- Table: business_verification
-- Purpose: Verification workflow for businesses
-- =====================================================
CREATE TABLE IF NOT EXISTS business_verification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES business_directory(id) ON DELETE CASCADE,
  verifier_id UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL,
  notes TEXT,
  evidence_url TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT valid_verification_action CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- =====================================================
-- Table: business_import_errors
-- Purpose: Track errors during import
-- =====================================================
CREATE TABLE IF NOT EXISTS business_import_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES business_import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  field_name TEXT,
  raw_data JSONB,
  suggested_fix TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT valid_error_type 
    CHECK (error_type IN ('validation', 'duplicate', 'format', 'required', 'unknown'))
);

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Business Directory tables created successfully';
END $$;
