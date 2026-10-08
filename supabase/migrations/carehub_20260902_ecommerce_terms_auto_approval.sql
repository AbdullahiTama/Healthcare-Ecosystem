-- ============================================================================
-- E-commerce Mandatory Terms, Segment Commission & Auto-Approval Gate
-- Spec: _bmad-output/implementation-artifacts/spec-ecommerce-terms-mandatory-approval.md
-- Status: READY — apply via Supabase SQL editor / MCP
--
-- Changes:
--  1. Versioned ecommerce_terms per segment (retail 10%, wholesale 5%, distributor 2.5%)
--  2. Audit columns on ecommerce_applications (segment, terms_version_id, rates, timestamps)
--  3. Helpers resolve_ecommerce_segment + is_ecommerce_vendor_approved + image check
--  4. Tighten ecommerce_products / ecommerce_product_images WRITE gates to Approved only
-- ============================================================================

-- 1. Terms table (versioned per segment)
CREATE TABLE IF NOT EXISTS ecommerce_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment text NOT NULL CHECK (segment IN ('retail','wholesale','distributor')),
  version text NOT NULL,
  title text NOT NULL,
  content text NOT NULL CHECK (char_length(trim(content)) > 0),
  commission_rate numeric NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 1),
  commission_label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (segment, version)
);
CREATE INDEX IF NOT EXISTS idx_ecommerce_terms_segment_active ON ecommerce_terms(segment) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ecommerce_terms_segment ON ecommerce_terms(segment);

-- updated_at trigger for ecommerce_terms
DROP TRIGGER IF EXISTS trg_ecommerce_terms_updated_at ON ecommerce_terms;
CREATE TRIGGER trg_ecommerce_terms_updated_at
  BEFORE UPDATE ON ecommerce_terms
  FOR EACH ROW EXECUTE FUNCTION public.update_ecommerce_updated_at();

-- RLS for ecommerce_terms — readable by authenticated tenants (terms must be shown before apply), service_role unrestricted
-- Only active terms are readable by anon/authenticated; inactive versions stay admin-only
ALTER TABLE ecommerce_terms ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ecommerce_terms' AND policyname='ecommerce_terms tenant read') THEN
    CREATE POLICY "ecommerce_terms tenant read" ON ecommerce_terms FOR SELECT
      USING (is_active = true);
  END IF;
END $$;

-- Seed 3 active terms (idempotent — insert only if segment not yet seeded)
DO $$
DECLARE
  v_retail_id uuid;
  v_wholesale_id uuid;
  v_distributor_id uuid;
BEGIN
  -- Retail 10%
  IF NOT EXISTS (SELECT 1 FROM ecommerce_terms WHERE segment='retail' AND version='v1') THEN
    INSERT INTO ecommerce_terms (segment, version, title, commission_rate, commission_label, content) VALUES (
      'retail','v1',
      'Retail E-commerce Terms & Conditions — CareHub & CareFind Shop',
      0.10,
      '10% of sale (vendor-paid, deducted from vendor payout)',
      E'RETAIL E-COMMERCE TERMS & CONDITIONS\nVersion: v1 | Segment: Retail | Commission: 10%\nApplicable to: Pharmacies, Hospitals, Clinics, Laboratories, Imaging Centres, Wellness and other retail healthcare businesses.\n\n1. COMMISSION & COMMERCIAL OBLIGATION\n1.1 Retail E-commerce commission is 10% of the applicable sale/product value.\n1.2 Commission is paid by the vendor and deducted from the vendor payout before any other adjustments.\n1.3 Example: ₦5,000 sale → ₦500 commission → ₦4,500 vendor payout before any other applicable adjustments.\n1.4 The commission rate is required under the current pricing model and is disclosed here before acceptance.\n1.5 Customer fulfilment and optional delivery fees are separate customer charges under the applicable Retail pricing rules and are not part of commission.\n1.6 The vendor authorises CareHub to deduct the 10% commission from each eligible Shop order total at settlement.\n\n2. SELLER OBLIGATIONS\n2.1 Vendor must maintain accurate product information (description ≥10 chars, correct category, valid price,warnings where required).\n2.2 Vendor must upload at least one valid product image (JPEG/PNG/WebP/GIF ≤5MB) per product and keep images truthful.\n2.3 Vendor must comply with product, labelling and regulatory compliance requirements applicable to retail healthcare goods.\n\n3. FULFILMENT & OPERATIONS\n3.1 Vendor is responsible for timely fulfilment, accurate stock, and order communication via Shop order messages.\n3.2 Vendor must not list out-of-stock, expired, recalled or restricted products.\n\n4. CANCELLATION, REFUND & COMPLIANCE\n4.1 Cancellations and refunds follow the applicable Shop cancellation/refund policy displayed at checkout.\n4.2 Vendor must comply with applicable consumer protection, healthcare, and data protection obligations.\n4.3 Restricted products (compliance-flagged) cannot be activated or sold via Shop.\n\n5. ACTIVATION & VISIBILITY\n5.1 Business approval unlocks E-commerce product setup only; it does not automatically publish any product.\n5.2 Each product requires completion of mandatory fields + image + explicit activation before Shop visibility.\n5.3 Vendor payout reports will itemise commission per order.\n\n6. ACCEPTANCE\n6.1 By checking "I have read, understood and agree to the Terms & Conditions applicable to my E-commerce business segment" and clicking Apply, the vendor accepts these Retail Terms version v1 at 10% commission.'
    );
  END IF;
  -- Wholesale 5%
  IF NOT EXISTS (SELECT 1 FROM ecommerce_terms WHERE segment='wholesale' AND version='v1') THEN
    INSERT INTO ecommerce_terms (segment, version, title, commission_rate, commission_label, content) VALUES (
      'wholesale','v1',
      'Wholesale E-commerce Terms & Conditions — CareHub & CareFind Shop',
      0.05,
      '5% of sale (vendor-paid, deducted from vendor payout)',
      E'WHOLESALE E-COMMERCE TERMS & CONDITIONS\nVersion: v1 | Segment: Wholesale | Commission: 5%\nApplicable to: Wholesale businesses.\n\n1. COMMISSION & COMMERCIAL OBLIGATION\n1.1 Wholesale E-commerce commission is 5% of the applicable sale/product value.\n1.2 Commission is paid by the vendor and deducted from the vendor payout.\n1.3 The 5% rate is disclosed here before acceptance and is deducted from vendor payout per order.\n1.4 Customer fulfilment and optional delivery fees are separate customer charges under the applicable Wholesale pricing rules.\n1.5 Vendor authorises deduction of 5% per eligible Shop order.\n\n2. SELLER OBLIGATIONS\n2.1 Vendor must provide accurate product information, correct wholesale pack/carton details, description ≥10 chars, valid category and price.\n2.2 At least one valid product image is mandatory per product.\n2.3 Vendor must comply with applicable seller, product, labelling and wholesale distribution obligations.\n\n3. FULFILMENT & OPERATIONS\n3.1 Vendor must fulfil wholesale orders accurately, maintain pack quantities and stock fidelity.\n3.2 Vendor must not list restricted or out-of-stock products.\n\n4. CANCELLATION, REFUND & COMPLIANCE\n4.1 Cancellations/refunds per Shop policy and applicable wholesale commercial terms.\n4.2 Vendor must comply with applicable compliance, tax and regulatory requirements for wholesale trade.\n\n5. ACTIVATION & VISIBILITY\n5.1 Approval grants access to E-commerce setup; products require explicit activation before public Shop visibility.\n\n6. ACCEPTANCE\n6.1 Acceptance checkbox and Apply constitute agreement to these Wholesale Terms v1 at 5%.'
    );
  END IF;
  -- Distributor 2.5%
  IF NOT EXISTS (SELECT 1 FROM ecommerce_terms WHERE segment='distributor' AND version='v1') THEN
    INSERT INTO ecommerce_terms (segment, version, title, commission_rate, commission_label, content) VALUES (
      'distributor','v1',
      'Distributor E-commerce Terms & Conditions — CareHub & CareFind Shop',
      0.025,
      '2.5% of sale (vendor-paid, deducted from vendor payout)',
      E'DISTRIBUTOR E-COMMERCE TERMS & CONDITIONS\nVersion: v1 | Segment: Distributor | Commission: 2.5%\nApplicable to: Distributors, Manufacturers/Importers acting as distributors.\n\n1. COMMISSION & COMMERCIAL OBLIGATION\n1.1 Distributor E-commerce commission is 2.5% of the applicable sale/product value.\n1.2 Commission is paid by the vendor and deducted from the vendor payout.\n1.3 The 2.5% rate is disclosed here before acceptance.\n1.4 Customer fulfilment and optional delivery fees are separate customer charges under the applicable Distributor pricing rules.\n1.5 Vendor authorises deduction of 2.5% per eligible Shop order.\n\n2. SELLER OBLIGATIONS\n2.1 Vendor must maintain accurate distributor product information, description ≥10 chars, category, price, carton/bulk details.\n2.2 At least one valid product image is mandatory per product.\n2.3 Vendor must comply with applicable distribution, storage and compliance obligations.\n\n3. FULFILMENT & OPERATIONS\n3.1 Vendor must fulfil distributor orders with correct carton/bulk handling and traceability.\n\n4. CANCELLATION, REFUND & COMPLIANCE\n4.1 Per Shop cancellation/refund policy and Distributor commercial terms.\n4.2 Full compliance with applicable regulatory and distribution requirements.\n\n5. ACTIVATION\n5.1 Approval unlocks setup; individual product activation is still required.\n\n6. ACCEPTANCE\n6.1 Checkbox + Apply constitutes agreement to Distributor Terms v1 at 2.5%.'
    );
  END IF;
END $$;

-- 2. Audit columns on ecommerce_applications
ALTER TABLE ecommerce_applications ADD COLUMN IF NOT EXISTS segment text CHECK (segment IN ('retail','wholesale','distributor'));
ALTER TABLE ecommerce_applications ADD COLUMN IF NOT EXISTS terms_version_id uuid REFERENCES ecommerce_terms(id) ON DELETE SET NULL;
ALTER TABLE ecommerce_applications ADD COLUMN IF NOT EXISTS accepted_commission_rate numeric CHECK (accepted_commission_rate IS NULL OR (accepted_commission_rate >= 0 AND accepted_commission_rate <= 1));
ALTER TABLE ecommerce_applications ADD COLUMN IF NOT EXISTS applicant_user_id uuid;
ALTER TABLE ecommerce_applications ADD COLUMN IF NOT EXISTS acceptance_timestamp timestamptz;
ALTER TABLE ecommerce_applications ADD COLUMN IF NOT EXISTS approval_timestamp timestamptz;
ALTER TABLE ecommerce_applications ADD COLUMN IF NOT EXISTS audit_metadata jsonb;

CREATE INDEX IF NOT EXISTS idx_ecommerce_applications_terms_version ON ecommerce_applications(terms_version_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_applications_segment ON ecommerce_applications(segment);

-- 3. Helpers

-- Resolve segment from CareHub business_type (pure mapping, no lookup)
CREATE OR REPLACE FUNCTION public.resolve_ecommerce_segment(p_business_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(trim(coalesce(p_business_type,''))) = 'wholesale' THEN 'wholesale'
    WHEN lower(trim(coalesce(p_business_type,''))) = 'manufacturer_importer' THEN 'distributor'
    ELSE 'retail'
  END
$$;

-- Already exists from shop_conformance_v2; refresh to ensure correct owner/search_path and grants
CREATE OR REPLACE FUNCTION public.is_ecommerce_vendor_approved(p_business_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM ecommerce_applications WHERE business_id = p_business_id AND status = 'Approved'); $$;
REVOKE ALL ON FUNCTION public.is_ecommerce_vendor_approved(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ecommerce_vendor_approved(uuid) TO anon, authenticated, service_role;

-- Image helper: does the parent product's business have Approved status?
CREATE OR REPLACE FUNCTION public.is_ecommerce_image_vendor_approved(p_ecommerce_product_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ecommerce_products ep
    JOIN ecommerce_applications ea ON ea.business_id = ep.business_id AND ea.status = 'Approved'
    WHERE ep.id = p_ecommerce_product_id
  )
$$;
REVOKE ALL ON FUNCTION public.is_ecommerce_image_vendor_approved(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ecommerce_image_vendor_approved(uuid) TO anon, authenticated, service_role;

-- Optional: hard trigger gate for ecommerce_products (defense in depth — RLS is primary)
CREATE OR REPLACE FUNCTION public.guard_ecommerce_products_approved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_ecommerce_vendor_approved(NEW.business_id) THEN
    RAISE EXCEPTION 'E_COMMERCE_NOT_APPROVED: E-commerce application required. Please review and accept the applicable Terms & Conditions and apply for E-commerce access before setting up products.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_ecommerce_products_approved ON ecommerce_products;
CREATE TRIGGER trg_guard_ecommerce_products_approved
  BEFORE INSERT OR UPDATE ON ecommerce_products
  FOR EACH ROW EXECUTE FUNCTION public.guard_ecommerce_products_approved();

CREATE OR REPLACE FUNCTION public.guard_ecommerce_images_approved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_ecommerce_image_vendor_approved(NEW.ecommerce_product_id) THEN
    RAISE EXCEPTION 'E_COMMERCE_NOT_APPROVED: E-commerce application required. Please review and accept the applicable Terms & Conditions and apply for E-commerce access before setting up products.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_ecommerce_images_approved ON ecommerce_product_images;
CREATE TRIGGER trg_guard_ecommerce_images_approved
  BEFORE INSERT OR UPDATE ON ecommerce_product_images
  FOR EACH ROW EXECUTE FUNCTION public.guard_ecommerce_images_approved();

-- 4. Tighten RLS WRITE gates (tenant write must also be Approved)
-- We keep the USING (visibility) as tenant check but tighten WITH CHECK to require Approved.
-- For ecommerce_products: replace tenant write policy if it exists without Approved check
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ecommerce_products' AND policyname='ecommerce_products tenant write') THEN
    DROP POLICY "ecommerce_products tenant write" ON ecommerce_products;
  END IF;
  CREATE POLICY "ecommerce_products tenant write" ON ecommerce_products
    FOR ALL
    USING ((business_id IN (SELECT current_business_ids()) OR is_platform_admin()) AND (public.is_ecommerce_vendor_approved(business_id) OR is_platform_admin()))
    WITH CHECK ((business_id IN (SELECT current_business_ids()) OR is_platform_admin()) AND (public.is_ecommerce_vendor_approved(business_id) OR is_platform_admin()));
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ecommerce_product_images' AND policyname='ecommerce_product_images tenant write') THEN
    DROP POLICY "ecommerce_product_images tenant write" ON ecommerce_product_images;
  END IF;
  CREATE POLICY "ecommerce_product_images tenant write" ON ecommerce_product_images
    FOR ALL
    USING ((ecommerce_product_id IN (SELECT id FROM ecommerce_products WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin())) AND (public.is_ecommerce_image_vendor_approved(ecommerce_product_id) OR is_platform_admin()))
    WITH CHECK (
      ecommerce_product_id IN (SELECT id FROM ecommerce_products WHERE business_id IN (SELECT current_business_ids()) OR is_platform_admin())
      AND (public.is_ecommerce_image_vendor_approved(ecommerce_product_id) OR is_platform_admin())
    );
END $$;

-- Additional DELETE triggers (RLS USING already covers DELETE, but keep defense-in-depth)
CREATE OR REPLACE FUNCTION public.guard_ecommerce_products_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF is_platform_admin() THEN RETURN OLD; END IF;
  IF NOT public.is_ecommerce_vendor_approved(OLD.business_id) THEN
    RAISE EXCEPTION 'E_COMMERCE_NOT_APPROVED: E-commerce application required. Please review and accept the applicable Terms & Conditions and apply for E-commerce access before setting up products.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_ecommerce_products_delete ON ecommerce_products;
CREATE TRIGGER trg_guard_ecommerce_products_delete BEFORE DELETE ON ecommerce_products FOR EACH ROW EXECUTE FUNCTION public.guard_ecommerce_products_delete();

CREATE OR REPLACE FUNCTION public.guard_ecommerce_images_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_pid uuid;
BEGIN
  IF is_platform_admin() THEN RETURN OLD; END IF;
  SELECT ecommerce_product_id INTO v_pid FROM (SELECT OLD.ecommerce_product_id AS ecommerce_product_id) s;
  IF NOT public.is_ecommerce_image_vendor_approved(OLD.ecommerce_product_id) THEN
    RAISE EXCEPTION 'E_COMMERCE_NOT_APPROVED: E-commerce application required. Please review and accept the applicable Terms & Conditions and apply for E-commerce access before setting up products.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_ecommerce_images_delete ON ecommerce_product_images;
CREATE TRIGGER trg_guard_ecommerce_images_delete BEFORE DELETE ON ecommerce_product_images FOR EACH ROW EXECUTE FUNCTION public.guard_ecommerce_images_delete();

-- Verify after applying:
-- select segment, version, commission_rate, is_active from ecommerce_terms where is_active order by segment;
-- select public.resolve_ecommerce_segment('wholesale'), public.resolve_ecommerce_segment('manufacturer_importer'), public.resolve_ecommerce_segment('pharmacy');
-- select count(*) from ecommerce_applications;
