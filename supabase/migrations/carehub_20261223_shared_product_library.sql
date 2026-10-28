-- Product catalogue, phase 4: the shared CareHub product library.
-- Design: docs/architecture/Product-Catalogue-Design.md §3.1, §3.2 and §4 (owner's decisions, 2026-10-27).
--
-- Written against the LIVE schema read on 2026-10-28:
--   * master_products (carehub_20261215): each main business's own items, with generic name, strength, form, pack size,
--     barcode, category_code, rx_status and archived_at. 11,323 live items at 12 businesses; 3,021 normalised names
--     are used by two or more businesses. No item has a strength of its own: it is part of the name.
--   * products.master_product_id links each location's product to its master item; products.rx_status mirrors it and
--     drives what CareFind shows (carehub_20261221).
--   * is_platform_admin() is true for the CareHub admin account; is_business_manager(bid) for the owner up the tree,
--     an active manager, or an admin.
--
-- WHAT THIS DOES
--   1. catalog_items: one row per real product, curated by CareHub admins. Approved (active) items are readable by
--      everyone; pending and retired ones by admins only. match_key (name + strength, normalised) is unique among items
--      that are not retired, so the library has no duplicates.
--   2. catalog_suggestions: what a business proposes for the library, from one of its master items. Admins add it as a
--      new item, link it to an existing one, or reject it; the business owner is told.
--   3. master_products.catalog_item_id: a business item linked to the library. Linking fills the item's empty fields
--      from the library. A linked item can never be less strict than the library's prescription status; when the
--      library raises an item's status, every linked item and its location products are raised too.
--   4. Seeding: every name used by two or more businesses becomes a pending library item for admin review (most common
--      spelling, generic name, category and prescription status; the barcodes in use). A retired (rejected) name is
--      never seeded again.
--   5. Admin functions: page the library, save an item, approve / retire / reopen in bulk, merge two items, import an
--      official list (NAFDAC) in batches, seed again, and decide suggestions.
--   6. Business functions: search the library (name, generic name or barcode), list library matches for unlinked items
--      (barcode first, then name), link and unlink, and suggest an item. master_catalog_page gains a linked/unlinked
--      filter and returns each item's library entry and latest suggestion.
--
-- SECURITY: admin functions are SECURITY DEFINER and refuse anyone but a platform admin. Business link and suggestion
-- functions are SECURITY DEFINER (they write suggestions and mirror prescription status to location products) and
-- require the owner or a manager of that main business (is_business_manager). Direct writes to both new tables are
-- refused. Prescription status only ever becomes stricter automatically, never looser.
--
-- ROLLBACK: drop the functions and triggers below, catalog_suggestions, catalog_items and master_products.catalog_item_id;
-- re-create master_catalog_page from carehub_20261215 (§7).

-- ── 0. Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- The library's matching key: lower case, single spaces, and a number joined to its unit ("500 mg" = "500mg").
create or replace function public.catalog_key(p_text text)
returns text language sql immutable parallel safe set search_path = public, pg_temp as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(regexp_replace(lower(coalesce(p_text, '')), '(\d)\s+(mg|mcg|g|kg|ml|l|iu|mmol|units?)\y', '\1\2', 'g'),
                          '(\d)\s+%', '\1%', 'g'),
           '\s+', ' ', 'g')), '')
$$;

-- A NAFDAC registration number compared without spaces or hyphens, in capitals ("a4 1234" = "A4-1234").
create or replace function public.nafdac_key(p_text text)
returns text language sql immutable parallel safe set search_path = public, pg_temp as $$
  select nullif(upper(regexp_replace(coalesce(p_text, ''), '[\s\-./]+', '', 'g')), '')
$$;

-- Prescription statuses in order of strictness.
create or replace function public.rx_rank(p_status text)
returns integer language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case p_status when 'otc' then 0 when 'pharmacy_only' then 1 when 'prescription_only' then 2 when 'controlled' then 3 else 1 end
$$;

create or replace function public.catalog_require_admin()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only CareHub admins can change the product library.' using errcode = '42501';
  end if;
end $$;

-- ── 1. The library ───────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.catalog_items (
  id             uuid primary key default gen_random_uuid(),
  brand_name     text not null check (char_length(btrim(brand_name)) between 1 and 200),
  generic_name   text check (char_length(generic_name) <= 200),
  strength       text check (char_length(strength) <= 60),
  dose_form      text check (char_length(dose_form) <= 60),
  pack_size      text check (char_length(pack_size) <= 60),
  manufacturer   text check (char_length(manufacturer) <= 200),
  nafdac_no      text check (char_length(nafdac_no) <= 40),
  barcodes       text[] not null default '{}',
  category_code  text references public.product_categories(code),
  rx_status      text not null default 'pharmacy_only' check (rx_status in ('otc', 'pharmacy_only', 'prescription_only', 'controlled')),
  image_url      text check (char_length(image_url) <= 500),
  description    text check (char_length(description) <= 2000),
  status         text not null default 'pending' check (status in ('active', 'pending', 'retired')),
  source         text not null check (source in ('seeded', 'nafdac_import', 'suggested', 'admin')),
  business_count integer not null default 0,
  match_key      text generated always as (public.catalog_key(brand_name || ' ' || coalesce(strength, ''))) stored,
  review_note    text,
  verified_by    uuid,
  verified_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists catalog_items_match_key on public.catalog_items (match_key) where status <> 'retired';
create unique index if not exists catalog_items_nafdac_no on public.catalog_items (public.nafdac_key(nafdac_no)) where status <> 'retired' and nafdac_no is not null;
create index if not exists catalog_items_barcodes on public.catalog_items using gin (barcodes);
create index if not exists catalog_items_status on public.catalog_items (status, business_count desc);
create index if not exists catalog_items_any_key on public.catalog_items (match_key);

-- ── 2. Suggestions from businesses ───────────────────────────────────────────────────────────────────────────────────
create table if not exists public.catalog_suggestions (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  master_product_id uuid references public.master_products(id) on delete set null,
  brand_name        text not null,
  generic_name      text,
  strength          text,
  dose_form         text,
  pack_size         text,
  barcode           text,
  category_code     text,
  rx_status         text,
  note              text check (char_length(note) <= 500),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  catalog_item_id   uuid references public.catalog_items(id) on delete set null,
  suggested_by      uuid,
  suggested_by_email text,
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  review_note       text check (char_length(review_note) <= 500),
  created_at        timestamptz not null default now()
);
create unique index if not exists catalog_suggestions_one_pending on public.catalog_suggestions (master_product_id) where status = 'pending';
create index if not exists catalog_suggestions_status on public.catalog_suggestions (status, created_at);
create index if not exists catalog_suggestions_business on public.catalog_suggestions (business_id, created_at desc);

-- ── 3. Business items linked to the library ─────────────────────────────────────────────────────────────────────────
alter table public.master_products
  add column if not exists catalog_item_id uuid references public.catalog_items(id) on delete set null;
create index if not exists master_products_catalog_item on public.master_products (catalog_item_id) where catalog_item_id is not null;

-- On a new link, the item's empty fields are filled from the library; the link must be to an approved item. On every
-- write of a linked item, its prescription status is at least the library's.
create or replace function public.master_products_library()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_lib public.catalog_items%rowtype;
begin
  if new.catalog_item_id is null then return new; end if;
  select * into v_lib from public.catalog_items where id = new.catalog_item_id;
  if tg_op = 'INSERT' or new.catalog_item_id is distinct from old.catalog_item_id then
    if v_lib.status is distinct from 'active' then
      raise exception 'That library item is not available.' using errcode = '22023';
    end if;
    new.generic_name  := coalesce(nullif(btrim(new.generic_name), ''), v_lib.generic_name);
    new.strength      := coalesce(nullif(btrim(new.strength), ''), v_lib.strength);
    new.dose_form     := coalesce(nullif(btrim(new.dose_form), ''), v_lib.dose_form);
    new.pack_size     := coalesce(nullif(btrim(new.pack_size), ''), v_lib.pack_size);
    new.barcode       := coalesce(nullif(btrim(new.barcode), ''), v_lib.barcodes[1]);
    new.category_code := coalesce(new.category_code, v_lib.category_code);
    new.description   := coalesce(nullif(btrim(new.description), ''), v_lib.description);
  end if;
  if public.rx_rank(new.rx_status) < public.rx_rank(v_lib.rx_status) then
    new.rx_status := v_lib.rx_status;
  end if;
  return new;
end $$;

drop trigger if exists master_products_library on public.master_products;
create trigger master_products_library before insert or update on public.master_products
  for each row execute function public.master_products_library();

-- Location products of the given master items take a stricter prescription status from their item (never a looser
-- one: lowering stays a Push the owner chooses), and a generic name and barcode where they have none.
create or replace function public.catalog_mirror_products(p_master_ids uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  update public.products p
     set rx_status = case when public.rx_rank(m.rx_status) > public.rx_rank(coalesce(p.rx_status, 'otc')) or p.rx_status is null
                          then m.rx_status else p.rx_status end,
         generic_name = coalesce(nullif(btrim(p.generic_name), ''), m.generic_name),
         barcode = coalesce(nullif(btrim(p.barcode), ''), m.barcode)
    from public.master_products m
   where p.master_product_id = m.id and m.id = any(p_master_ids)
     and (p.rx_status is distinct from m.rx_status and (p.rx_status is null or public.rx_rank(m.rx_status) > public.rx_rank(p.rx_status))
          or (nullif(btrim(p.generic_name), '') is null and m.generic_name is not null)
          or (nullif(btrim(p.barcode), '') is null and m.barcode is not null));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- When the library makes an item stricter, every linked business item and its location products follow.
create or replace function public.catalog_items_raise_rx()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids uuid[];
begin
  if public.rx_rank(new.rx_status) <= public.rx_rank(old.rx_status) then return null; end if;
  with raised as (
    update public.master_products set rx_status = new.rx_status
     where catalog_item_id = new.id and public.rx_rank(rx_status) < public.rx_rank(new.rx_status)
    returning id)
  select array_agg(id) into v_ids from raised;
  if v_ids is not null then perform public.catalog_mirror_products(v_ids); end if;
  return null;
end $$;

drop trigger if exists catalog_items_raise_rx on public.catalog_items;
create trigger catalog_items_raise_rx after update of rx_status on public.catalog_items
  for each row execute function public.catalog_items_raise_rx();

create or replace function public.catalog_items_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists catalog_items_touch on public.catalog_items;
create trigger catalog_items_touch before update on public.catalog_items for each row execute function public.catalog_items_touch();

-- ── 4. Seeding from business data ───────────────────────────────────────────────────────────────────────────────────
-- Names used by at least p_min businesses become pending items. Fields are the most common among those businesses
-- (a tie in prescription status goes to the stricter one); barcodes are the ten most used. Returns how many were added.
create or replace function public.catalog_seed_candidates(p_min integer default 2)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  with m as (
    select public.catalog_key(name) as k, business_id, btrim(regexp_replace(name, '\s+', ' ', 'g')) as name,
           nullif(btrim(generic_name), '') as generic_name, category_code, rx_status, nullif(btrim(barcode), '') as barcode
      from public.master_products
     where archived_at is null and public.catalog_key(name) is not null
  ), keys as (
    select k, count(distinct business_id) as n from m group by k having count(distinct business_id) >= greatest(p_min, 2)
  ), spelling as (
    select distinct on (k) k, name from (select m.k, m.name, count(*) as c from m join keys using (k) group by 1, 2) s
     order by k, c desc, char_length(regexp_replace(name, '[^a-z]', '', 'g')) desc, name
  ), generic as (
    select distinct on (k) k, generic_name from (select m.k, m.generic_name, count(*) as c from m join keys using (k)
                                                  where m.generic_name is not null group by 1, 2) s
     order by k, c desc, generic_name
  ), category as (
    select distinct on (k) k, category_code from (select m.k, m.category_code, count(*) as c from m join keys using (k)
                                                   where m.category_code is not null group by 1, 2) s
     order by k, c desc, category_code
  ), rx as (
    select distinct on (k) k, rx_status from (select m.k, m.rx_status, count(*) as c from m join keys using (k) group by 1, 2) s
     order by k, c desc, public.rx_rank(rx_status) desc
  ), codes as (
    select k, (array_agg(barcode order by c desc, barcode))[1:10] as barcodes
      from (select m.k, m.barcode, count(*) as c from m join keys using (k) where m.barcode is not null group by 1, 2) s
     group by k
  ), added as (
    insert into public.catalog_items (brand_name, generic_name, category_code, rx_status, barcodes, status, source, business_count)
    select left(s.name, 200), left(g.generic_name, 200), c.category_code, coalesce(r.rx_status, 'pharmacy_only'),
           coalesce(b.barcodes, '{}'), 'pending', 'seeded', keys.n
      from keys join spelling s using (k)
      left join generic g using (k) left join category c using (k) left join rx r using (k) left join codes b using (k)
     where not exists (select 1 from public.catalog_items ci where ci.match_key = keys.k)
    on conflict do nothing
    returning 1)
  select count(*) into v_n from added;
  return v_n;
end $$;

-- ── 5. Reads ─────────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.catalog_items enable row level security;
alter table public.catalog_suggestions enable row level security;

drop policy if exists "catalog_items read approved" on public.catalog_items;
create policy "catalog_items read approved" on public.catalog_items for select to anon, authenticated
  using (status = 'active' or public.is_platform_admin());

drop policy if exists "catalog_suggestions business and admin read" on public.catalog_suggestions;
create policy "catalog_suggestions business and admin read" on public.catalog_suggestions for select to authenticated
  using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

revoke insert, update, delete, truncate on public.catalog_items, public.catalog_suggestions from anon, authenticated;
grant select on public.catalog_items to anon, authenticated;
grant select on public.catalog_suggestions to authenticated;
grant all on public.catalog_items, public.catalog_suggestions to service_role;

-- What a library item looks like to businesses and CareFind (no reviewer details).
create or replace function public.catalog_item_json(c public.catalog_items)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id', c.id, 'brand_name', c.brand_name, 'generic_name', c.generic_name, 'strength', c.strength,
    'dose_form', c.dose_form, 'pack_size', c.pack_size, 'manufacturer', c.manufacturer, 'nafdac_no', c.nafdac_no,
    'barcodes', c.barcodes, 'category_code', c.category_code, 'rx_status', c.rx_status, 'image_url', c.image_url,
    'description', c.description)
$$;

-- Search the approved library: an exact barcode first, then names and generic names that start with the text, then
-- ones that contain it; more widely used items first.
create or replace function public.catalog_search(p_query text, p_limit integer default 20)
returns table (item jsonb) language sql stable security invoker set search_path = public, pg_temp as $$
  with q as (select btrim(coalesce(p_query, '')) as t, public.catalog_key(p_query) as k)
  select public.catalog_item_json(c)
    from public.catalog_items c, q
   where c.status = 'active' and char_length(q.t) >= 2
     and (q.t = any(c.barcodes) or c.match_key like '%' || q.k || '%' or c.generic_name ilike '%' || q.t || '%')
   order by (q.t = any(c.barcodes)) desc, (c.match_key like q.k || '%') desc, c.business_count desc, c.match_key
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- Unlinked, live items of a business that match an approved library item: by barcode first, then by name and strength.
create or replace function public.catalog_link_matches(p_business_id uuid, p_offset integer default 0, p_limit integer default 50)
returns table (master jsonb, library jsonb, match_by text, total bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  with found as (
    select m.id, m.name, m.generic_name, m.barcode, m.rx_status, m.category_code, x.c, x.mb
      from public.master_products m
      cross join lateral (
        select z.c, z.mb from (
          select c, 'barcode'::text as mb, 0 as o from public.catalog_items c
           where nullif(btrim(m.barcode), '') is not null and btrim(m.barcode) = any(c.barcodes) and c.status = 'active'
          union all
          select c, 'name', 1 from public.catalog_items c
           where c.match_key = public.catalog_key(m.name) and c.status = 'active') z
        order by z.o, (z.c).business_count desc limit 1) x
     where m.business_id = p_business_id and m.archived_at is null and m.catalog_item_id is null
  ), page as (
    select f.*, count(*) over () as total from found f order by f.mb, lower(f.name), f.id
    offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  select jsonb_build_object('id', p.id, 'name', p.name, 'generic_name', p.generic_name, 'barcode', p.barcode,
                            'rx_status', p.rx_status, 'category_code', p.category_code),
         public.catalog_item_json(p.c), p.mb, p.total
    from page p
$$;

-- ── 6. Business actions ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.catalog_require_manager(p_business_id uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_business_id is null or not public.is_business_manager(p_business_id)
     or public.business_root(p_business_id) is distinct from p_business_id then
    raise exception 'Only the owner or a manager of the business can change its catalogue.' using errcode = '42501';
  end if;
end $$;

-- Links items to approved library items: [{master_product_id, catalog_item_id}], up to 500. Each item's empty fields
-- are filled from the library, its prescription status is raised to the library's where lower, and its location
-- products follow. A pending suggestion for a linked item is withdrawn. Returns how many items were linked.
create or replace function public.link_master_to_catalog(p_business_id uuid, p_links jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids uuid[];
begin
  perform public.catalog_require_manager(p_business_id);
  if jsonb_typeof(p_links) is distinct from 'array' or jsonb_array_length(p_links) = 0 then return 0; end if;
  if jsonb_array_length(p_links) > 500 then raise exception 'Link up to 500 items at a time.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_links) l
              left join public.catalog_items c on c.id = (l ->> 'catalog_item_id')::uuid
             where c.id is null or c.status <> 'active') then
    raise exception 'One of those library items is not available any more. Refresh and try again.' using errcode = '22023';
  end if;
  with links as (
    select distinct on ((l ->> 'master_product_id')::uuid) (l ->> 'master_product_id')::uuid as mid, (l ->> 'catalog_item_id')::uuid as cid
      from jsonb_array_elements(p_links) l
  ), done as (
    update public.master_products m set catalog_item_id = links.cid
      from links
     where m.id = links.mid and m.business_id = p_business_id and m.archived_at is null
       and m.catalog_item_id is distinct from links.cid
    returning m.id)
  select array_agg(id) into v_ids from done;
  if v_ids is null then return 0; end if;
  perform public.catalog_mirror_products(v_ids);
  update public.catalog_suggestions set status = 'withdrawn', reviewed_at = now(), review_note = 'Linked to the library by the business.'
   where master_product_id = any(v_ids) and status = 'pending';
  return cardinality(v_ids);
end $$;

-- Removes an item's library link. The item keeps its fields and prescription status.
create or replace function public.unlink_master_from_catalog(p_business_id uuid, p_master_product_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.catalog_require_manager(p_business_id);
  update public.master_products set catalog_item_id = null
   where id = p_master_product_id and business_id = p_business_id and catalog_item_id is not null;
  return found;
end $$;

-- Proposes one of the business's unlinked items for the library, with its current details. Returns the suggestion id.
create or replace function public.suggest_catalog_item(p_business_id uuid, p_master_product_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m public.master_products%rowtype; v_id uuid;
begin
  perform public.catalog_require_manager(p_business_id);
  select * into v_m from public.master_products where id = p_master_product_id and business_id = p_business_id and archived_at is null;
  if not found then raise exception 'That item is not in your catalogue.' using errcode = '22023'; end if;
  if v_m.catalog_item_id is not null then raise exception 'This item is already linked to the library.' using errcode = '22023'; end if;
  if exists (select 1 from public.catalog_suggestions where master_product_id = v_m.id and status = 'pending') then
    raise exception 'This item has already been suggested and is waiting for review.' using errcode = '22023';
  end if;
  insert into public.catalog_suggestions (business_id, master_product_id, brand_name, generic_name, strength, dose_form, pack_size,
                                          barcode, category_code, rx_status, note, suggested_by, suggested_by_email)
  values (p_business_id, v_m.id, v_m.name, v_m.generic_name, v_m.strength, v_m.dose_form, v_m.pack_size, v_m.barcode,
          v_m.category_code, v_m.rx_status, nullif(left(btrim(coalesce(p_note, '')), 500), ''), auth.uid(), auth.email())
  returning id into v_id;
  return v_id;
end $$;

-- ── 7. Admin actions ─────────────────────────────────────────────────────────────────────────────────────────────────
-- One page of the library for review: by status ('pending', 'active', 'retired'), source and search, most widely used
-- first. `linked` is how many business items are linked to each.
create or replace function public.admin_catalog_page(p_status text default 'pending', p_source text default null,
  p_search text default null, p_offset integer default 0, p_limit integer default 50)
returns table (item jsonb, linked bigint, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.catalog_require_admin();
  return query
  with matching as (
    select c.* from public.catalog_items c
     where c.status = coalesce(p_status, 'pending')
       and (p_source is null or c.source = p_source)
       and (coalesce(btrim(p_search), '') = ''
            or c.match_key like '%' || public.catalog_key(p_search) || '%'
            or c.generic_name ilike '%' || btrim(p_search) || '%'
            or public.nafdac_key(c.nafdac_no) like public.nafdac_key(p_search) || '%'
            or btrim(p_search) = any(c.barcodes))
  ), page as (
    select m.id, count(*) over () as n from matching m order by m.business_count desc, m.match_key, m.id
    offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  select public.catalog_item_json(c)
           || jsonb_build_object('status', c.status, 'source', c.source, 'business_count', c.business_count,
                                 'review_note', c.review_note, 'verified_at', c.verified_at, 'updated_at', c.updated_at),
         (select count(*) from public.master_products mp where mp.catalog_item_id = c.id),
         p.n
    from page p join public.catalog_items c on c.id = p.id
   order by c.business_count desc, c.match_key, c.id;
end $$;

-- Cleans the editable fields of a library item from jsonb. Barcodes: an array or a comma-separated text.
create or replace function public.catalog_clean_barcodes(p_value jsonb)
returns text[] language sql immutable set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct b) filter (where b ~ '^[0-9A-Za-z-]{4,32}$'), '{}')
    from (select btrim(x) as b
            from jsonb_array_elements_text(case jsonb_typeof(p_value) when 'array' then p_value
                                                 when 'string' then to_jsonb(regexp_split_to_array(p_value #>> '{}', '[,;\s]+'))
                                                 else '[]'::jsonb end) x) s
$$;

-- Creates (p_id null: approved, source 'admin') or updates a library item. Returns the item.
create or replace function public.admin_save_catalog_item(p_id uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.catalog_items%rowtype; v_name text := btrim(coalesce(p_fields ->> 'brand_name', ''));
  v_rx text := nullif(p_fields ->> 'rx_status', ''); v_cat text := nullif(p_fields ->> 'category_code', '');
begin
  perform public.catalog_require_admin();
  if v_name = '' then raise exception 'Enter the product name.' using errcode = '22023'; end if;
  if v_rx is not null and v_rx not in ('otc', 'pharmacy_only', 'prescription_only', 'controlled') then
    raise exception 'Choose a prescription status from the list.' using errcode = '22023';
  end if;
  if v_cat is not null and not exists (select 1 from public.product_categories where code = v_cat) then
    raise exception 'Choose a category from the list.' using errcode = '22023';
  end if;
  begin
    if p_id is null then
      insert into public.catalog_items (brand_name, generic_name, strength, dose_form, pack_size, manufacturer, nafdac_no, barcodes,
                                        category_code, rx_status, image_url, description, status, source, verified_by, verified_at)
      values (left(v_name, 200), nullif(btrim(p_fields ->> 'generic_name'), ''), nullif(btrim(p_fields ->> 'strength'), ''),
              nullif(btrim(p_fields ->> 'dose_form'), ''), nullif(btrim(p_fields ->> 'pack_size'), ''),
              nullif(btrim(p_fields ->> 'manufacturer'), ''), nullif(upper(btrim(p_fields ->> 'nafdac_no')), ''),
              public.catalog_clean_barcodes(p_fields -> 'barcodes'), v_cat, coalesce(v_rx, public.rx_status_for(v_cat)),
              nullif(btrim(p_fields ->> 'image_url'), ''), nullif(btrim(p_fields ->> 'description'), ''),
              'active', 'admin', auth.uid(), now())
      returning * into v_row;
    else
      update public.catalog_items set
        brand_name = left(v_name, 200),
        generic_name = nullif(btrim(p_fields ->> 'generic_name'), ''),
        strength = nullif(btrim(p_fields ->> 'strength'), ''),
        dose_form = nullif(btrim(p_fields ->> 'dose_form'), ''),
        pack_size = nullif(btrim(p_fields ->> 'pack_size'), ''),
        manufacturer = nullif(btrim(p_fields ->> 'manufacturer'), ''),
        nafdac_no = nullif(upper(btrim(p_fields ->> 'nafdac_no')), ''),
        barcodes = public.catalog_clean_barcodes(p_fields -> 'barcodes'),
        category_code = v_cat,
        rx_status = coalesce(v_rx, rx_status),
        image_url = nullif(btrim(p_fields ->> 'image_url'), ''),
        description = nullif(btrim(p_fields ->> 'description'), '')
       where id = p_id
      returning * into v_row;
      if not found then raise exception 'That library item no longer exists.' using errcode = '22023'; end if;
    end if;
  exception when unique_violation then
    raise exception 'Another library item already has this name and strength, or this NAFDAC number. Search for it and merge instead.'
      using errcode = '23505';
  end;
  return public.catalog_item_json(v_row) || jsonb_build_object('status', v_row.status, 'source', v_row.source);
end $$;

-- Approves, retires or reopens many items. Retiring removes business links (the business items keep their details).
-- Reopening puts a retired item back in the queue. Returns how many items changed.
create or replace function public.admin_review_catalog_items(p_ids uuid[], p_action text, p_note text default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  perform public.catalog_require_admin();
  if cardinality(coalesce(p_ids, '{}')) > 500 then raise exception 'Review up to 500 items at a time.' using errcode = '22023'; end if;
  if p_action = 'approve' then
    update public.catalog_items set status = 'active', verified_by = auth.uid(), verified_at = now(),
           review_note = coalesce(nullif(btrim(p_note), ''), review_note)
     where id = any(p_ids) and status = 'pending';
    get diagnostics v_n = row_count;
  elsif p_action = 'retire' then
    update public.master_products set catalog_item_id = null where catalog_item_id = any(p_ids);
    update public.catalog_items set status = 'retired', review_note = coalesce(nullif(btrim(p_note), ''), review_note)
     where id = any(p_ids) and status <> 'retired';
    get diagnostics v_n = row_count;
  elsif p_action = 'reopen' then
    begin
      update public.catalog_items set status = 'pending', verified_by = null, verified_at = null
       where id = any(p_ids) and status = 'retired';
      get diagnostics v_n = row_count;
    exception when unique_violation then
      raise exception 'Another item with the same name and strength is already in the library.' using errcode = '23505';
    end;
  else
    raise exception 'Unknown review action.' using errcode = '22023';
  end if;
  return v_n;
end $$;

-- Merges p_drop into p_keep (which must be approved): business links and suggestions move to p_keep, which takes
-- p_drop's barcodes and any details it lacks; p_drop is retired. Returns how many business items moved.
create or replace function public.admin_merge_catalog_items(p_keep uuid, p_drop uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_keep public.catalog_items%rowtype; v_drop public.catalog_items%rowtype; v_ids uuid[];
begin
  perform public.catalog_require_admin();
  if p_keep = p_drop then raise exception 'Choose two different items.' using errcode = '22023'; end if;
  select * into v_keep from public.catalog_items where id = p_keep for update;
  select * into v_drop from public.catalog_items where id = p_drop for update;
  if v_keep.id is null or v_drop.id is null then raise exception 'That library item no longer exists.' using errcode = '22023'; end if;
  if v_keep.status <> 'active' then raise exception 'Approve the item you keep first.' using errcode = '22023'; end if;
  update public.catalog_items set status = 'retired', review_note = 'Merged into ' || v_keep.brand_name where id = v_drop.id;
  update public.catalog_items set
    barcodes = (select coalesce(array_agg(distinct b), '{}') from unnest(v_keep.barcodes || v_drop.barcodes) b),
    generic_name = coalesce(generic_name, v_drop.generic_name), strength = coalesce(strength, v_drop.strength),
    dose_form = coalesce(dose_form, v_drop.dose_form), pack_size = coalesce(pack_size, v_drop.pack_size),
    manufacturer = coalesce(manufacturer, v_drop.manufacturer), nafdac_no = coalesce(nafdac_no, v_drop.nafdac_no),
    category_code = coalesce(category_code, v_drop.category_code), image_url = coalesce(image_url, v_drop.image_url),
    description = coalesce(description, v_drop.description),
    rx_status = case when public.rx_rank(v_drop.rx_status) > public.rx_rank(rx_status) then v_drop.rx_status else rx_status end,
    business_count = greatest(business_count, v_drop.business_count)
   where id = v_keep.id;
  with moved as (update public.master_products set catalog_item_id = v_keep.id where catalog_item_id = v_drop.id returning id)
  select array_agg(id) into v_ids from moved;
  update public.catalog_suggestions set catalog_item_id = v_keep.id where catalog_item_id = v_drop.id;
  if v_ids is not null then perform public.catalog_mirror_products(v_ids); end if;
  return coalesce(cardinality(v_ids), 0);
end $$;

-- Maps a prescription class as written in an official list to a status ('POM' → prescription_only, …).
create or replace function public.catalog_rx_from_text(p_text text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_text is null or btrim(p_text) = '' then null
    when lower(btrim(p_text)) in ('otc', 'over the counter', 'over-the-counter', 'gsl', 'general sale') then 'otc'
    when lower(btrim(p_text)) in ('p', 'pharmacy', 'pharmacy only', 'pharmacy_only', 'pharmacy medicine') then 'pharmacy_only'
    when lower(btrim(p_text)) in ('pom', 'rx', 'prescription', 'prescription only', 'prescription_only', 'prescription-only medicine', 'prescription only medicine') then 'prescription_only'
    when lower(btrim(p_text)) in ('cd', 'controlled', 'controlled drug', 'narcotic', 'psychotropic') then 'controlled'
    else null end
$$;

-- Imports up to 1000 rows of an official list (NAFDAC). Each row is matched to the library by NAFDAC number, then by
-- name and strength. A match gets the row's details where it has none, the barcodes, a stricter prescription status
-- if the row has one, and is approved. Anything else is added, approved. Returns counts and the first 50 problems
-- ({row, reason}); `row` is the position in p_rows (0-based).
create or replace function public.admin_import_catalog_items(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb; i integer := -1; v_name text; v_nafdac text; v_strength text; v_rx text; v_cat text; v_codes text[];
  v_found public.catalog_items%rowtype; v_ins integer := 0; v_upd integer := 0; v_skip integer := 0; v_errors jsonb := '[]';
begin
  perform public.catalog_require_admin();
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Send the rows as a list.' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'Import up to 1000 rows at a time.' using errcode = '22023'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_name := left(btrim(regexp_replace(coalesce(r ->> 'brand_name', ''), '\s+', ' ', 'g')), 200);
    v_nafdac := nullif(upper(btrim(regexp_replace(coalesce(r ->> 'nafdac_no', ''), '\s+', ' ', 'g'))), '');
    v_strength := nullif(left(btrim(coalesce(r ->> 'strength', '')), 60), '');
    v_cat := case when nullif(btrim(r ->> 'category'), '') is null then null else public.category_code_for(r ->> 'category') end;
    v_rx := coalesce(public.catalog_rx_from_text(r ->> 'rx_status'), case when v_cat is null then null else public.rx_status_for(r ->> 'category') end);
    v_codes := public.catalog_clean_barcodes(r -> 'barcodes');
    if v_name = '' then
      v_skip := v_skip + 1;
      if jsonb_array_length(v_errors) < 50 then v_errors := v_errors || jsonb_build_object('row', i, 'reason', 'No product name'); end if;
      continue;
    end if;
    begin
      v_found := null;
      if v_nafdac is not null then
        select * into v_found from public.catalog_items where public.nafdac_key(nafdac_no) = public.nafdac_key(v_nafdac) and status <> 'retired' limit 1;
      end if;
      if v_found.id is null then
        select * into v_found from public.catalog_items
         where match_key = public.catalog_key(v_name || ' ' || coalesce(v_strength, '')) and status <> 'retired' limit 1;
      end if;
      if v_found.id is null then
        insert into public.catalog_items (brand_name, generic_name, strength, dose_form, pack_size, manufacturer, nafdac_no, barcodes,
                                          category_code, rx_status, status, source, verified_by, verified_at)
        values (v_name, nullif(left(btrim(coalesce(r ->> 'generic_name', '')), 200), ''), v_strength,
                nullif(left(btrim(coalesce(r ->> 'dose_form', '')), 60), ''), nullif(left(btrim(coalesce(r ->> 'pack_size', '')), 60), ''),
                nullif(left(btrim(coalesce(r ->> 'manufacturer', '')), 200), ''), left(v_nafdac, 40), v_codes, v_cat,
                coalesce(v_rx, 'pharmacy_only'), 'active', 'nafdac_import', auth.uid(), now());
        v_ins := v_ins + 1;
      else
        update public.catalog_items set
          generic_name = coalesce(generic_name, nullif(left(btrim(coalesce(r ->> 'generic_name', '')), 200), '')),
          dose_form = coalesce(dose_form, nullif(left(btrim(coalesce(r ->> 'dose_form', '')), 60), '')),
          pack_size = coalesce(pack_size, nullif(left(btrim(coalesce(r ->> 'pack_size', '')), 60), '')),
          manufacturer = coalesce(manufacturer, nullif(left(btrim(coalesce(r ->> 'manufacturer', '')), 200), '')),
          nafdac_no = coalesce(nafdac_no, left(v_nafdac, 40)),
          barcodes = (select coalesce(array_agg(distinct b), '{}') from unnest(barcodes || v_codes) b),
          category_code = coalesce(category_code, v_cat),
          rx_status = case when v_rx is not null and public.rx_rank(v_rx) > public.rx_rank(rx_status) then v_rx else rx_status end,
          status = 'active', verified_by = coalesce(verified_by, auth.uid()), verified_at = coalesce(verified_at, now())
         where id = v_found.id;
        v_upd := v_upd + 1;
      end if;
    exception when unique_violation or check_violation or foreign_key_violation then
      v_skip := v_skip + 1;
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('row', i, 'reason',
          case when sqlstate = '23505' then 'Same NAFDAC number or name as another library item' else 'A value is too long or not valid' end);
      end if;
    end;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skip, 'errors', v_errors);
end $$;

-- Seeds again from today's business data (admin). Returns how many candidates were added.
create or replace function public.admin_seed_catalog_candidates(p_min integer default 2)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.catalog_require_admin();
  return public.catalog_seed_candidates(p_min);
end $$;

-- Suggestions for review, newest first, with the business's name and any library item with the same name and strength.
create or replace function public.admin_catalog_suggestions(p_status text default 'pending', p_offset integer default 0, p_limit integer default 50)
returns table (suggestion jsonb, business_name text, existing jsonb, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.catalog_require_admin();
  return query
  with page as (
    select s.*, count(*) over () as n from public.catalog_suggestions s
     where s.status = coalesce(p_status, 'pending')
     order by s.created_at desc, s.id
    offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  select to_jsonb(p) - 'n', b.name,
         (select public.catalog_item_json(c) || jsonb_build_object('status', c.status) from public.catalog_items c
           where c.status <> 'retired'
             and (c.match_key = public.catalog_key(p.brand_name || ' ' || coalesce(p.strength, ''))
                  or (p.barcode is not null and p.barcode = any(c.barcodes)))
           order by (c.status = 'active') desc limit 1),
         p.n
    from page p left join public.businesses b on b.id = p.business_id
   order by p.created_at desc, p.id;
end $$;

-- Decides a suggestion: 'create' adds it to the library (approved, with p_fields as edited by the admin) and links the
-- business's item; 'link' links the item to an existing approved library item; 'reject' records why. The business
-- owner is notified. Returns the library item id ('create', 'link') or null.
create or replace function public.admin_decide_catalog_suggestion(p_id uuid, p_action text, p_catalog_item_id uuid default null,
  p_fields jsonb default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s public.catalog_suggestions%rowtype; v_item uuid; v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  perform public.catalog_require_admin();
  select * into v_s from public.catalog_suggestions where id = p_id for update;
  if not found then raise exception 'That suggestion no longer exists.' using errcode = '22023'; end if;
  if v_s.status <> 'pending' then raise exception 'That suggestion has already been decided.' using errcode = '22023'; end if;

  if p_action = 'create' then
    v_item := (public.admin_save_catalog_item(null, coalesce(p_fields, jsonb_build_object(
      'brand_name', v_s.brand_name, 'generic_name', v_s.generic_name, 'strength', v_s.strength, 'dose_form', v_s.dose_form,
      'pack_size', v_s.pack_size, 'barcodes', coalesce(to_jsonb(array_remove(array[v_s.barcode], null)), '[]'::jsonb),
      'category_code', v_s.category_code, 'rx_status', v_s.rx_status))) ->> 'id')::uuid;
    update public.catalog_items set source = 'suggested', business_count = greatest(business_count, 1) where id = v_item;
  elsif p_action = 'link' then
    if not exists (select 1 from public.catalog_items where id = p_catalog_item_id and status = 'active') then
      raise exception 'Choose an approved library item.' using errcode = '22023';
    end if;
    v_item := p_catalog_item_id;
  elsif p_action = 'reject' then
    v_item := null;
  else
    raise exception 'Unknown decision.' using errcode = '22023';
  end if;

  update public.catalog_suggestions
     set status = case when p_action = 'reject' then 'rejected' else 'approved' end, catalog_item_id = v_item,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
   where id = v_s.id;

  if v_item is not null and v_s.master_product_id is not null then
    update public.master_products set catalog_item_id = v_item
     where id = v_s.master_product_id and archived_at is null and catalog_item_id is null;
    if found then perform public.catalog_mirror_products(array[v_s.master_product_id]); end if;
  end if;

  insert into public.staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  values (v_s.business_id, null, true,
          case when p_action = 'reject' then 'catalog_suggestion_rejected' else 'catalog_suggestion_approved' end,
          case when p_action = 'reject' then 'Library suggestion not added' else 'Added to the CareHub library' end,
          v_s.brand_name || case when p_action = 'reject' then ' was not added' || coalesce(': ' || v_note, '.')
                                 else ' is now linked to the CareHub library.' end,
          '/dashboard/mastercatalog');
  return v_item;
end $$;

-- ── 8. The Master Catalog screen: library details and a linked / unlinked filter ────────────────────────────────────
drop function if exists public.master_catalog_page(uuid, text, text, boolean, integer, integer, text);
create or replace function public.master_catalog_page(
  p_business_id uuid, p_search text default null, p_category text default null,
  p_archived boolean default false, p_offset integer default 0, p_limit integer default 50, p_rx text default null,
  p_library text default null)
returns table (item jsonb, carried jsonb, total bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  with matching as (
    select m.* from public.master_products m
     where m.business_id = p_business_id
       and (case when p_archived then m.archived_at is not null else m.archived_at is null end)
       and (p_category is null or m.category_code = p_category)
       and (p_rx is null or m.rx_status = p_rx)
       and (p_library is null or (p_library = 'linked') = (m.catalog_item_id is not null))
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

-- ── 9. Seed the review queue ─────────────────────────────────────────────────────────────────────────────────────────
select public.catalog_seed_candidates(2);

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.master_products_library(), public.catalog_items_raise_rx(), public.catalog_items_touch(),
  public.catalog_mirror_products(uuid[]), public.catalog_seed_candidates(integer) from public, anon, authenticated;
revoke all on function public.catalog_require_admin(), public.catalog_require_manager(uuid) from public, anon;
revoke all on function public.link_master_to_catalog(uuid, jsonb), public.unlink_master_from_catalog(uuid, uuid),
  public.suggest_catalog_item(uuid, uuid, text), public.catalog_link_matches(uuid, integer, integer),
  public.master_catalog_page(uuid, text, text, boolean, integer, integer, text, text),
  public.admin_catalog_page(text, text, text, integer, integer), public.admin_save_catalog_item(uuid, jsonb),
  public.admin_review_catalog_items(uuid[], text, text), public.admin_merge_catalog_items(uuid, uuid),
  public.admin_import_catalog_items(jsonb), public.admin_seed_catalog_candidates(integer),
  public.admin_catalog_suggestions(text, integer, integer), public.admin_decide_catalog_suggestion(uuid, text, uuid, jsonb, text)
  from public, anon;
grant execute on function public.catalog_key(text), public.rx_rank(text), public.catalog_item_json(public.catalog_items),
  public.catalog_search(text, integer), public.catalog_clean_barcodes(jsonb), public.catalog_rx_from_text(text), public.nafdac_key(text)
  to anon, authenticated, service_role;
grant execute on function public.link_master_to_catalog(uuid, jsonb), public.unlink_master_from_catalog(uuid, uuid),
  public.suggest_catalog_item(uuid, uuid, text), public.catalog_link_matches(uuid, integer, integer),
  public.master_catalog_page(uuid, text, text, boolean, integer, integer, text, text),
  public.admin_catalog_page(text, text, text, integer, integer), public.admin_save_catalog_item(uuid, jsonb),
  public.admin_review_catalog_items(uuid[], text, text), public.admin_merge_catalog_items(uuid, uuid),
  public.admin_import_catalog_items(jsonb), public.admin_seed_catalog_candidates(integer),
  public.admin_catalog_suggestions(text, integer, integer), public.admin_decide_catalog_suggestion(uuid, text, uuid, jsonb, text),
  public.catalog_require_admin(), public.catalog_require_manager(uuid)
  to authenticated, service_role;
