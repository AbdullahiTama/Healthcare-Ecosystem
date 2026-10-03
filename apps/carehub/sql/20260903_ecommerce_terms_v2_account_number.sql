-- ============================================================================
-- E-commerce Terms v2 (simplified) + Account Number field
-- Status: READY — apply via Supabase SQL editor / MCP
--
-- Changes:
--  1. Deactivate v1 terms, insert v2 with simplified vendor-friendly text
--  2. Add account_number column to ecommerce_applications
-- ============================================================================

-- 1. Deactivate v1 terms
UPDATE ecommerce_terms SET is_active = false, updated_at = now() WHERE version = 'v1' AND is_active = true;

-- 2. Insert v2 simplified terms (idempotent)
DO $$
BEGIN
  -- Retail v2
  IF NOT EXISTS (SELECT 1 FROM ecommerce_terms WHERE segment='retail' AND version='v2') THEN
    INSERT INTO ecommerce_terms (segment, version, title, commission_rate, commission_label, content) VALUES (
      'retail','v2',
      'Retail E-commerce Terms & Conditions',
      0.10,
      '10% commission on each sale',
      E'Welcome to CareFind E-commerce. These terms apply to you as a retail vendor on CareFind.\n\n1. Your Products\nYou may list products your business is authorised and able to sell. Products must be genuine, correctly described and available for sale. Each product must be completed and activated before it appears in the public Shop.\n\n2. CareFind Commission\nCareFind charges a 10% commission on each applicable sale. The commission is deducted from the amount due to your business after the order is processed.\n\n3. When You Receive an Order\nWhen a customer places an order, you are expected to confirm and prepare the product promptly. Only accept orders you can supply.\n\n4. Pickup and Delivery\nDepending on the order and customer location, the customer may collect directly from your location. Where necessary, you may be asked to take or send the product to a nearby designated CareFind Pickup Station. For multi-vendor orders, products from different vendors may be brought to the same designated Pickup Station for consolidation, final packaging and dispatch to the customer.\n\n5. Your Responsibility\nYou are responsible for the accuracy, quality, availability and lawful sale of your products. Keep product and stock information reasonably up to date.\n\n6. Customer Issues\nIf a customer reports a problem, CareFind may contact you to resolve it. Where a cancellation, refund or other remedy is required under applicable CareFind policies, you are expected to cooperate.\n\n7. Platform Rules\nCareFind may remove a product, pause its sale or restrict E-commerce access where there is a serious or repeated problem with product quality, accuracy, fulfilment, customer service or compliance with applicable rules.\n\n8. Agreement\nBy selecting "I Agree" and submitting your E-commerce application, you confirm that you have read and understood these terms and agree to follow them while using CareFind E-commerce.'
    );
  END IF;

  -- Wholesale v2
  IF NOT EXISTS (SELECT 1 FROM ecommerce_terms WHERE segment='wholesale' AND version='v2') THEN
    INSERT INTO ecommerce_terms (segment, version, title, commission_rate, commission_label, content) VALUES (
      'wholesale','v2',
      'Wholesale E-commerce Terms & Conditions',
      0.05,
      '5% commission on each sale',
      E'Welcome to CareFind E-commerce. These terms apply to you as a wholesale vendor on CareFind.\n\n1. Your Products\nYou may list products your business is authorised and able to sell. Products must be genuine, correctly described and available for sale. Each product must be completed and activated before it appears in the public Shop.\n\n2. CareFind Commission\nCareFind charges a 5% commission on each applicable sale. The commission is deducted from the amount due to your business after the order is processed.\n\n3. When You Receive an Order\nWhen a customer places an order, you are expected to confirm and prepare the product promptly. Only accept orders you can supply.\n\n4. Pickup and Delivery\nDepending on the order and customer location, the customer may collect directly from your location. Where necessary, you may be asked to take or send the product to a nearby designated CareFind Pickup Station. For multi-vendor orders, products from different vendors may be brought to the same designated Pickup Station for consolidation, final packaging and dispatch to the customer.\n\n5. Your Responsibility\nYou are responsible for the accuracy, quality, availability and lawful sale of your products. Keep product and stock information reasonably up to date.\n\n6. Customer Issues\nIf a customer reports a problem, CareFind may contact you to resolve it. Where a cancellation, refund or other remedy is required under applicable CareFind policies, you are expected to cooperate.\n\n7. Platform Rules\nCareFind may remove a product, pause its sale or restrict E-commerce access where there is a serious or repeated problem with product quality, accuracy, fulfilment, customer service or compliance with applicable rules.\n\n8. Agreement\nBy selecting "I Agree" and submitting your E-commerce application, you confirm that you have read and understood these terms and agree to follow them while using CareFind E-commerce.'
    );
  END IF;

  -- Distributor v2
  IF NOT EXISTS (SELECT 1 FROM ecommerce_terms WHERE segment='distributor' AND version='v2') THEN
    INSERT INTO ecommerce_terms (segment, version, title, commission_rate, commission_label, content) VALUES (
      'distributor','v2',
      'Distributor E-commerce Terms & Conditions',
      0.025,
      '2.5% commission on each sale',
      E'Welcome to CareFind E-commerce. These terms apply to you as a distributor vendor on CareFind.\n\n1. Your Products\nYou may list products your business is authorised and able to sell. Products must be genuine, correctly described and available for sale. Each product must be completed and activated before it appears in the public Shop.\n\n2. CareFind Commission\nCareFind charges a 2.5% commission on each applicable sale. The commission is deducted from the amount due to your business after the order is processed.\n\n3. When You Receive an Order\nWhen a customer places an order, you are expected to confirm and prepare the product promptly. Only accept orders you can supply.\n\n4. Pickup and Delivery\nDepending on the order and customer location, the customer may collect directly from your location. Where necessary, you may be asked to take or send the product to a nearby designated CareFind Pickup Station. For multi-vendor orders, products from different vendors may be brought to the same designated Pickup Station for consolidation, final packaging and dispatch to the customer.\n\n5. Your Responsibility\nYou are responsible for the accuracy, quality, availability and lawful sale of your products. Keep product and stock information reasonably up to date.\n\n6. Customer Issues\nIf a customer reports a problem, CareFind may contact you to resolve it. Where a cancellation, refund or other remedy is required under applicable CareFind policies, you are expected to cooperate.\n\n7. Platform Rules\nCareFind may remove a product, pause its sale or restrict E-commerce access where there is a serious or repeated problem with product quality, accuracy, fulfilment, customer service or compliance with applicable rules.\n\n8. Agreement\nBy selecting "I Agree" and submitting your E-commerce application, you confirm that you have read and understood these terms and agree to follow them while using CareFind E-commerce.'
    );
  END IF;
END $$;

-- 3. Add account_number column to ecommerce_applications
ALTER TABLE ecommerce_applications ADD COLUMN IF NOT EXISTS account_number text;

-- Verify after applying:
-- select segment, version, title, commission_rate, is_active from ecommerce_terms order by segment, version;
-- select column_name, data_type from information_schema.columns where table_name='ecommerce_applications' and column_name='account_number';
