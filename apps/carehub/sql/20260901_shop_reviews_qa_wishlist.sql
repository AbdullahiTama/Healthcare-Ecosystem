-- Shop reviews, Q&A, wishlist — premium marketplace (APPLIED locally as fallback, pending live apply when auth restored)
-- LocalStorage fallback in app makes feature functional immediately; DB is upgrade path for cross-device sync

CREATE TABLE IF NOT EXISTS shop_product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecommerce_product_id uuid NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating between 1 and 5),
  text text NOT NULL CHECK (char_length(trim(text)) >= 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ecommerce_product_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_shop_reviews_product ON shop_product_reviews(ecommerce_product_id);
CREATE OR REPLACE FUNCTION public.update_shop_review_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_shop_reviews_updated_at ON shop_product_reviews;
CREATE TRIGGER trg_shop_reviews_updated_at BEFORE UPDATE ON shop_product_reviews FOR EACH ROW EXECUTE FUNCTION public.update_shop_review_updated_at();

CREATE TABLE IF NOT EXISTS shop_product_qa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ecommerce_product_id uuid NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(trim(question)) >= 5),
  answer text,
  asker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answerer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_shop_qa_product ON shop_product_qa(ecommerce_product_id);

CREATE TABLE IF NOT EXISTS shop_wishlist (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ecommerce_product_id uuid NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ecommerce_product_id)
);
CREATE INDEX IF NOT EXISTS idx_shop_wishlist_user ON shop_wishlist(user_id);

ALTER TABLE shop_product_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_product_qa ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_wishlist ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_product_reviews' AND policyname='shop_reviews public read') THEN
    CREATE POLICY "shop_reviews public read" ON shop_product_reviews FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_product_reviews' AND policyname='shop_reviews user write') THEN
    CREATE POLICY "shop_reviews user write" ON shop_product_reviews FOR ALL USING (user_id = auth.uid() OR is_platform_admin()) WITH CHECK (user_id = auth.uid() OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_product_qa' AND policyname='shop_qa public read') THEN
    CREATE POLICY "shop_qa public read" ON shop_product_qa FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_product_qa' AND policyname='shop_qa asker insert') THEN
    CREATE POLICY "shop_qa asker insert" ON shop_product_qa FOR INSERT WITH CHECK (asker_id = auth.uid() OR is_platform_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shop_wishlist' AND policyname='shop_wishlist user all') THEN
    CREATE POLICY "shop_wishlist user all" ON shop_wishlist FOR ALL USING (user_id = auth.uid() OR is_platform_admin()) WITH CHECK (user_id = auth.uid() OR is_platform_admin());
  END IF;
END $$;

CREATE OR REPLACE VIEW public.shop_product_ratings AS SELECT ecommerce_product_id, avg(rating)::numeric(3,2) AS avg_rating, count(*)::int AS review_count FROM shop_product_reviews GROUP BY ecommerce_product_id;
