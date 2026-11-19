-- Product catalogue, phase 5: catalogue health.
-- Design: docs/architecture/Product-Catalogue-Design.md §3.7 and §10 (owner's decisions, 2026-10-27 and 2026-11-18).
-- APPLIED to live 2026-11-18 (with the follow-up carehub_20270128_catalogue_pairs_speed, which replaces catalogue_pairs and drops the trigram index).
--
-- Written against the LIVE schema read on 2026-11-18:
--   * 10,368 current master items at 12 businesses (the largest has 3,228). 1,202 have no price, 9,170 no generic
--     name, 6,864 no barcode, 7,335 (71%) sit in "Other medicines" and 6 have no category.
--   * 9,828 products are listed on CareFind and 1,211 of them have no price: they show as free or as "₦0".
--   * Exact duplicate names cannot exist (unique business + name key since carehub_20261215), but 3 groups share a
--     barcode, 8 differ only in spaces or punctuation, and more are near-identical spellings.
--   * pg_trgm 1.6 is installed in the public schema. Every live product has tracking_mode 'none'.
--
-- OWNER'S DECISIONS
--   * Merging two catalogue items keeps history: stock and batches move to the kept product through the stock ledger
--     (a movement on each side); the dropped product is stopped at its location, not deleted, so its past sales,
--     orders and movements stay on it. The dropped catalogue item is archived.
--   * CareFind hides items with no price. Prescription-only items stay listed as "ask the pharmacist".
--
-- WHAT THIS DOES
--   1. catalogue_issue(item, issue): the one definition of each missing-data flag (no price, no generic name, no
--      barcode, left in "Other medicines", not linked to the library, hidden on CareFind for having no price).
--   2. catalogue_pairs(business): possible duplicates, by shared barcode, by the same letters and digits, or by a
--      near-identical name (trigram similarity >= 0.8) with the same numbers and no size or pack word between them.
--      catalogue_duplicate_dismissals records "these are not duplicates"; dismiss_duplicate_pair() writes it.
--   3. catalogue_health(business): a 0-100 score and the count for each flag.
--   4. master_catalog_page gains p_health: one flag at a time, for the health panel's links.
--   5. set_master_category(business, ids, code): bulk category; with no code, each linked item takes its library
--      category.
--   6. merge_master_items(business, keep, drop): the merge described above, in one transaction.
--   7. CareFind: is_carefind_unpriced(); carefind_products and the public products policy leave out unpriced items.
--
-- SECURITY: no permission is widened. Reads are SECURITY INVOKER under the existing RLS (members of the business
-- tree) and also check membership explicitly. Writes are SECURITY DEFINER and check the caller first: owner or
-- manager of the main business for categories and dismissals (catalog_require_manager, as phase 4); the owner only for
-- a merge (is_business_owner on the main business), since it moves stock at every location. Direct writes to the
-- dismissals table are refused. CareFind only loses rows: unpriced items stop being public; owners, approved
-- claimants and the business's members still see them.
--
-- ROLLBACK: re-create carefind_products and the policy "public can view listed products" from
-- carehub_20261221_prescription_safety.sql; re-create master_catalog_page from carehub_20261223 (§8); drop the
-- functions below, catalogue_duplicate_dismissals and the index master_products_name_trgm. Merges already made stay
-- made: their stock movements are in the ledger, and an archived item can be restored.

create extension if not exists pg_trgm with schema public;

-- ── 1. Missing-data flags ────────────────────────────────────────────────────────────────────────────────────────────
-- A generic name only means something for medicines; a barcode for anything but a service.
create or replace function public.catalogue_is_medicine(p_category_code text)
returns boolean language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(p_category_code, '') not in ('devices', 'personal_care', 'food_drinks', 'general_retail', 'services')
$$;

-- CareFind shows no item without a price. A prescription-only item never shows a price, so it is not "unpriced".
create or replace function public.is_carefind_unpriced(p_rx_status text, p_price numeric)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select not public.is_rx_restricted(p_rx_status) and coalesce(p_price, 0) <= 0
$$;

create or replace function public.catalogue_issue(m public.master_products, p_issue text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select case p_issue
    when 'no_price'       then coalesce(m.default_price, 0) <= 0
    when 'no_generic'     then public.catalogue_is_medicine(m.category_code) and nullif(btrim(m.generic_name), '') is null
    when 'no_barcode'     then coalesce(m.category_code, '') <> 'services' and nullif(btrim(m.barcode), '') is null
    when 'other_category' then m.category_code is null or m.category_code = 'medicines_other'
    when 'unlinked'       then m.catalog_item_id is null
    when 'hidden'         then exists (select 1 from public.products p
                                        where p.master_product_id = m.id and p.list_on_carefind = true
                                          and public.is_carefind_unpriced(p.rx_status, p.price))
    else false
  end
$$;

-- ── 2. Possible duplicates ───────────────────────────────────────────────────────────────────────────────────────────
create index if not exists master_products_name_trgm on public.master_products using gin (name_key gin_trgm_ops)
  where archived_at is null;

create table if not exists public.catalogue_duplicate_dismissals (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  item_a       uuid not null references public.master_products(id) on delete cascade,
  item_b       uuid not null references public.master_products(id) on delete cascade,
  dismissed_by uuid,
  created_at   timestamptz not null default now(),
  primary key (item_a, item_b),
  check (item_a < item_b)
);
create index if not exists catalogue_duplicate_dismissals_business on public.catalogue_duplicate_dismissals (business_id);
alter table public.catalogue_duplicate_dismissals enable row level security;
drop policy if exists "catalogue_duplicate_dismissals members read" on public.catalogue_duplicate_dismissals;
create policy "catalogue_duplicate_dismissals members read" on public.catalogue_duplicate_dismissals for select to authenticated
  using (business_id in (select public.current_business_ids()));
revoke all on public.catalogue_duplicate_dismissals from public, anon, authenticated;
grant select on public.catalogue_duplicate_dismissals to authenticated;
grant all on public.catalogue_duplicate_dismissals to service_role;

-- True when two names differ by a size or pack word ("b/s" and "s/s", "jar", "sachet"): those are different products.
create or replace function public.catalogue_size_variants(p_a text, p_b text)
returns boolean language sql immutable parallel safe set search_path = public, pg_temp as $$
  select exists (
    select 1 from (
      (select unnest(string_to_array(p_a, ' ')) except select unnest(string_to_array(p_b, ' ')))
      union
      (select unnest(string_to_array(p_b, ' ')) except select unnest(string_to_array(p_a, ' ')))
    ) d(w)
    where d.w ~ '^\(?(b/s|s/s|m/s|l/s|xl|xxl|big|small|medium|large|mini|jumbo|family|jar|pack|pkt|pck|sachet|sachets|tin|can|bottle|btl|carton|ctn|roll|bag|refill|tube|box|single|double|\d.*)\)?$'
  )
$$;

-- Pairs of current items of one business that may be the same product, strongest reason first: the same barcode,
-- then the same letters and digits ("Panadol-Extra" and "panadol extra"), then a near-identical name with the same
-- numbers ("Amoxil 500mg" never pairs with "Amoxil 250mg"). Dismissed pairs are left out.
create or replace function public.catalogue_pairs(p_business_id uuid)
returns table (item_a uuid, item_b uuid, reason text, score real)
language sql stable security invoker
set search_path = public, pg_temp
set pg_trgm.similarity_threshold = 0.8
as $$
  with items as (
    select m.id, m.name_key, nullif(btrim(m.barcode), '') as barcode,
           regexp_replace(m.name_key, '[^a-z0-9]', '', 'g') as squashed,
           btrim(regexp_replace(m.name_key, '[^0-9]+', ' ', 'g')) as numbers
      from public.master_products m
     where m.business_id = p_business_id and m.archived_at is null
       and p_business_id in (select public.current_business_ids())
  ), found as (
    select x.id as a, y.id as b, 'barcode' as reason, 1.0::real as score, 1 as strength
      from items x join items y on y.barcode = x.barcode and x.id < y.id
    union all
    select x.id, y.id, 'name', 0.99::real, 2
      from items x join items y on y.squashed = x.squashed and x.squashed <> '' and x.id < y.id
    union all
    select x.id, y.id, 'similar', similarity(x.name_key, y.name_key), 3
      from items x
      join public.master_products y on y.business_id = p_business_id and y.archived_at is null
                                   and y.name_key % x.name_key and x.id < y.id
     where btrim(regexp_replace(y.name_key, '[^0-9]+', ' ', 'g')) = x.numbers
       and not public.catalogue_size_variants(x.name_key, y.name_key)
  )
  select distinct on (f.a, f.b) f.a, f.b, f.reason, f.score
    from found f
   where not exists (select 1 from public.catalogue_duplicate_dismissals d where d.item_a = f.a and d.item_b = f.b)
   order by f.a, f.b, f.strength
$$;

-- One page of possible duplicates, each side with what the owner needs to choose which to keep.
create or replace function public.catalogue_duplicate_pairs(p_business_id uuid, p_offset integer default 0, p_limit integer default 50)
returns table (item_a jsonb, item_b jsonb, reason text, score real, total bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  with pairs as (
    select p.*, count(*) over () as total from public.catalogue_pairs(p_business_id) p
     order by case p.reason when 'barcode' then 1 when 'name' then 2 else 3 end, p.score desc, p.item_a, p.item_b
    offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 200)
  ), side as (
    select m.id, jsonb_build_object(
             'id', m.id, 'name', m.name, 'generic_name', m.generic_name, 'strength', m.strength, 'barcode', m.barcode,
             'category_code', m.category_code, 'default_price', m.default_price, 'rx_status', m.rx_status,
             'catalog_item_id', m.catalog_item_id,
             'locations', (select count(distinct pr.business_id) from public.products pr where pr.master_product_id = m.id),
             'stock', (select coalesce(sum(greatest(pr.stock, 0)), 0) from public.products pr where pr.master_product_id = m.id)) as j
      from public.master_products m
     where m.id in (select pairs.item_a from pairs union select pairs.item_b from pairs)
  )
  select a.j, b.j, pairs.reason, pairs.score, pairs.total
    from pairs join side a on a.id = pairs.item_a join side b on b.id = pairs.item_b
   order by case pairs.reason when 'barcode' then 1 when 'name' then 2 else 3 end, pairs.score desc, pairs.item_a, pairs.item_b
$$;

create or replace function public.dismiss_duplicate_pair(p_business_id uuid, p_item_a uuid, p_item_b uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.catalog_require_manager(p_business_id);
  if p_item_a is null or p_item_b is null or p_item_a = p_item_b
     or (select count(*) from public.master_products where id in (p_item_a, p_item_b) and business_id = p_business_id) <> 2 then
    raise exception 'Those items are not both in your catalogue.' using errcode = '22023';
  end if;
  insert into public.catalogue_duplicate_dismissals (business_id, item_a, item_b, dismissed_by)
  values (p_business_id, least(p_item_a, p_item_b), greatest(p_item_a, p_item_b), auth.uid())
  on conflict (item_a, item_b) do nothing;
  return true;
end $$;

-- ── 3. The health score ──────────────────────────────────────────────────────────────────────────────────────────────
-- Each flag costs up to its weight, in proportion to the share of items that have it; a catalogue with none scores 100.
-- Weights: no price 25, left in "Other medicines" 20, possible duplicates 15, no generic name 10, no barcode 10, not
-- linked to the library 10, hidden on CareFind 10.
create or replace function public.catalogue_health(p_business_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_total integer; v_no_price integer; v_no_generic integer; v_no_barcode integer; v_other integer; v_unlinked integer;
  v_hidden integer; v_pairs integer; v_dup_items integer; v_score integer;
begin
  if p_business_id is null or p_business_id not in (select public.current_business_ids()) then
    raise exception 'That catalogue is not yours.' using errcode = '42501';
  end if;
  select count(*),
         count(*) filter (where public.catalogue_issue(m, 'no_price')),
         count(*) filter (where public.catalogue_issue(m, 'no_generic')),
         count(*) filter (where public.catalogue_issue(m, 'no_barcode')),
         count(*) filter (where public.catalogue_issue(m, 'other_category')),
         count(*) filter (where public.catalogue_issue(m, 'unlinked')),
         count(*) filter (where public.catalogue_issue(m, 'hidden'))
    into v_total, v_no_price, v_no_generic, v_no_barcode, v_other, v_unlinked, v_hidden
    from public.master_products m
   where m.business_id = p_business_id and m.archived_at is null;
  with p as materialized (select * from public.catalogue_pairs(p_business_id))
  select (select count(*) from p), (select count(*) from (select item_a from p union select item_b from p) d)
    into v_pairs, v_dup_items;
  if v_total > 0 then
    v_score := greatest(0, round(100 - 100.0 * (25 * v_no_price + 20 * v_other + 15 * v_dup_items + 10 * v_no_generic
                                                + 10 * v_no_barcode + 10 * v_unlinked + 10 * v_hidden) / (100.0 * v_total)))::integer;
  end if;
  return jsonb_build_object(
    'total', v_total, 'score', v_score,
    'counts', jsonb_build_object('no_price', v_no_price, 'other_category', v_other, 'duplicates', v_pairs,
                                 'no_generic', v_no_generic, 'no_barcode', v_no_barcode, 'unlinked', v_unlinked,
                                 'hidden', v_hidden),
    'duplicate_items', v_dup_items);
end $$;

-- ── 4. The Master Catalog page: one flag at a time ───────────────────────────────────────────────────────────────────
drop function if exists public.master_catalog_page(uuid, text, text, boolean, integer, integer, text, text);
create or replace function public.master_catalog_page(
  p_business_id uuid, p_search text default null, p_category text default null,
  p_archived boolean default false, p_offset integer default 0, p_limit integer default 50, p_rx text default null,
  p_library text default null, p_health text default null)
returns table (item jsonb, carried jsonb, total bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  with matching as (
    select m.* from public.master_products m
     where m.business_id = p_business_id
       and (case when p_archived then m.archived_at is not null else m.archived_at is null end)
       and (p_category is null or m.category_code = p_category)
       and (p_rx is null or m.rx_status = p_rx)
       and (p_library is null or (p_library = 'linked') = (m.catalog_item_id is not null))
       and (p_health is null or public.catalogue_issue(m, p_health))
       and (coalesce(btrim(p_search), '') = ''
            or m.name ilike '%' || btrim(p_search) || '%'
            or m.generic_name ilike '%' || btrim(p_search) || '%'
            or m.barcode = btrim(p_search))
  ), page as (
    select m.*, count(*) over () as total from matching m order by m.name_key, m.id
    offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 200)
  )
  select (to_jsonb(pg) - 'total' - 'name_key')
           || jsonb_build_object(
                'library', (select public.catalog_item_json(c) from public.catalog_items c where c.id = pg.catalog_item_id),
                'suggestion', (select jsonb_build_object('id', s.id, 'status', s.status, 'review_note', s.review_note, 'created_at', s.created_at)
                                 from public.catalog_suggestions s where s.master_product_id = pg.id
                                order by s.created_at desc limit 1)),
         coalesce((select jsonb_agg(jsonb_build_object('branch_id', pr.business_id, 'product_id', pr.id, 'price', pr.price,
                                                       'stock', pr.stock, 'price_source', pr.price_source,
                                                       'active', coalesce(bp.active, true)) order by pr.business_id, pr.price)
                     from public.products pr
                     left join public.branch_products bp on bp.branch_id = pr.business_id and bp.master_product_id = pg.id
                    where pr.master_product_id = pg.id), '[]'::jsonb),
         pg.total
    from page pg
$$;

-- ── 5. Bulk category ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Sets the standard category of up to 500 current items. With no code, each item linked to the library takes the
-- library's category (items not linked, or whose library entry has none, are left as they are). Only the standard
-- category changes: the category text the locations sell under, and prescription status, are untouched.
create or replace function public.set_master_category(p_business_id uuid, p_ids uuid[], p_category_code text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  perform public.catalog_require_manager(p_business_id);
  if coalesce(cardinality(p_ids), 0) = 0 then return 0; end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Choose up to 500 items at a time.' using errcode = '22023';
  end if;
  if p_category_code is not null and not exists (select 1 from public.product_categories where code = p_category_code) then
    raise exception 'That category does not exist.' using errcode = '22023';
  end if;
  update public.master_products m
     set category_code = coalesce(p_category_code, c.category_code), updated_at = now()
    from (select m2.id, ci.category_code from public.master_products m2
            left join public.catalog_items ci on ci.id = m2.catalog_item_id
           where m2.id = any(p_ids)) c
   where m.id = c.id and m.business_id = p_business_id and m.archived_at is null
     and coalesce(p_category_code, c.category_code) is not null
     and m.category_code is distinct from coalesce(p_category_code, c.category_code);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── 6. Merging two catalogue items ───────────────────────────────────────────────────────────────────────────────────
-- Keeps p_keep_id and archives p_drop_id, in one transaction. At each location:
--   * only the dropped item is carried: its products are linked to the kept item instead, take its name, and the
--     carrying moves over (a stopped location stays stopped);
--   * both are carried: each dropped product's stock (when above zero) moves into the kept product through the stock
--     ledger ('correction', a movement on each side), its batches move with it, and it is stopped and taken off
--     CareFind. It is not deleted: its sales, orders and movements stay on it. Stock below zero is not moved (it would
--     take the kept product below zero); it stays on the stopped product and is counted in the result.
-- The kept item fills its empty details from the dropped one, keeps the stricter prescription status, and its
-- products receive that status, generic name and barcode (catalog_mirror_products: never looser). Prices are not
-- changed: Push sets them. Refused for batch-tracked products and for a service merged with a stocked product at the
-- same location, as Inventory's "Clean up duplicates" is.
create or replace function public.merge_master_items(p_business_id uuid, p_keep_id uuid, p_drop_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_keep public.master_products%rowtype; v_drop public.master_products%rowtype;
  v_merge uuid := gen_random_uuid();
  v_loc uuid; v_keeper record; v_dup record;
  v_relinked integer := 0; v_merged_locations integer := 0; v_moved bigint := 0; v_negative integer := 0; v_n integer;
begin
  if auth.uid() is null or p_business_id is null or public.business_root(p_business_id) is distinct from p_business_id
     or not public.is_business_owner(p_business_id) then
    raise exception 'Only the business owner can merge catalogue items.' using errcode = '42501';
  end if;
  if p_keep_id is null or p_drop_id is null or p_keep_id = p_drop_id then
    raise exception 'Choose two different items to merge.' using errcode = '22023';
  end if;
  perform 1 from public.master_products where id in (p_keep_id, p_drop_id) order by id for update;
  select * into v_keep from public.master_products where id = p_keep_id and business_id = p_business_id and archived_at is null;
  select * into v_drop from public.master_products where id = p_drop_id and business_id = p_business_id and archived_at is null;
  if v_keep.id is null or v_drop.id is null then
    raise exception 'Both items must be current items of your catalogue.' using errcode = '22023';
  end if;

  -- Every product of both items, locked in a stable order.
  perform 1 from public.products where master_product_id in (p_keep_id, p_drop_id) order by id for update;

  if exists (select 1 from public.products d join public.products k on k.business_id = d.business_id and k.master_product_id = p_keep_id
              where d.master_product_id = p_drop_id and (d.tracking_mode <> 'none' or k.tracking_mode <> 'none')) then
    raise exception 'A location tracks one of these items by batch. Merge them in that location''s Inventory instead.' using errcode = '22023';
  end if;
  if exists (select 1 from public.products d join public.products k on k.business_id = d.business_id and k.master_product_id = p_keep_id
              where d.master_product_id = p_drop_id and (coalesce(d.category, '') = 'Services') <> (coalesce(k.category, '') = 'Services')) then
    raise exception 'A service cannot be merged with a stocked product.' using errcode = '22023';
  end if;

  -- The kept item: its empty details filled from the dropped one, the stricter prescription status.
  update public.master_products
     set generic_name  = coalesce(nullif(btrim(v_keep.generic_name), ''), v_drop.generic_name),
         strength      = coalesce(nullif(btrim(v_keep.strength), ''), v_drop.strength),
         dose_form     = coalesce(nullif(btrim(v_keep.dose_form), ''), v_drop.dose_form),
         pack_size     = coalesce(nullif(btrim(v_keep.pack_size), ''), v_drop.pack_size),
         barcode       = coalesce(nullif(btrim(v_keep.barcode), ''), v_drop.barcode),
         description   = coalesce(nullif(btrim(v_keep.description), ''), v_drop.description),
         category_code = case when v_keep.category_code is null or v_keep.category_code = 'medicines_other'
                              then coalesce(v_drop.category_code, v_keep.category_code) else v_keep.category_code end,
         default_price = case when coalesce(v_keep.default_price, 0) <= 0 then v_drop.default_price else v_keep.default_price end,
         default_cost  = case when coalesce(v_keep.default_cost, 0) <= 0 then v_drop.default_cost else v_keep.default_cost end,
         rx_status     = case when public.rx_rank(v_drop.rx_status) > public.rx_rank(v_keep.rx_status) then v_drop.rx_status else v_keep.rx_status end,
         catalog_item_id = coalesce(v_keep.catalog_item_id,
                                    (select c.id from public.catalog_items c where c.id = v_drop.catalog_item_id and c.status = 'active')),
         updated_at    = now()
   where id = p_keep_id
  returning * into v_keep;

  for v_loc in select distinct business_id from public.products where master_product_id = p_drop_id order by 1 loop
    select id, name, stock into v_keeper from public.products
     where business_id = v_loc and master_product_id = p_keep_id order by created_at, id limit 1;

    if v_keeper.id is null then
      update public.products set master_product_id = p_keep_id, name = v_keep.name
       where business_id = v_loc and master_product_id = p_drop_id;
      get diagnostics v_n = row_count;
      v_relinked := v_relinked + v_n;
      insert into public.branch_products (branch_id, master_product_id, active, override_price)
      select v_loc, p_keep_id, coalesce(bp.active, true), bp.override_price
        from (select 1) one left join public.branch_products bp on bp.branch_id = v_loc and bp.master_product_id = p_drop_id
      on conflict (branch_id, master_product_id) do nothing;
      delete from public.branch_products where branch_id = v_loc and master_product_id = p_drop_id;
    else
      v_merged_locations := v_merged_locations + 1;
      for v_dup in select id, name, coalesce(stock, 0) as stock, category from public.products
                    where business_id = v_loc and master_product_id = p_drop_id order by id loop
        if v_dup.stock > 0 and coalesce(v_dup.category, '') <> 'Services' then
          perform public.apply_stock_change(v_loc, v_dup.id, -v_dup.stock, 'correction', null, 'catalogue_merge', v_keeper.id::text, null,
                                            'Merged into ' || v_keeper.name, 'catalogue_merge:' || v_merge || ':' || v_dup.id || ':out', null);
          perform public.apply_stock_change(v_loc, v_keeper.id, v_dup.stock, 'correction', null, 'catalogue_merge', v_dup.id::text, null,
                                            'Merged from ' || v_dup.name, 'catalogue_merge:' || v_merge || ':' || v_dup.id || ':in', null);
          v_moved := v_moved + v_dup.stock;
        elsif v_dup.stock < 0 then
          v_negative := v_negative + 1;
        end if;
        update public.stock_batches set product_id = v_keeper.id, product_name = v_keeper.name
         where business_id = v_loc and product_id = v_dup.id;
        update public.products set list_on_carefind = false where id = v_dup.id;
      end loop;
      -- The kept item is carried here if either was; the dropped one is stopped.
      insert into public.branch_products (branch_id, master_product_id, active)
      values (v_loc, p_keep_id, true)
      on conflict (branch_id, master_product_id) do update set active = public.branch_products.active
        or coalesce((select bp.active from public.branch_products bp where bp.branch_id = v_loc and bp.master_product_id = p_drop_id), true);
      insert into public.branch_products (branch_id, master_product_id, active) values (v_loc, p_drop_id, false)
      on conflict (branch_id, master_product_id) do update set active = false;
    end if;
  end loop;

  perform public.catalog_mirror_products(array[p_keep_id]);

  update public.master_products set archived_at = now(), updated_at = now() where id = p_drop_id;
  update public.catalog_suggestions set status = 'withdrawn' where master_product_id = p_drop_id and status = 'pending';
  delete from public.catalogue_duplicate_dismissals where item_a = p_drop_id or item_b = p_drop_id;

  return jsonb_build_object('kept', p_keep_id, 'archived', p_drop_id, 'relinked', v_relinked,
                            'merged_locations', v_merged_locations, 'units_moved', v_moved, 'negative_left', v_negative);
end $$;

-- ── 7. CareFind: no item without a price ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "public can view listed products" on public.products;
create policy "public can view listed products" on public.products for select
  using (
    list_on_carefind = true
    and (
      (not public.is_rx_restricted(rx_status) and not public.is_carefind_unpriced(rx_status, price))
      or owner_id = (select auth.uid())
      or business_id in (select bc.business_id from public.business_claims bc
                          where bc.user_id = (select auth.uid()) and bc.status = 'approved')
    )
  );

create or replace view public.carefind_products as
select p.id, p.business_id, p.owner_id, p.name, p.generic_name, p.category, p.emoji, p.image_url, p.description,
       p.whatsapp, p.sale_type, p.price_unit, p.min_purchase, p.seller_location, p.latitude, p.longitude, p.stock,
       p.list_on_carefind, p.created_at, p.rx_status,
       public.is_rx_restricted(p.rx_status) as rx_restricted,
       case when public.is_rx_restricted(p.rx_status) then null else p.price end as price,
       case when public.is_rx_restricted(p.rx_status) then false else p.show_price end as show_price
  from public.products p
 where p.list_on_carefind = true
   and not public.is_carefind_unpriced(p.rx_status, p.price);

revoke all on public.carefind_products from public, anon, authenticated;
grant select on public.carefind_products to anon, authenticated, service_role;

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.catalogue_issue(public.master_products, text), public.catalogue_pairs(uuid),
  public.catalogue_duplicate_pairs(uuid, integer, integer), public.dismiss_duplicate_pair(uuid, uuid, uuid),
  public.catalogue_health(uuid), public.set_master_category(uuid, uuid[], text), public.merge_master_items(uuid, uuid, uuid),
  public.master_catalog_page(uuid, text, text, boolean, integer, integer, text, text, text)
  from public, anon;
grant execute on function public.catalogue_issue(public.master_products, text), public.catalogue_pairs(uuid),
  public.catalogue_duplicate_pairs(uuid, integer, integer), public.dismiss_duplicate_pair(uuid, uuid, uuid),
  public.catalogue_health(uuid), public.set_master_category(uuid, uuid[], text), public.merge_master_items(uuid, uuid, uuid),
  public.master_catalog_page(uuid, text, text, boolean, integer, integer, text, text, text)
  to authenticated, service_role;
grant execute on function public.catalogue_is_medicine(text), public.catalogue_size_variants(text, text),
  public.is_carefind_unpriced(text, numeric) to anon, authenticated, service_role;
