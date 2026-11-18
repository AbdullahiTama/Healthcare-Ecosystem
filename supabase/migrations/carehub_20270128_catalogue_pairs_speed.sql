-- Product catalogue, phase 5 follow-up: duplicate search and health check fast enough for the Master Catalog screen.
-- Design: docs/architecture/Product-Catalogue-Design.md §10.
-- APPLIED to live 2026-11-18, right after carehub_20270127.
--
-- FINDING (live, 2026-11-18, right after carehub_20270127 was applied): catalogue_health took 13 s on the largest
-- catalogue (3,228 items), almost all of it in catalogue_pairs (8.8 s):
--   * most names contain no number, so "same numbers" put nearly every item in one group and every pair in it was
--     compared; the trigram index join was slower still (17 s), since short common trigrams match thousands of rows;
--   * as SECURITY INVOKER, every candidate row also went through the RLS policies of master_products and products
--     (0.9 s for the "hidden" count alone).
-- Measured alternatives on the four largest catalogues:
--   * same first word: 57 ms but loses half the real pairs ("clindamycin 300mg" / "clinda 300mg (clindamycin)");
--   * share a word of 4+ letters (this migration): 252 ms on the largest, < 100 ms on the next three, and finds all 29
--     pairs that the full comparison finds.
--
-- WHAT THIS DOES
--   1. catalogue_pairs: near-identical names are compared only when they share a word of four or more letters (and the
--      same numbers, as before). It is SECURITY DEFINER: it checks membership once and reads only that business.
--   2. catalogue_health: SECURITY DEFINER for the same reason; it already refuses a business the caller is not in.
--   3. The trigram index master_products_name_trgm is no longer used and is dropped (pg_trgm stays: it was installed
--      before phase 5).
--
-- SECURITY: no permission is widened. Both functions refuse (health) or return nothing for (pairs) a business outside
-- current_business_ids(), and every statement is scoped to that business, so bypassing RLS returns exactly the rows the
-- policies allowed. They read only; they write nothing.
--
-- ROLLBACK: re-create catalogue_pairs and catalogue_health from carehub_20270127 and its index.

create or replace function public.catalogue_pairs(p_business_id uuid)
returns table (item_a uuid, item_b uuid, reason text, score real)
language sql stable security definer set search_path = public, pg_temp as $$
  with items as (
    select m.id, m.name_key, nullif(btrim(m.barcode), '') as barcode,
           regexp_replace(m.name_key, '[^a-z0-9]', '', 'g') as squashed,
           btrim(regexp_replace(m.name_key, '[^0-9]+', ' ', 'g')) as numbers
      from public.master_products m
     where m.business_id = p_business_id and m.archived_at is null
       and p_business_id in (select public.current_business_ids())
  ), words as (
    select distinct i.id, w.word from items i, unnest(regexp_split_to_array(i.name_key, '[^a-z]+')) as w(word)
     where length(w.word) >= 4
  ), candidates as (
    select distinct x.id as a, y.id as b from words x join words y on y.word = x.word and x.id < y.id
  ), found as (
    select x.id as a, y.id as b, 'barcode' as reason, 1.0::real as score, 1 as strength
      from items x join items y on y.barcode = x.barcode and x.id < y.id
    union all
    select x.id, y.id, 'name', 0.99::real, 2
      from items x join items y on y.squashed = x.squashed and x.squashed <> '' and x.id < y.id
    union all
    select x.id, y.id, 'similar', similarity(x.name_key, y.name_key), 3
      from candidates c join items x on x.id = c.a join items y on y.id = c.b
     where x.numbers = y.numbers
       and similarity(x.name_key, y.name_key) >= 0.8
       and not public.catalogue_size_variants(x.name_key, y.name_key)
  )
  select distinct on (f.a, f.b) f.a, f.b, f.reason, f.score
    from found f
   where not exists (select 1 from public.catalogue_duplicate_dismissals d where d.item_a = f.a and d.item_b = f.b)
   order by f.a, f.b, f.strength
$$;

alter function public.catalogue_health(uuid) security definer;

drop index if exists public.master_products_name_trgm;

revoke all on function public.catalogue_pairs(uuid), public.catalogue_health(uuid) from public, anon;
grant execute on function public.catalogue_pairs(uuid), public.catalogue_health(uuid) to authenticated, service_role;
