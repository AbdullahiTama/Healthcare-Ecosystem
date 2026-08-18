-- Add expiry_date column to products table
-- Nullable: existing products don't have expiry until set
-- Indexed for expiry queries (batches within 60 days)

ALTER TABLE products ADD COLUMN expiry_date TIMESTAMPTZ;

-- Comment to document the column purpose
COMMON ON COLUMN products.expiry_date IS 'Expiry date of the product (tracked per-batch via stock_batches, also stored on product for quick reference)';