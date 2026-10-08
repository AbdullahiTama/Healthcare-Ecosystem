-- Feature 5 — receipt size + clarity
-- business_settings gains a thermal-receipt width so printed receipts fit
-- 58mm (portable) or 80mm (counter) printers. Existing rows default to 80mm.
ALTER TABLE public.business_settings
  ADD COLUMN receipt_width text NOT NULL DEFAULT '80'
  CHECK (receipt_width IN ('58', '80'));