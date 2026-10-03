-- CareFind Hub: Business Directory Seed Data
-- Migration: carefind_20261001_business_directory_seed.sql
-- Purpose: Seed initial business categories

-- =====================================================
-- Business Categories
-- =====================================================
INSERT INTO business_categories (name, slug, icon, color, sort_order) VALUES
  ('Pharmacy', 'pharmacy', 'Pill', '#10b981', 1),
  ('Hospital', 'hospital', 'Hospital', '#ef4444', 2),
  ('Clinic', 'clinic', 'Stethoscope', '#3b82f6', 3),
  ('Medical Centre', 'medical-centre', 'Building2', '#8b5cf6', 4),
  ('Specialist Hospital', 'specialist-hospital', 'Heart', '#ec4899', 5),
  ('Primary Healthcare Centre', 'primary-healthcare', 'Home', '#06b6d4', 6),
  ('Diagnostic Centre', 'diagnostic-centre', 'Microscope', '#f59e0b', 7),
  ('Medical Laboratory', 'medical-laboratory', 'FlaskConical', '#14b8a6', 8),
  ('Imaging/Radiology Centre', 'imaging-radiology', 'Scan', '#6366f1', 9),
  ('Pharmaceutical Manufacturer', 'pharmaceutical-manufacturer', 'Factory', '#84cc16', 10),
  ('Pharmaceutical Distributor', 'pharmaceutical-distributor', 'Truck', '#a855f7', 11),
  ('Medical Equipment Company', 'medical-equipment', 'Wrench', '#f97316', 12),
  ('Aesthetic/Cosmetic Centre', 'aesthetic-cosmetic', 'Sparkles', '#d946ef', 13),
  ('Dental Clinic', 'dental-clinic', 'Smile', '#0ea5e9', 14),
  ('Eye Clinic/Optometry', 'eye-clinic', 'Eye', '#22c55e', 15),
  ('Physiotherapy/Rehabilitation', 'physiotherapy', 'Activity', '#eab308', 16),
  ('Maternity', 'maternity', 'Baby', '#f472b6', 17),
  ('Paediatric Centre', 'paediatric-centre', 'Child', '#34d399', 18),
  ('Cardiology Centre', 'cardiology-centre', 'HeartPulse', '#dc2626', 19),
  ('Fertility/IVF Centre', 'fertility-ivf-centre', 'Baby', '#a78bfa', 20),
  ('Gynecology Centre', 'gynecology-centre', 'Heart', '#fb7185', 21),
  ('Dermatology', 'dermatology', 'Scan', '#fbbf24', 22),
  ('Pharmaceutical Wholesaler', 'pharmaceutical-wholesaler', 'Package', '#818cf8', 23),
  ('Medical Equipment Supplier', 'medical-equipment-supplier', 'Package', '#fb923c', 24),
  ('Healthcare Supplier', 'healthcare-supplier', 'Package', '#4ade80', 25),
  ('Cosmetics Business', 'cosmetics-business', 'Sparkles', '#f472b6', 26),
  ('Other Healthcare-related Business', 'other-healthcare', 'MoreHorizontal', '#94a3b8', 27)
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- Business Subcategories (Examples)
-- =====================================================

-- Pharmacy subcategories
INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Community Pharmacy', 'community-pharmacy', 1
FROM business_categories WHERE name = 'Pharmacy'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Hospital Pharmacy', 'hospital-pharmacy', 2
FROM business_categories WHERE name = 'Pharmacy'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Online Pharmacy', 'online-pharmacy', 3
FROM business_categories WHERE name = 'Pharmacy'
ON CONFLICT (category_id, slug) DO NOTHING;

-- Hospital subcategories
INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'General Hospital', 'general-hospital', 1
FROM business_categories WHERE name = 'Hospital'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Teaching Hospital', 'teaching-hospital', 2
FROM business_categories WHERE name = 'Hospital'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Federal Hospital', 'federal-hospital', 3
FROM business_categories WHERE name = 'Hospital'
ON CONFLICT (category_id, slug) DO NOTHING;

-- Clinic subcategories
INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'General Clinic', 'general-clinic', 1
FROM business_categories WHERE name = 'Clinic'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Specialist Clinic', 'specialist-clinic', 2
FROM business_categories WHERE name = 'Clinic'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Walk-in Clinic', 'walkin-clinic', 3
FROM business_categories WHERE name = 'Clinic'
ON CONFLICT (category_id, slug) DO NOTHING;

-- Diagnostic Centre subcategories
INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Pathology Laboratory', 'pathology-laboratory', 1
FROM business_categories WHERE name = 'Diagnostic Centre'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Radiology Centre', 'radiology-centre', 2
FROM business_categories WHERE name = 'Diagnostic Centre'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Imaging Centre', 'imaging-centre', 3
FROM business_categories WHERE name = 'Diagnostic Centre'
ON CONFLICT (category_id, slug) DO NOTHING;

-- Pharmaceutical Manufacturer subcategories
INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Generic Drug Manufacturer', 'generic-drug-manufacturer', 1
FROM business_categories WHERE name = 'Pharmaceutical Manufacturer'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Branded Drug Manufacturer', 'branded-drug-manufacturer', 2
FROM business_categories WHERE name = 'Pharmaceutical Manufacturer'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Herbal Medicine Manufacturer', 'herbal-medicine-manufacturer', 3
FROM business_categories WHERE name = 'Pharmaceutical Manufacturer'
ON CONFLICT (category_id, slug) DO NOTHING;

-- Pharmaceutical Distributor subcategories
INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Wholesale Distributor', 'wholesale-distributor', 1
FROM business_categories WHERE name = 'Pharmaceutical Distributor'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Regional Distributor', 'regional-distributor', 2
FROM business_categories WHERE name = 'Pharmaceutical Distributor'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Last-mile Distributor', 'last-mile-distributor', 3
FROM business_categories WHERE name = 'Pharmaceutical Distributor'
ON CONFLICT (category_id, slug) DO NOTHING;

-- Medical Equipment subcategories
INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Equipment Manufacturer', 'equipment-manufacturer', 1
FROM business_categories WHERE name = 'Medical Equipment Company'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Equipment Supplier', 'equipment-supplier', 2
FROM business_categories WHERE name = 'Medical Equipment Company'
ON CONFLICT (category_id, slug) DO NOTHING;

INSERT INTO business_subcategories (category_id, name, slug, sort_order)
SELECT id, 'Equipment Rental', 'equipment-rental', 3
FROM business_categories WHERE name = 'Medical Equipment Company'
ON CONFLICT (category_id, slug) DO NOTHING;

-- Log completion
DO $$
DECLARE
  category_count INTEGER;
  subcategory_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO category_count FROM business_categories;
  SELECT COUNT(*) INTO subcategory_count FROM business_subcategories;
  RAISE NOTICE 'Business Directory seed data inserted: % categories, % subcategories', category_count, subcategory_count;
END $$;
