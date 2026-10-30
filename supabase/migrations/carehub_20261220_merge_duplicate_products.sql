-- ─────────────────────────────────────────────────────────────────────────────
-- merge_duplicate_products: Inventory's "Clean up duplicates", done safely.
-- 2026-10-30. Additive: one new function, no table or data change on apply.
-- APPLIED to the live carehub project 2026-10-30 as
-- carehub_20261220_merge_duplicate_products (version 20261030090338); the live
-- function body matches this file (md5 0f627ecc1174bd41f8791065a91ac568).
-- Docs: docs/architecture/Inventory-Duplicate-Merge.md
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY
-- The client used to merge a duplicate group by writing the keeper's stock as
-- the SUM of the group's stock (read from the page's product list, which is
-- loaded once and goes stale as POS sells), then deleting the others. That:
--   1. erased every sale made since the page loaded (absolute write from a
--      stale read, the same lost-update class as C5/C12);
--   2. bypassed the stock ledger (apply_stock_change / stock_movements), so the
--      move left no record;
--   3. silently DELETED rows that cascade from products: the duplicate's
--      product reviews, shop listing (ecommerce_products) and stock-count
--      history (stock_validation_items);
--   4. failed halfway on a duplicate that had stock batches, LPO lines or shop
--      order lines (FKs without cascade), after the keeper's summed stock had
--      already been written: stock counted twice and the duplicates left in
--      place.
--
-- WHAT
-- One transaction per group:
--   * authorise: the business owner, or active staff whose custom role grants
--     canDelete (the same rule the client uses to show the button);
--   * lock the keeper and the duplicates (in id order, so two merges cannot
--     deadlock), all must belong to the business;
--   * move each duplicate's CURRENT stock (read under the lock, never from the
--     client) into the keeper through apply_stock_change, so the move is two
--     journalled 'correction' movements and the ledger's rules apply (no
--     negative stock, batch tracking, Services ignored). Positive stocks move
--     before negative ones so a keeper is not pushed below zero on the way to
--     a non-negative total; a group whose total would be below zero is refused
--     by the ledger (INSUFFICIENT_STOCK) and nothing in it changes;
--   * repoint every row that references a duplicate to the keeper, so nothing
--     cascades away and no FK blocks the delete;
--   * delete the duplicates.
--
-- Rows that cannot be repointed without breaking a uniqueness rule:
--   * product_reviews (user_id, product_id): a customer who reviewed both
--     products keeps their MOST RECENT review; the older one is removed;
--   * ecommerce_products (business_id, product_id): if the keeper and a
--     duplicate both have a shop listing the merge is refused
--     (MERGE_LISTING_CONFLICT). Listings carry orders and shopper alerts, so
--     choosing one is the owner's decision, not this function's.
-- Batch-tracked products (tracking_mode <> 'none') are refused
-- (MERGE_TRACKED_UNSUPPORTED): their stock lives in batches and needs a batch
-- level merge. None exist in production today (verified 2026-10-30).
--
-- NOT repointed (no FK, history by design): stock_movements stays under the
-- duplicate's id (the ledger is append-only and ends at 0 with the merge-out
-- movement); sales.items JSON keeps the product ids it was sold under.
--
-- SECURITY
-- SECURITY DEFINER with a pinned search_path, because repointing must reach
-- rows the caller cannot UPDATE under RLS (a customer's review, a shop order
-- line). Under SECURITY INVOKER those UPDATEs would silently match nothing and
-- the DELETE's ON DELETE CASCADE would then remove them: exactly the data loss
-- being fixed. Authorisation is therefore explicit (see above) and every
-- statement is scoped to p_business_id. EXECUTE is granted to authenticated
-- only. auth.uid()/auth.email() still identify the caller, so the ledger rows
-- record who merged.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.merge_duplicate_products(
  p_business_id   uuid,
  p_keeper_id     uuid,
  p_duplicate_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dups     uuid[];
  v_locked   int;
  v_keeper   record;
  v_dup      record;
  v_moved    bigint := 0;
  v_stock    integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'MERGE_NOT_ALLOWED: sign in to merge products' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.is_business_owner(p_business_id)
    OR EXISTS (
      SELECT 1
        FROM public.staff s
        JOIN public.roles r ON r.business_id = s.business_id AND r.name = s.role
       WHERE s.business_id = p_business_id
         AND s.status = 'active'
         AND lower(s.email) = lower(auth.email())
         AND coalesce((r.permissions ->> 'canDelete')::boolean, false)
    )
  ) THEN
    RAISE EXCEPTION 'MERGE_NOT_ALLOWED: only the owner, or a role allowed to delete products, can merge duplicates'
      USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(DISTINCT d) INTO v_dups
    FROM unnest(coalesce(p_duplicate_ids, '{}'::uuid[])) AS d
   WHERE d IS NOT NULL AND d <> p_keeper_id;
  IF v_dups IS NULL OR cardinality(v_dups) = 0 THEN
    RAISE EXCEPTION 'MERGE_INVALID: name at least one duplicate other than the product being kept'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lock every product in the group in a stable order.
  SELECT count(*) INTO v_locked FROM (
    SELECT id FROM public.products
     WHERE business_id = p_business_id AND id = ANY (v_dups || p_keeper_id)
     ORDER BY id
     FOR UPDATE
  ) l;
  IF v_locked <> cardinality(v_dups) + 1 THEN
    RAISE EXCEPTION 'MERGE_NOT_FOUND: one or more of these products no longer exist in this business'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT id, name, tracking_mode INTO v_keeper FROM public.products WHERE id = p_keeper_id;
  IF EXISTS (
    SELECT 1 FROM public.products
     WHERE id = ANY (v_dups || p_keeper_id) AND tracking_mode <> 'none'
  ) THEN
    RAISE EXCEPTION 'MERGE_TRACKED_UNSUPPORTED: batch-tracked products cannot be merged here yet'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A Service carries no stock (the ledger ignores it). Merging one with a
  -- stocked product would take the duplicate's units out and put them
  -- nowhere, so such a group is refused.
  IF (SELECT count(DISTINCT (coalesce(category, '') = 'Services')) FROM public.products WHERE id = ANY (v_dups || p_keeper_id)) > 1 THEN
    RAISE EXCEPTION 'MERGE_INVALID: a service cannot be merged with a stocked product'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ecommerce_products WHERE business_id = p_business_id AND product_id = p_keeper_id)
     AND EXISTS (SELECT 1 FROM public.ecommerce_products WHERE business_id = p_business_id AND product_id = ANY (v_dups)) THEN
    RAISE EXCEPTION 'MERGE_LISTING_CONFLICT: more than one of these products has a shop listing; remove the extra listing first'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.ecommerce_products WHERE business_id = p_business_id AND product_id = ANY (v_dups)) > 1 THEN
    RAISE EXCEPTION 'MERGE_LISTING_CONFLICT: more than one of these products has a shop listing; remove the extra listing first'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Stock: move each duplicate's current stock into the keeper through the
  -- ledger. Positive stocks first, so a keeper is never taken below zero on the
  -- way to a non-negative total. Services carry no stock and are skipped.
  FOR v_dup IN
    SELECT id, name, coalesce(stock, 0) AS stock
      FROM public.products
     WHERE id = ANY (v_dups) AND coalesce(category, '') <> 'Services'
     ORDER BY (coalesce(stock, 0) < 0), id
  LOOP
    v_stock := v_dup.stock;
    IF v_stock <> 0 THEN
      PERFORM public.apply_stock_change(
        p_business_id, v_dup.id, -v_stock, 'correction', NULL,
        'product_merge', p_keeper_id::text, NULL,
        'Merged into ' || v_keeper.name, 'merge:' || v_dup.id || ':out', NULL);
      PERFORM public.apply_stock_change(
        p_business_id, p_keeper_id, v_stock, 'correction', NULL,
        'product_merge', v_dup.id::text, NULL,
        'Merged from ' || v_dup.name, 'merge:' || v_dup.id || ':in', NULL);
      v_moved := v_moved + v_stock;
    END IF;
  END LOOP;

  -- Reviews: one per customer per product. Where a customer reviewed both the
  -- keeper and a duplicate (or two duplicates), keep their most recent review.
  DELETE FROM public.product_reviews pr
   USING (
     SELECT id, row_number() OVER (
              PARTITION BY user_id
              ORDER BY created_at DESC NULLS LAST, id DESC) AS rn
       FROM public.product_reviews
      WHERE product_id = ANY (v_dups || p_keeper_id) AND user_id IS NOT NULL
   ) ranked
   WHERE pr.id = ranked.id AND ranked.rn > 1;
  UPDATE public.product_reviews SET product_id = p_keeper_id WHERE product_id = ANY (v_dups);

  -- Everything else that points at a duplicate now points at the keeper.
  UPDATE public.ecommerce_products     SET product_id = p_keeper_id WHERE business_id = p_business_id AND product_id = ANY (v_dups);
  UPDATE public.stock_batches          SET product_id = p_keeper_id WHERE business_id = p_business_id AND product_id = ANY (v_dups);
  UPDATE public.out_of_stock           SET product_id = p_keeper_id WHERE business_id = p_business_id AND product_id = ANY (v_dups);
  UPDATE public.order_items            SET product_id = p_keeper_id WHERE product_id = ANY (v_dups);
  UPDATE public.shop_order_items       SET product_id = p_keeper_id WHERE product_id = ANY (v_dups);
  UPDATE public.stock_validation_items SET product_id = p_keeper_id WHERE product_id = ANY (v_dups);
  UPDATE public.stock_transfer_lines   SET from_product_id = p_keeper_id WHERE from_product_id = ANY (v_dups);
  UPDATE public.stock_transfer_lines   SET to_product_id   = p_keeper_id WHERE to_product_id   = ANY (v_dups);

  DELETE FROM public.products WHERE business_id = p_business_id AND id = ANY (v_dups);

  RETURN jsonb_build_object(
    'keeper_id',   p_keeper_id,
    'merged',      cardinality(v_dups),
    'units_moved', v_moved,
    'stock',       (SELECT stock FROM public.products WHERE id = p_keeper_id)
  );
END;
$$;

COMMENT ON FUNCTION public.merge_duplicate_products(uuid, uuid, uuid[]) IS
  'Merges duplicate products into one keeper in a single transaction: moves each duplicate''s current stock '
  'through apply_stock_change (journalled corrections), repoints every referencing row (reviews keep the '
  'most recent per customer), then deletes the duplicates. Owner, or a custom role with canDelete. '
  'SECURITY DEFINER so repointing reaches rows RLS hides from the caller; every statement is scoped to p_business_id.';

REVOKE ALL ON FUNCTION public.merge_duplicate_products(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_duplicate_products(uuid, uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_products(uuid, uuid, uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY (read-only, after apply)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT p.prosecdef, p.proconfig, p.proacl::text
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'merge_duplicate_products';
-- Expect: prosecdef = true, proconfig = {search_path=public, pg_temp},
--         proacl with authenticated=X and NO anon / PUBLIC (=X) entry.
