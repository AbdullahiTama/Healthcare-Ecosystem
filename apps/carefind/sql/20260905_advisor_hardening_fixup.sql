-- ============================================================================
-- 2026-09-05 — Advisor hardening fixup: dedupe FK indexes & cover remaining 16
--              unindexed FKs. Follow-up to 20260905_advisor_hardening.sql
--              which introduced 61 duplicate indexes via overly broad FK sweep.
-- ============================================================================

-- Drop duplicate FK indexes introduced by the generic sweep where a covering
-- index already existed. Keep the older canonical index, drop the new _fk.
DO $$
DECLARE
  dup RECORD;
  cnt INT := 0;
BEGIN
  FOR dup IN
    SELECT
      c.relname AS table_name,
      i1.indexrelid::regclass::text AS idx1_name,
      i2.indexrelid::regclass::text AS idx2_name,
      pg_get_indexdef(i1.indexrelid) AS def1,
      pg_get_indexdef(i2.indexrelid) AS def2
    FROM pg_index i1
    JOIN pg_index i2 ON i1.indrelid = i2.indrelid AND i1.indexrelid < i2.indexrelid
    JOIN pg_class c ON c.oid = i1.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND i1.indisvalid AND i2.indisvalid
      -- identical index definition (same columns, same predicate)
      AND regexp_replace(pg_get_indexdef(i1.indexrelid), '^\s*CREATE (UNIQUE )?INDEX \S+ ', '') =
          regexp_replace(pg_get_indexdef(i2.indexrelid), '^\s*CREATE (UNIQUE )?INDEX \S+ ', '')
  LOOP
    -- Prefer to drop the _fk suffixed index (our sweep's naming), keep the older
    IF dup.idx1_name LIKE '%_fk' AND dup.idx1_name LIKE 'idx_%' THEN
      EXECUTE format('DROP INDEX IF EXISTS %s', dup.idx1_name);
      cnt := cnt + 1;
      RAISE NOTICE 'Dropped duplicate FK index % (kept %)', dup.idx1_name, dup.idx2_name;
    ELSIF dup.idx2_name LIKE '%_fk' AND dup.idx2_name LIKE 'idx_%' THEN
      EXECUTE format('DROP INDEX IF EXISTS %s', dup.idx2_name);
      cnt := cnt + 1;
      RAISE NOTICE 'Dropped duplicate FK index % (kept %)', dup.idx2_name, dup.idx1_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'Dropped % duplicate FK indexes', cnt;
END $$;

-- Create covering indexes for the 16 remaining unindexed FKs (advisor 2026-09-05)
-- These were missed by the initial sweep due to faulty prefix check.
CREATE INDEX IF NOT EXISTS idx_agent_support_logs_business_id_fk ON public.agent_support_logs (business_id);
CREATE INDEX IF NOT EXISTS idx_creator_subscriptions_creator_id_fk ON public.creator_subscriptions (creator_id);
CREATE INDEX IF NOT EXISTS idx_live_participants_user_id_fk ON public.live_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_post_comment_likes_user_id_fk ON public.post_comment_likes (user_id);
CREATE INDEX IF NOT EXISTS idx_post_reactions_user_id_fk ON public.post_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_post_shares_user_id_fk ON public.post_shares (user_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id_fk ON public.product_reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_professional_consultations_patient_id_fk ON public.professional_consultations (patient_id);
CREATE INDEX IF NOT EXISTS idx_saved_news_user_id_fk ON public.saved_news (user_id);
CREATE INDEX IF NOT EXISTS idx_seen_posts_post_id_fk ON public.seen_posts (post_id);
CREATE INDEX IF NOT EXISTS idx_service_availability_service_id_fk ON public.service_availability (service_id);
CREATE INDEX IF NOT EXISTS idx_shop_product_reviews_user_id_fk ON public.shop_product_reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_shop_wishlist_ecommerce_product_id_fk ON public.shop_wishlist (ecommerce_product_id);
CREATE INDEX IF NOT EXISTS idx_task_submissions_professional_id_fk ON public.task_submissions (professional_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_professional_id_fk ON public.user_subscriptions (professional_id);
-- live_participants has two FKs on same column (fk_live_participants_user and live_participants_user_id_fkey) — one index covers both
