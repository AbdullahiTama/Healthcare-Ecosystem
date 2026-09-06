-- 2026-08-05 — Backfill legacy products with their sale tier.
--
-- Problem (MedMarket filters): CareFind's Retail / Wholesale / Distributor
-- tabs returned empty results even though the "All" tab was full. Two
-- compounding causes:
--   1. Search.jsx filtered sale_type on the client, AFTER a limit(40)
--      unordered fetch — the arbitrary batch was dominated by legacy rows.
--      (Fixed in code: the filter now runs server-side, before limit().)
--   2. Every product created before the marketplace feature (CareHub
--      inventory, QA seed data) has sale_type = NULL, so no tab other than
--      "All" could ever match them. 3645 live products, most of them legacy.
--
-- This migration backfills the NULLs. 'retail' is the convention both seller
-- apps already enforce: CareHub's ProductModal defaults sale_type to 'retail'
-- and CareFind's ProductUpload defaults to 'retail', so a listed product with
-- no explicit tier is, by the products' own writing convention, a retail
-- listing. Wholesale/distributor inventory is never untagged in practice —
-- those tiers only exist in the two forms, which always write the value.
--
-- Scope is deliberately narrow:
--   * only listed products (list_on_carefind = true) — unlisted rows never
--     reach CareFind, so tagging them is pointless;
--   * Services excluded — CareHub's sale fields are hidden for the Services
--     category and the form writes no sale data for them.
--
-- Idempotent and safe to re-run: it only touches rows where sale_type IS NULL.
--
-- Apply from the Supabase SQL editor or psql. Review the row count first:
--   select count(*) from products
--   where sale_type is null and list_on_carefind = true
--   and (category is null or category <> 'Services');
--
-- To roll back (records affected ids first):
--   begin;
--   create table _sale_type_backup as
--     select id from products
--     where sale_type is null and list_on_carefind = true
--       and (category is null or category <> 'Services');
--   ... apply the update ...
--   -- rollback / commit as appropriate

update products
set sale_type = 'retail'
where sale_type is null
  and list_on_carefind = true
  and (category is null or category <> 'Services');
