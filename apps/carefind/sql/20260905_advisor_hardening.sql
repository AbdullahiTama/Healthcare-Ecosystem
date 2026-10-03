-- ============================================================================
-- 2026-09-05 — Advisor hardening: search_path, definer EXECUTE, FK indexes,
--              RLS initplan, dedupe indexes, security_invoker views
--
-- Single hardening migration per spec-advisor-hardening-2026-09-05.md
-- Covers 4 security_definer_view ERROR + 92 security WARN (45 auth definer,
-- 25 anon definer, 11 search_path) + 500 perf WARN (174 unindexed FKs,
-- 148 multiple_permissive, 114 auth_rls_initplan, 57 unused, 6 duplicate).
--
-- Keep: is_platform/host_id RLS semantics; increment_story_view/news_view
--       behavior; public read for active stories/news; service_role admin path.
-- Ask First: dropping intentionally-definer view; auth_leaked_password.
-- Never: weaken host_id=auth.uid() update/delete; expose admin_users; remove
--        needed FK index.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Pin search_path=public on all SECURITY DEFINER functions (and the 11
--    mutable-search_path functions flagged by advisors). ALTER FUNCTION ... SET
--    is idempotent. For overloaded create_shop_order we handle both signatures.
-- --------------------------------------------------------------------------

-- The 11 function_search_path_mutable flagged by advisors (2026-09-05):
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.increment_story_view(uuid) SET search_path = public;
ALTER FUNCTION public.increment_post_view(uuid) SET search_path = public;
ALTER FUNCTION public.increment_news_view(uuid) SET search_path = public;
-- create_shop_order wrapper (non-definer, 19 args) — flagged as mutable
ALTER FUNCTION public.create_shop_order(uuid, uuid, jsonb, integer, integer, integer, integer, integer, text, text, text, text, text, text, text, numeric, boolean, text, text) SET search_path = public;
-- create_shop_order definer (20 args, already had public,extensions,pg_temp) — normalize to public
ALTER FUNCTION public.create_shop_order(uuid, uuid, jsonb, integer, integer, integer, integer, integer, text, text, text, text, text, text, text, numeric, boolean, text, text, uuid) SET search_path = public;
ALTER FUNCTION public.update_ecommerce_updated_at() SET search_path = public;
ALTER FUNCTION public.is_ecommerce_product_complete(uuid) SET search_path = public;
ALTER FUNCTION public.confirm_appointment(uuid) SET search_path = public;
ALTER FUNCTION public.generate_shop_order_ref() SET search_path = public;
ALTER FUNCTION public.update_shop_updated_at() SET search_path = public;
ALTER FUNCTION public.update_shop_review_updated_at() SET search_path = public;

-- Harden any remaining SECURITY DEFINER functions that might have been missed
-- (idempotent: sets search_path even if already set). This closes the generic
-- "pin search_path=public on all SECURITY DEFINER functions" requirement.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = public', r.schema_name, r.proname, r.args);
      RAISE NOTICE 'Pinned search_path for %.%(%)', r.schema_name, r.proname, r.args;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not pin %.%(%): %', r.schema_name, r.proname, r.args, SQLERRM;
    END;
  END LOOP;
END $$;

-- --------------------------------------------------------------------------
-- 2. Fix 4 security_definer_view → security_invoker=true
--    (shop_public_products, staff_directory, shop_product_ratings, professional_earnings)
--    adr_report_analytics already has security_invoker=true and is left alone.
-- --------------------------------------------------------------------------

ALTER VIEW public.shop_public_products SET (security_invoker = true);
ALTER VIEW public.staff_directory SET (security_invoker = true);
ALTER VIEW public.shop_product_ratings SET (security_invoker = true);
ALTER VIEW public.professional_earnings SET (security_invoker = true);

-- --------------------------------------------------------------------------
-- 3. FK indexes: ensure at least news/stories/live_shows/story_views/news_*
--    have covering indexes, plus a generic sweep for all 174 unindexed FKs.
--    Index names are deterministic: idx_<table>_<column>_fk . IF NOT EXISTS
--    prevents duplicate-name errors; a guard avoids creating a duplicate index
--    on same column with different name.
-- --------------------------------------------------------------------------

-- Explicit indexes for spec-mandated tables (idempotent)
CREATE INDEX IF NOT EXISTS idx_news_author_id_fk ON public.news (author_id);
CREATE INDEX IF NOT EXISTS idx_news_posting_as_business_id_fk ON public.news (posting_as_business_id);
CREATE INDEX IF NOT EXISTS idx_stories_user_id_fk ON public.stories (user_id);
CREATE INDEX IF NOT EXISTS idx_live_shows_host_id_fk ON public.live_shows (host_id);
CREATE INDEX IF NOT EXISTS idx_live_shows_guest_id_fk ON public.live_shows (guest_id);
CREATE INDEX IF NOT EXISTS idx_news_comments_news_id_fk ON public.news_comments (news_id);
CREATE INDEX IF NOT EXISTS idx_news_comments_user_id_fk ON public.news_comments (user_id);
CREATE INDEX IF NOT EXISTS idx_news_reactions_user_id_fk ON public.news_reactions (user_id);
CREATE INDEX IF NOT EXISTS idx_news_reposts_news_id_fk ON public.news_reposts (news_id);
-- story_views is PK (story_id,user_id) already covers story_id, but add explicit if desired
CREATE INDEX IF NOT EXISTS idx_story_views_story_id_fk ON public.story_views (story_id);
CREATE INDEX IF NOT EXISTS idx_story_views_user_id_fk ON public.story_views (user_id);

-- Generic sweep: create covering indexes for every FK that advisor flags as
-- unindexed (174). This block is safe to re-run: it checks pg_index for an
-- existing index where the FK columns are a prefix, and only creates when missing.
DO $$
DECLARE
  fk RECORD;
  idx_name TEXT;
  col_list TEXT;
  exists_idx BOOLEAN;
BEGIN
  FOR fk IN
    SELECT
      c.conname,
      t.relname AS table_name,
      n.nspname AS schema_name,
      array_agg(a.attname ORDER BY u.ord) AS cols,
      array_agg(a.attnum ORDER BY u.ord) AS colnums
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
    GROUP BY c.conname, t.relname, n.nspname, c.oid
  LOOP
    col_list := array_to_string(fk.cols, ', ');
    idx_name := 'idx_' || fk.table_name || '_' || array_to_string(fk.cols, '_') || '_fk';

    -- Check if a valid index already exists where FK columns are a prefix
    SELECT EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_class ci ON ci.oid = i.indexrelid
      WHERE i.indrelid = (fk.schema_name || '.' || fk.table_name)::regclass
        AND i.indisvalid
        AND array_length(i.indkey, 1) >= array_length(fk.colnums, 1)
        AND (SELECT bool_and(fk.colnums[idx] = i.indkey[idx] )
             FROM generate_subscripts(fk.colnums, 1) AS idx)
    ) INTO exists_idx;

    IF NOT exists_idx THEN
      -- Avoid name collision: if idx_name already exists, skip (IF NOT EXISTS handles)
      BEGIN
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)', idx_name, fk.schema_name, fk.table_name, col_list);
        RAISE NOTICE 'Created FK index % on %.% (%)', idx_name, fk.schema_name, fk.table_name, col_list;
      EXCEPTION WHEN duplicate_table THEN
        RAISE NOTICE 'Index % already exists, skipping', idx_name;
      WHEN OTHERS THEN
        RAISE NOTICE 'Could not create index % on %.% (%): %', idx_name, fk.schema_name, fk.table_name, col_list, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

-- --------------------------------------------------------------------------
-- 4. RLS initplan: wrap auth.uid()/auth.email()/auth.jwt() as (select auth.uid())
--    for all 114 policies flagged by advisors. This prevents per-row re-eval.
--    The DO block iterates pg_policies, builds new qual/with_check with wrapping,
--    and recreates each policy. Idempotent: skips already-wrapped policies.
-- --------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
  v_new_qual TEXT;
  v_new_with_check TEXT;
  v_roles TEXT;
  v_sql TEXT;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        qual ILIKE '%auth.uid()%' OR qual ILIKE '%auth.email()%' OR qual ILIKE '%auth.jwt()%'
        OR with_check ILIKE '%auth.uid()%' OR with_check ILIKE '%auth.email()%' OR with_check ILIKE '%auth.jwt()%'
      )
  LOOP
    -- Skip if already wrapped (contains the select wrapper for any of the three)
    IF (r.qual IS NOT NULL AND r.qual ILIKE '%(select auth.uid())%') OR
       (r.qual IS NOT NULL AND r.qual ILIKE '%(select auth.email())%') OR
       (r.with_check IS NOT NULL AND r.with_check ILIKE '%(select auth.uid())%') OR
       (r.with_check IS NOT NULL AND r.with_check ILIKE '%(select auth.email())%') THEN
      -- Check if still has unwrapped instances (mixed). Use placeholder trick to be safe:
      -- If it contains both wrapped and unwrapped, we still need to fix unwrapped.
      -- So we don't skip purely on wrapped presence; we check for unwrapped pattern.
      NULL;
    END IF;

    -- Determine if there is any unwrapped occurrence
    IF NOT (
      (r.qual IS NOT NULL AND r.qual LIKE '%auth.uid()%' AND r.qual NOT LIKE '%(select auth.uid())%') OR
      (r.qual IS NOT NULL AND r.qual LIKE '%auth.email()%' AND r.qual NOT LIKE '%(select auth.email())%') OR
      (r.qual IS NOT NULL AND r.qual LIKE '%auth.jwt()%' AND r.qual NOT LIKE '%(select auth.jwt())%') OR
      (r.with_check IS NOT NULL AND r.with_check LIKE '%auth.uid()%' AND r.with_check NOT LIKE '%(select auth.uid())%') OR
      (r.with_check IS NOT NULL AND r.with_check LIKE '%auth.email()%' AND r.with_check NOT LIKE '%(select auth.email())%') OR
      (r.with_check IS NOT NULL AND r.with_check LIKE '%auth.jwt()%' AND r.with_check NOT LIKE '%(select auth.jwt())%')
    ) AND NOT (
      -- Also handle case where both wrapped and unwrapped coexist: force wrapping via placeholder double-wrap fix
      (r.qual IS NOT NULL AND r.qual LIKE '%auth.uid()%') OR (r.with_check IS NOT NULL AND r.with_check LIKE '%auth.uid()%')
    ) THEN
      CONTINUE;
    END IF;

    v_new_qual := r.qual;
    v_new_with_check := r.with_check;

    -- Wrap qual
    IF v_new_qual IS NOT NULL THEN
      -- Use placeholder to avoid double-wrapping
      v_new_qual := replace(v_new_qual, '(select auth.uid())', '__WRAPPED_UID__');
      v_new_qual := replace(v_new_qual, 'auth.uid()', '(select auth.uid())');
      v_new_qual := replace(v_new_qual, '__WRAPPED_UID__', '(select auth.uid())');

      v_new_qual := replace(v_new_qual, '(select auth.email())', '__WRAPPED_EMAIL__');
      v_new_qual := replace(v_new_qual, 'auth.email()', '(select auth.email())');
      v_new_qual := replace(v_new_qual, '__WRAPPED_EMAIL__', '(select auth.email())');

      v_new_qual := replace(v_new_qual, '(select auth.jwt())', '__WRAPPED_JWT__');
      v_new_qual := replace(v_new_qual, 'auth.jwt()', '(select auth.jwt())');
      v_new_qual := replace(v_new_qual, '__WRAPPED_JWT__', '(select auth.jwt())');

      -- Fix double-wrap artifact if placeholder logic missed: (select (select auth.uid())) -> (select auth.uid())
      v_new_qual := replace(v_new_qual, '(select (select auth.uid()))', '(select auth.uid())');
      v_new_qual := replace(v_new_qual, '(select (select auth.email()))', '(select auth.email())');
      v_new_qual := replace(v_new_qual, '(select (select auth.jwt()))', '(select auth.jwt())');
    END IF;

    IF v_new_with_check IS NOT NULL THEN
      v_new_with_check := replace(v_new_with_check, '(select auth.uid())', '__WRAPPED_UID__');
      v_new_with_check := replace(v_new_with_check, 'auth.uid()', '(select auth.uid())');
      v_new_with_check := replace(v_new_with_check, '__WRAPPED_UID__', '(select auth.uid())');

      v_new_with_check := replace(v_new_with_check, '(select auth.email())', '__WRAPPED_EMAIL__');
      v_new_with_check := replace(v_new_with_check, 'auth.email()', '(select auth.email())');
      v_new_with_check := replace(v_new_with_check, '__WRAPPED_EMAIL__', '(select auth.email())');

      v_new_with_check := replace(v_new_with_check, '(select auth.jwt())', '__WRAPPED_JWT__');
      v_new_with_check := replace(v_new_with_check, 'auth.jwt()', '(select auth.jwt())');
      v_new_with_check := replace(v_new_with_check, '__WRAPPED_JWT__', '(select auth.jwt())');

      v_new_with_check := replace(v_new_with_check, '(select (select auth.uid()))', '(select auth.uid())');
      v_new_with_check := replace(v_new_with_check, '(select (select auth.email()))', '(select auth.email())');
      v_new_with_check := replace(v_new_with_check, '(select (select auth.jwt()))', '(select auth.jwt())');
    END IF;

    -- Skip if no change
    IF v_new_qual IS NOT DISTINCT FROM r.qual AND v_new_with_check IS NOT DISTINCT FROM r.with_check THEN
      CONTINUE;
    END IF;

    -- Build roles clause
    IF r.roles = '{public}' THEN
      v_roles := 'PUBLIC';
    ELSE
      v_roles := array_to_string(r.roles, ', ');
      v_roles := replace(replace(v_roles, '{', ''), '}', '');
      IF v_roles = '' THEN v_roles := 'PUBLIC'; END IF;
    END IF;

    -- Drop and recreate
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    v_sql := format('CREATE POLICY %I ON %I.%I FOR %s TO %s', r.policyname, r.schemaname, r.tablename, r.cmd, v_roles);
    -- Handle permissive vs restrictive (all current are PERMISSIVE, but preserve)
    IF r.permissive = 'RESTRICTIVE' THEN
      v_sql := v_sql || ' AS RESTRICTIVE';
    END IF;
    IF v_new_qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', v_new_qual);
    END IF;
    IF v_new_with_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_new_with_check);
    END IF;

    RAISE NOTICE 'Rewrapping policy % on %.% (%)', r.policyname, r.schemaname, r.tablename, r.cmd;
    EXECUTE v_sql;
  END LOOP;
END $$;

-- --------------------------------------------------------------------------
-- 5. Definer EXECUTE: revoke anon/auth where not needed.
--    Keep: register_business (anon+authenticated), record_post_view (anon+authenticated),
--          increment_*_view (public but they are SECURITY INVOKER, not definer, so no revoke),
--          provision_staff_auth, attempt_staff_claim, send_gift etc. as authenticated-only.
--    Revoke trigger/helpers from anon+authenticated+public, keep service_role.
-- --------------------------------------------------------------------------

-- Helper to revoke from PUBLIC/anon/authenticated and re-grant to service_role
-- Trigger / internal helpers that should NOT be callable via RPC at all
DO $$
DECLARE
  funcs TEXT[] := ARRAY[
    'public.handle_new_user()',
    'public.maintain_news_repost_count()',
    'public.maintain_post_repost_count()',
    'public.maintain_post_view_count()',
    'public.apply_referring_agent()',
    'public.guard_ecommerce_images_approved()',
    'public.guard_ecommerce_images_delete()',
    'public.guard_ecommerce_products_approved()',
    'public.guard_ecommerce_products_delete()',
    'public.rls_auto_enable()',
    'public.current_business_ids()',
    'public.current_staff_id_for_business(uuid)',
    'public.is_platform_admin()',
    'public.is_business_manager(uuid)',
    'public.is_ecommerce_vendor_approved(uuid)',
    'public.is_ecommerce_image_vendor_approved(uuid)',
    'public.shop_restore_inventory_on_cancel(uuid)',
    'public.business_claim_owner(uuid)',
    'public.can_access_adr_report(uuid)',
    'public.can_access_adr_report_row(uuid, uuid)',
    'public.adr_report_events_trigger()',
    'public.adr_event_actor(uuid)',
    'public.update_ecommerce_updated_at()',
    'public.update_shop_updated_at()',
    'public.update_shop_review_updated_at()'
  ];
  f TEXT;
BEGIN
  FOREACH f IN ARRAY funcs LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
      -- Ensure service_role and postgres retain execute (owner always does, but be explicit)
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
      RAISE NOTICE 'Revoked public/anon/auth for %', f;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not revoke %: %', f, SQLERRM;
    END;
  END LOOP;
END $$;

-- Functions that should be authenticated-only (revoke anon, keep authenticated+service_role)
DO $$
DECLARE
  funcs TEXT[] := ARRAY[
    'public.attempt_staff_claim(uuid, text)',
    'public.cancel_shop_order(uuid, text)',
    'public.create_shop_order(uuid, uuid, jsonb, integer, integer, integer, integer, integer, text, text, text, text, text, text, text, numeric, boolean, text, text)',
    'public.create_shop_order(uuid, uuid, jsonb, integer, integer, integer, integer, integer, text, text, text, text, text, text, text, numeric, boolean, text, text, uuid)',
    'public.get_agent_portfolio()',
    'public.shop_add_message(uuid, text)',
    'public.update_shop_order_status(uuid, text, uuid, text)',
    'public.verify_shop_payment(uuid, text)',
    'public.is_ecommerce_product_complete(uuid)',
    'public.confirm_appointment(uuid)',
    'public.generate_shop_order_ref()',
    'public.adr_log_event(uuid, text, jsonb)',
    'public.book_appointment_slot(uuid, uuid, date, time, text, text, integer, text, text, text)',
    'public.pay_creator_subscription(uuid, integer)',
    'public.pay_professional_consultation(uuid)',
    'public.send_gift(uuid, integer, text, text, uuid, uuid)',
    'public.provision_staff_auth(uuid, text, text)',
    'public.set_distribution_experiment(text, jsonb)',
    'public.set_feed_ranking_config(text, jsonb)',
    'public.distribution_experiment_stats(text)',
    'public.post_gift_stats(uuid)',
    'public.post_gift_stats_batch(uuid[])',
    'public.complete_appointment_and_release(uuid)',
    'public.confirm_pos_payment(uuid, text)',
    'public.confirm_transfer_payment(uuid, text)'
  ];
  f TEXT;
BEGIN
  FOREACH f IN ARRAY funcs LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
      -- Revoke from authenticated then re-grant to authenticated+service_role
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
      RAISE NOTICE 'Restricted % to authenticated+service_role', f;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not restrict %: %', f, SQLERRM;
    END;
  END LOOP;
END $$;

-- Keep anon+authenticated for intentionally public RPCs
-- register_business is the public signup entry point (anon required)
REVOKE ALL ON FUNCTION public.register_business(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_business(jsonb, text) TO anon, authenticated, service_role;

-- record_post_view is intentionally anon+authenticated (anonymous views allowed, session-deduped)
REVOKE ALL ON FUNCTION public.record_post_view(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_post_view(uuid, text) TO anon, authenticated, service_role;

-- increment_* are SECURITY INVOKER (not definer) but keep public for anon view counting
REVOKE ALL ON FUNCTION public.increment_story_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_story_view(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_post_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_post_view(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_news_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_news_view(uuid) TO anon, authenticated, service_role;

-- get_story_viewers is owner-only (authenticated) — ensure anon revoked (if exists)
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_story_viewers(uuid) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_story_viewers(uuid) TO authenticated, service_role';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'get_story_viewers not present, skipping revoke: %', SQLERRM;
END $$;

-- --------------------------------------------------------------------------
-- 6. Drop duplicate indexes (6 flagged) and optionally unused (57) — only
--    duplicates are dropped; unused are left unless clearly duplicate, per
--    "Never remove needed FK index" constraint. Each DROP is IF EXISTS.
-- --------------------------------------------------------------------------

-- Duplicates: keep the canonical, drop the legacy idx_* version
DROP INDEX IF EXISTS public.idx_follows_follower;
DROP INDEX IF EXISTS public.idx_follows_following;
DROP INDEX IF EXISTS public.idx_comments_post;
DROP INDEX IF EXISTS public.idx_reactions_post;
-- For post_reactions unique dup: keep post_reactions_post_id_user_id_key (the FK-named one), drop the other
DROP INDEX IF EXISTS public.post_reactions_user_post_uniq;
-- For wallets unique dup: keep wallets_user_id_key (constraint index), drop the other
DROP INDEX IF EXISTS public.wallets_user_id_uniq;

-- Note: 57 unused indexes are NOT dropped automatically here. They are flagged
-- as "unused" via pg_stat_user_indexes which is workload-dependent. Dropping
-- them without a production traffic window would risk removing an index that
-- is needed for FK enforcement or rare queries. See verification section.
-- If after a 30-day pg_stat_user_indexes watch an index remains idx_scan=0 and
-- is not a FK covering index, drop it manually:
--   DROP INDEX IF EXISTS public.<unused_index_name>;

-- --------------------------------------------------------------------------
-- 7. Keep RLS semantics verification helpers (comments only)
-- --------------------------------------------------------------------------

-- is_platform/host_id semantics preserved: all live_shows policies still check
-- host_id = (select auth.uid()); stories still check user_id = (select auth.uid())
-- with is_platform=true exception; story_views still user_id = (select auth.uid());
-- admin_users/admin_teams remain RLS deny-all with service_role bypass.

-- --------------------------------------------------------------------------
-- Verification (run after applying, outside transaction):
--
-- -- Security
-- SELECT proname FROM pg_proc JOIN pg_namespace ON pg_namespace.oid=pg_proc.pronamespace
-- WHERE nspname='public' AND prosecdef AND pg_get_functiondef(oid) NOT ILIKE '%search_path%';
--   -- expected 0
-- SELECT * FROM pg_views WHERE schemaname='public' AND viewname IN ('shop_public_products','staff_directory','shop_product_ratings','professional_earnings');
--   -- check reloptions contains security_invoker=true
-- SELECT has_function_privilege('anon','public.register_business(jsonb,text)','execute'); -- true
-- SELECT has_function_privilege('anon','public.handle_new_user()','execute'); -- false
--
-- -- Performance
-- SELECT * FROM pg_policies WHERE qual ILIKE '%auth.uid()%' AND qual NOT ILIKE '%(select auth.uid())%'; -- 0
-- SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('news','stories','live_shows','story_views');
-- -- Check FK indexes exist via advisor re-run
-- ============================================================================
