-- ============================================================================
-- Master product catalog with branch activation
--
-- Status: NOT YET APPLIED — run via Supabase SQL editor / psql.
--
-- The owner maintains one canonical product list (master_products). Branches
-- "activate" the products they carry (branch_products). Each branch keeps its
-- own stock levels and may override the default price. Branches can also
-- create branch-only products that live in their own `products` table and do
-- not appear in the master catalog.
--
-- This separation lets the owner push a name/description/price change to every
-- branch that carries a product, while branches retain local control over
-- whether they stock it and what they charge.
-- ============================================================================

-- The owner's canonical product list. Scoped to the parent business — branches
-- do not own rows here.
CREATE TABLE IF NOT EXISTS master_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  description text DEFAULT '',
  category text DEFAULT '',
  default_price integer NOT NULL DEFAULT 0, -- kobo
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_products_business ON master_products(business_id);

-- Which branches carry which master products, with optional local price
-- override. Stock continues to live in the branch's own `products` table —
-- this table is the activation link + override layer only.
CREATE TABLE IF NOT EXISTS branch_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES businesses(id),
  master_product_id uuid NOT NULL REFERENCES master_products(id),
  active boolean NOT NULL DEFAULT true,
  override_price integer, -- kobo; NULL = inherit master default_price
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, master_product_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_products_branch ON branch_products(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_products_master ON branch_products(master_product_id);

-- RLS: owners see their master products; branches see activations for
-- their own business_id. Scoped exactly like every other tenant table.
ALTER TABLE master_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_products ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'master_products' AND policyname = 'master_products tenant visibility') THEN
    CREATE POLICY "master_products tenant visibility" ON master_products
    USING (business_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'branch_products' AND policyname = 'branch_products tenant visibility') THEN
    CREATE POLICY "branch_products tenant visibility" ON branch_products
    USING (branch_id IN (SELECT current_business_ids()) OR is_platform_admin());
  END IF;
END $$;
