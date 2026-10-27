-- Product catalogue, phase 1: the business master catalogue becomes the home of every product, linked by id.
-- Design: docs/architecture/Product-Catalogue-Design.md (owner's decisions, 2026-10-27).
--
-- Written against the LIVE schema read on 2026-10-27:
--   * products: 11,348 business products, typed by hand per location; free-text category ("Medicines" 60%,
--     "ANAGELSIC" / "ANALGESIC", ~130 spellings). No link to any master row.
--   * master_products(id, business_id, name, description, category, default_price integer): 2 rows in total.
--   * branch_products(branch_id, master_product_id, active, override_price integer): activation links.
--   * activate_branch_product / push_master_product matched a branch's product to its master product BY NAME, so a
--     rename or a different spelling broke the link, and the seeding of a new branch was a browser loop.
--
-- WHAT THIS DOES (nothing is deleted; products.category is left as typed)
--   1. product_categories (a standard list of ~22 groups, each with a default prescription status) and
--      category_aliases (every spelling in use mapped to a group). category_code_for(text) applies it.
--   2. master_products gains the product facts (generic name, strength, form, pack size, barcode, standard category,
--      prescription status, default cost, reorder level), a normalised name key, archiving, and a unique
--      (business, name key) so one business cannot hold the same product twice.
--   3. products gains master_product_id (the link), rx_status (mirrored) and price_source ('master': the branch sells
--      at the master price and Push updates it; 'branch': the branch set its own price and Push leaves it).
--   4. Backfill: every business product gets a master item in its main business (one per normalised name across all
--      of its locations), and is linked to it and carried at its location.
--   5. Auto-add (owner's decision): a product added at any location, by hand, import or purchase, is linked to the
--      master item of the same name, creating it if needed. Staff routines do not change.
--   6. carry_master_items(): carry many master items at a branch in one call, by id (creates the branch product at
--      stock 0 when missing). activate_branch_product keeps its signature and now uses it.
--      push_master_product(): updates every linked product by id: name, generic name, category, prescription status,
--      and price where the branch follows the master price.
--   7. master_catalog_page(): one page of the master catalogue with, per item, where it is carried, at what price
--      and stock, for the Master Catalog screen.
--
-- SECURITY: no permission is widened. Reads and writes stay under the existing RLS (members of the business tree).
-- The auto-add trigger is SECURITY DEFINER only to create the master row in the main business when the person adding
-- the product works at a branch; it copies only the new product's own fields. The carry and push functions check
-- membership of the branch and of the master item's business explicitly. Plan limits and restrictions
-- (carehub_20261214) still apply to every product row created here.
--
-- ROLLBACK: drop the triggers products_link_master and products_price_source and the functions added here; drop
-- the added columns (products.master_product_id, rx_status, price_source; master_products' new columns); drop
-- product_categories and category_aliases. Re-apply the previous activate_branch_product / push_master_product.

-- ── 1. Standard categories ───────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.product_categories (
  code        text primary key,
  label       text not null,
  rx_default  text not null check (rx_default in ('otc', 'pharmacy_only', 'prescription_only', 'controlled')),
  sort        integer not null default 100
);
insert into public.product_categories (code, label, rx_default, sort) values
  ('analgesics',         'Pain relief',                              'otc',               10),
  ('antibiotics',        'Antibiotics & anti-infectives',            'prescription_only', 20),
  ('antimalarials',      'Antimalarials',                            'pharmacy_only',     30),
  ('cardiovascular',     'Heart, blood pressure & cholesterol',      'prescription_only', 40),
  ('antidiabetics',      'Diabetes',                                 'prescription_only', 50),
  ('gastro',             'Stomach & digestion',                      'pharmacy_only',     60),
  ('cough_cold_allergy', 'Cough, cold & allergy',                    'otc',               70),
  ('respiratory',        'Asthma & inhalers',                        'prescription_only', 80),
  ('antifungal_worm',    'Antifungals & dewormers',                  'pharmacy_only',     90),
  ('nervous_system',     'Sleep, mood & muscle relaxants',           'prescription_only', 100),
  ('injections',         'Injections & infusions',                   'prescription_only', 110),
  ('eye_ear_nose',       'Eye, ear & nose',                          'pharmacy_only',     120),
  ('skin',               'Skin, creams & lotions',                   'otc',               130),
  ('vitamins',           'Vitamins, supplements & tonics',           'otc',               140),
  ('sexual_health',      'Sexual & reproductive health',             'pharmacy_only',     150),
  ('mother_baby',        'Mother, baby & child',                     'otc',               160),
  ('herbal',             'Herbal & homeopathic',                     'otc',               170),
  ('devices',            'Devices, tests & consumables',             'otc',               180),
  ('personal_care',      'Personal care & household',                'otc',               190),
  ('food_drinks',        'Food & drinks',                            'otc',               200),
  ('general_retail',     'General & minimart',                       'otc',               210),
  ('services',           'Services',                                 'otc',               220),
  ('medicines_other',    'Other medicines',                          'pharmacy_only',     230)
on conflict (code) do update set label = excluded.label, rx_default = excluded.rx_default, sort = excluded.sort;

-- Spellings in use (upper-cased, trimmed) → standard group. rx_status set here overrides the group default.
create table if not exists public.category_aliases (
  alias      text primary key,
  code       text not null references public.product_categories(code),
  rx_status  text check (rx_status in ('otc', 'pharmacy_only', 'prescription_only', 'controlled'))
);
insert into public.category_aliases (alias, code, rx_status) values
  ('ANALGESIC','analgesics',null),('ANALGESICS','analgesics',null),('ANAGELSIC','analgesics',null),('PAIN RELIEF','analgesics',null),
  ('ANTIBIOTICS','antibiotics',null),('ANTIBIOTIC','antibiotics',null),('ANTI BACTERIAL','antibiotics',null),('ANTI-INFECTIVES','antibiotics',null),('ANTIVIRAL','antibiotics',null),
  ('ANTIMALARIAL','antimalarials',null),('ANTIMALARIA','antimalarials',null),('ANTI MALARIA','antimalarials',null),
  ('ANTIHYPERTENSIVE','cardiovascular',null),('ANTIHYPERTENSIVES','cardiovascular',null),('ANTI HYPERTENSIVES','cardiovascular',null),('STATINS','cardiovascular',null),('ANTI CHOLESTEROL','cardiovascular',null),
  ('ANTIDIABETICS','antidiabetics',null),('ANTI DIABETICS','antidiabetics',null),
  ('ANTACID','gastro','otc'),('ANTIULCER','gastro',null),('ANTI ULCER','gastro',null),('ANTI-DIARRHOEAL','gastro',null),('ANTIDIARRHEAL','gastro',null),('ORS','gastro','otc'),('ANTIEMETIC','gastro',null),('ANTISPASMODIC','gastro',null),('ENZYMATIC','gastro',null),
  ('COUGH PREPARATIONS','cough_cold_allergy',null),('COUGH SYR','cough_cold_allergy',null),('ANTITUSSIVE','cough_cold_allergy',null),('LOZENGES','cough_cold_allergy',null),('COLD REMEDY','cough_cold_allergy',null),('ANTI-COLD','cough_cold_allergy',null),('ANTIHISTAMINE','cough_cold_allergy',null),('ANTI HISTAMINE','cough_cold_allergy',null),('ANTIALLERGIC','cough_cold_allergy',null),('NASAL DECONGESTANT','cough_cold_allergy',null),
  ('INHALER','respiratory',null),('ANTIASHMATIC','respiratory',null),
  ('ANTIFUNGAL','antifungal_worm',null),('ANTI FUNGI','antifungal_worm',null),('ANTIHELMINTHICS','antifungal_worm',null),('ANTI HELMINTHICS','antifungal_worm',null),('WORM EXPELLER','antifungal_worm',null),
  ('SEDATIVE','nervous_system',null),('MUSCLE RELAXANT','nervous_system',null),
  ('INJECTIONS','injections',null),('INJECTION','injections',null),('INFUSION','injections',null),('DRIPS','injections',null),('IV FLUIDS','injections',null),
  ('EYE DROP','eye_ear_nose',null),('EAR PREP','eye_ear_nose',null),('DROP','eye_ear_nose',null),
  ('CREAM','skin',null),('LOTION','skin',null),('GEL','skin',null),('BALM','skin',null),('SKINCARE','skin',null),('ANTI ITCHING','skin',null),
  ('SUPPLEMENT','vitamins',null),('SUPPLEMENTS','vitamins',null),('MULTIVITAMINS','vitamins',null),('MULTIVITAMIN','vitamins',null),('VITAMINS','vitamins',null),('BLOOD TONICS','vitamins',null),('HEMATINICS','vitamins',null),('TONIC','vitamins',null),
  ('WOMEN HEALTH','sexual_health',null),('MEN HEALTH','sexual_health',null),('VAGINAL SUPPOSITORY','sexual_health',null),('VIGINAL SUPPOSITORY','sexual_health',null),('CONTRACEPTIVES','sexual_health',null),('CONTRACEPTIVE','sexual_health',null),('ANTICONCEPTIVES','sexual_health',null),('CONDOM','sexual_health','otc'),('LUBRICANT','sexual_health','otc'),('APRODISIAC','sexual_health',null),('ARPHRODISIAC','sexual_health',null),('ENHANCERS','sexual_health',null),
  ('CHILDREN HEALTH','mother_baby',null),('CHILD HEALTH SUPPLEMENT','mother_baby',null),('INFANT/CHILD CARE','mother_baby',null),
  ('HOMEOPATHIC','herbal',null),('HERBAL MISTURE','herbal',null),('BITTERS','herbal',null),
  ('CONSUMABLES','devices',null),('NEEDLE','devices',null),('PLASTER','devices',null),('BANDAGE','devices',null),('DIAGNOSTICS','devices',null),('TESTS','devices',null),('STRIP','devices',null),('EQUIPMENT','devices',null),('INFUSION SETS','devices',null),('DISPOSABLES','devices',null),('TOOLS','devices',null),
  ('SOAP','personal_care',null),('TOILTERIES','personal_care',null),('TOILETRIES','personal_care',null),('ROLL ON','personal_care',null),('COSMETICS','personal_care',null),('OIL','personal_care',null),('DISINFECTANT','personal_care',null),('INSECTICIDE','personal_care',null),('HOME USE','personal_care',null),
  ('DRINKS','food_drinks',null),('WATER','food_drinks',null),('BREAD','food_drinks',null),('YOUGHURT','food_drinks',null),('CONFECTIONARIES','food_drinks',null),('PROVISIONS','food_drinks',null),
  ('MINIMART','general_retail',null),('GENERAL','general_retail',null),('OTHER','general_retail',null),
  ('SERVICES','services',null),
  ('MEDICINES','medicines_other',null),('DRUGS','medicines_other',null),('PHARM','medicines_other',null),('PRESCRIPTION','medicines_other','prescription_only'),
  ('DISPERSIBLE','medicines_other',null),('SUPPOSITORY','medicines_other',null),('SPRAY','medicines_other',null),('LIQUIDS','medicines_other',null),('SOLUTION','medicines_other',null),('DRAGEES','medicines_other',null),('POWDER','medicines_other',null)
on conflict (alias) do update set code = excluded.code, rx_status = excluded.rx_status;

create or replace function public.category_code_for(p_category text)
returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (select a.code from public.category_aliases a where a.alias = upper(btrim(coalesce(p_category, '')))),
    (select c.code from public.product_categories c where c.code = lower(btrim(coalesce(p_category, '')))),
    case when btrim(coalesce(p_category, '')) = '' then null else 'medicines_other' end)
$$;

create or replace function public.rx_status_for(p_category text)
returns text language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    (select a.rx_status from public.category_aliases a where a.alias = upper(btrim(coalesce(p_category, '')))),
    (select c.rx_default from public.product_categories c where c.code = public.category_code_for(p_category)),
    'pharmacy_only')
$$;

-- ── 2. Master items ──────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.master_products
  add column if not exists generic_name  text,
  add column if not exists strength      text,
  add column if not exists dose_form     text,
  add column if not exists pack_size     text,
  add column if not exists barcode       text,
  add column if not exists category_code text references public.product_categories(code),
  add column if not exists rx_status     text not null default 'pharmacy_only'
    check (rx_status in ('otc', 'pharmacy_only', 'prescription_only', 'controlled')),
  add column if not exists default_cost  numeric(14,2) not null default 0 check (default_cost >= 0),
  add column if not exists reorder_level integer not null default 5 check (reorder_level >= 0),
  add column if not exists archived_at   timestamptz,
  add column if not exists name_key      text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored;

create unique index if not exists master_products_business_name_key
  on public.master_products (business_id, name_key) where archived_at is null;
create index if not exists master_products_business_category on public.master_products (business_id, category_code);

-- ── 3. Product links ─────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.products
  add column if not exists master_product_id uuid references public.master_products(id) on delete set null,
  add column if not exists rx_status text check (rx_status in ('otc', 'pharmacy_only', 'prescription_only', 'controlled')),
  add column if not exists price_source text not null default 'master' check (price_source in ('master', 'branch'));
create index if not exists products_master_product on public.products (master_product_id) where master_product_id is not null;
create index if not exists products_business_master on public.products (business_id, master_product_id);

-- The main business of any location (a branch's top-most parent; a main business is its own). A signed-in user gets
-- an answer only for a location they belong to (or as a platform admin); server code and migrations always do.
create or replace function public.business_root(p_business_id uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  with recursive up(id, parent_business_id, depth) as (
    select b.id, b.parent_business_id, 0 from public.businesses b where b.id = p_business_id
    union all
    select p.id, p.parent_business_id, up.depth + 1 from public.businesses p join up on p.id = up.parent_business_id where up.depth < 10
  )
  select id from up
   where parent_business_id is null
     and (coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') not in ('authenticated', 'anon')
          or p_business_id in (select public.current_business_ids())
          or public.is_platform_admin())
   limit 1
$$;

-- ── 4. Backfill ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- One master item per (main business, normalised name). Its fields come from the location rows: the most common
-- spelling, the first generic name and barcode, the most common category, and the median price and cost.
with recursive tree(id, root, depth) as (
  select b.id, b.id, 0 from public.businesses b where b.parent_business_id is null
  union all
  select c.id, t.root, t.depth + 1 from public.businesses c join tree t on c.parent_business_id = t.id where t.depth < 10
),
p as (
  select t.root, lower(regexp_replace(btrim(pr.name), '\s+', ' ', 'g')) as name_key, pr.*
    from public.products pr join tree t on t.id = pr.business_id
   where pr.master_product_id is null and btrim(coalesce(pr.name, '')) <> ''
),
spelling as (
  select distinct on (root, name_key) root, name_key, btrim(name) as name
    from (select root, name_key, name, count(*) over (partition by root, name_key, btrim(name)) as n from p) s
   order by root, name_key, n desc, name
),
category as (
  select distinct on (root, name_key) root, name_key, category
    from (select root, name_key, category, count(*) as n from p where btrim(coalesce(category, '')) <> '' group by 1, 2, 3) s
   order by root, name_key, n desc, category
),
facts as (
  select root, name_key,
         max(nullif(btrim(generic_name), '')) as generic_name,
         max(nullif(btrim(barcode), '')) as barcode,
         coalesce(percentile_disc(0.5) within group (order by price) filter (where price > 0), 0) as price,
         coalesce(percentile_disc(0.5) within group (order by cost_price) filter (where cost_price > 0), 0) as cost,
         coalesce(max(reorder_level), 5) as reorder_level
    from p group by root, name_key
)
insert into public.master_products (business_id, name, category, default_price, generic_name, barcode, category_code, rx_status,
                                    default_cost, reorder_level, description)
select s.root, s.name, coalesce(c.category, ''), round(f.price)::integer, f.generic_name, f.barcode,
       public.category_code_for(c.category), public.rx_status_for(c.category), round(f.cost, 2), greatest(f.reorder_level, 0), ''
  from spelling s join facts f using (root, name_key) left join category c using (root, name_key)
on conflict (business_id, name_key) where archived_at is null do nothing;

-- Existing master rows (created before this migration) get a standard category and prescription status too.
update public.master_products m
   set category_code = coalesce(m.category_code, public.category_code_for(m.category)),
       rx_status = case when m.category_code is null then public.rx_status_for(m.category) else m.rx_status end
 where m.category_code is null;

-- Link every business product to its master item, and mark whether it sells at the master price.
with recursive tree(id, root, depth) as (
  select b.id, b.id, 0 from public.businesses b where b.parent_business_id is null
  union all
  select c.id, t.root, t.depth + 1 from public.businesses c join tree t on c.parent_business_id = t.id where t.depth < 10
)
update public.products pr
   set master_product_id = m.id,
       rx_status = m.rx_status,
       price_source = case when round(coalesce(pr.price, 0)) = m.default_price then 'master' else 'branch' end
  from tree t, public.master_products m
 where t.id = pr.business_id
   and pr.master_product_id is null
   and m.business_id = t.root
   and m.archived_at is null
   and m.name_key = lower(regexp_replace(btrim(pr.name), '\s+', ' ', 'g'));

-- Every linked product is carried at its location.
insert into public.branch_products (branch_id, master_product_id, active, override_price)
select distinct on (pr.business_id, pr.master_product_id) pr.business_id, pr.master_product_id, true, null
  from public.products pr
 where pr.master_product_id is not null
on conflict (branch_id, master_product_id) do nothing;

-- ── 5. Auto-add: every new product joins the master catalogue ───────────────────────────────────────────────────────
create or replace function public.products_link_master()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_root uuid; v_key text; v_master public.master_products%rowtype;
begin
  if new.business_id is null or btrim(coalesce(new.name, '')) = '' then return new; end if;
  if new.master_product_id is not null then
    -- Linked by the caller (carry_master_items): the link must be in this location's own catalogue.
    select * into v_master from public.master_products where id = new.master_product_id;
    if not found or v_master.business_id is distinct from public.business_root(new.business_id) then
      raise exception 'That master product belongs to another business.' using errcode = '42501';
    end if;
  else
    v_root := public.business_root(new.business_id);
    if v_root is null then return new; end if;
    v_key := lower(regexp_replace(btrim(new.name), '\s+', ' ', 'g'));
    insert into public.master_products (business_id, name, category, default_price, generic_name, barcode, category_code,
                                        rx_status, default_cost, reorder_level, description)
    values (v_root, btrim(new.name), coalesce(new.category, ''), round(greatest(coalesce(new.price, 0), 0))::integer,
            nullif(btrim(new.generic_name), ''), nullif(btrim(new.barcode), ''), public.category_code_for(new.category),
            public.rx_status_for(new.category), round(greatest(coalesce(new.cost_price, 0), 0), 2),
            greatest(coalesce(new.reorder_level, 5), 0), '')
    on conflict (business_id, name_key) where archived_at is null do nothing;
    select * into v_master from public.master_products where business_id = v_root and name_key = v_key and archived_at is null;
    new.master_product_id := v_master.id;
    new.price_source := case when round(coalesce(new.price, 0)) = v_master.default_price then 'master' else 'branch' end;
  end if;
  new.rx_status := coalesce(new.rx_status, v_master.rx_status);
  insert into public.branch_products (branch_id, master_product_id, active, override_price)
  values (new.business_id, v_master.id, true, null)
  on conflict (branch_id, master_product_id) do update set active = true;
  return new;
end $$;

drop trigger if exists products_link_master on public.products;
create trigger products_link_master before insert on public.products
  for each row execute function public.products_link_master();

-- A price typed at the branch (Inventory, Purchases) means the branch sets its own price from now on; a price set by
-- Push (which marks itself with carehub.catalog_push) keeps following the master.
create or replace function public.products_price_source()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.price is distinct from old.price and coalesce(current_setting('carehub.catalog_push', true), '') <> 'on' then
    new.price_source := 'branch';
  end if;
  return new;
end $$;

drop trigger if exists products_price_source on public.products;
create trigger products_price_source before update of price on public.products
  for each row execute function public.products_price_source();

-- ── 6. Carry and push, by id ─────────────────────────────────────────────────────────────────────────────────────────
-- Carries master items at a branch: creates the branch's product (stock 0) where it has none, and (re)activates the
-- carrying link. p_price, when given, is that branch's own price for every item carried in this call. Returns how
-- many items are now carried. SECURITY INVOKER: RLS and the explicit membership checks decide what the caller can do.
create or replace function public.carry_master_items(p_branch_id uuid, p_master_ids uuid[], p_price numeric default null)
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_root uuid; v_count integer := 0; m public.master_products%rowtype;
begin
  if p_branch_id is null or p_master_ids is null then return 0; end if;
  if p_branch_id not in (select public.current_business_ids()) and not public.is_platform_admin() then
    raise exception 'Location not found.' using errcode = '42501';
  end if;
  if p_price is not null and p_price <= 0 then
    raise exception 'The price must be greater than zero.' using errcode = '23514';
  end if;
  v_root := public.business_root(p_branch_id);
  for m in select * from public.master_products where id = any(p_master_ids) and business_id = v_root and archived_at is null loop
    if not exists (select 1 from public.products where business_id = p_branch_id and master_product_id = m.id) then
      insert into public.products (business_id, master_product_id, name, generic_name, category, price, cost_price, stock,
                                   reorder_level, barcode, sale_type, list_on_carefind, emoji, rx_status, price_source)
      values (p_branch_id, m.id, m.name, coalesce(m.generic_name, ''), m.category, coalesce(p_price, m.default_price),
              m.default_cost, 0, m.reorder_level, m.barcode, 'retail', true, '💊', m.rx_status,
              case when p_price is null then 'master' else 'branch' end);
    elsif p_price is not null then
      perform set_config('carehub.catalog_push', 'on', true);
      update public.products set price = p_price, price_source = 'branch'
       where business_id = p_branch_id and master_product_id = m.id;
      perform set_config('carehub.catalog_push', '', true);
    end if;
    insert into public.branch_products (branch_id, master_product_id, active, override_price)
    values (p_branch_id, m.id, true, case when p_price is null then null else round(p_price)::integer end)
    on conflict (branch_id, master_product_id) do update set active = true,
      override_price = coalesce(excluded.override_price, public.branch_products.override_price);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Kept for existing callers (Locations' new-branch seeding, the old page): one item, now by id.
create or replace function public.activate_branch_product(p_branch_id uuid, p_master_product_id uuid, p_override_price integer default null)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_branch_id is null or p_master_product_id is null then return null; end if;
  if p_override_price is not null and p_override_price <= 0 then
    raise exception 'Override price must be greater than zero.' using errcode = 'check_violation';
  end if;
  perform public.carry_master_items(p_branch_id, array[p_master_product_id], p_override_price);
  select id into v_id from public.products where business_id = p_branch_id and master_product_id = p_master_product_id limit 1;
  return v_id;
end $$;

-- Sends a master item's facts to every product linked to it, at every location of the business. The price reaches
-- only products that follow the master price. Returns how many products were updated.
create or replace function public.push_master_product(p_master_product_id uuid, p_business_id uuid)
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_master public.master_products%rowtype; v_updated integer;
begin
  select * into v_master from public.master_products
   where id = p_master_product_id and business_id = p_business_id and business_id in (select public.current_business_ids());
  if not found then return null; end if;
  perform set_config('carehub.catalog_push', 'on', true);
  update public.products p
     set name = v_master.name,
         generic_name = coalesce(v_master.generic_name, p.generic_name),
         category = v_master.category,
         barcode = coalesce(v_master.barcode, p.barcode),
         rx_status = v_master.rx_status,
         price = case when p.price_source = 'master' then v_master.default_price else p.price end
   where p.master_product_id = v_master.id
     and p.business_id in (select public.current_business_ids());
  get diagnostics v_updated = row_count;
  perform set_config('carehub.catalog_push', '', true);
  return v_updated;
end $$;

-- ── 7. The Master Catalog screen ─────────────────────────────────────────────────────────────────────────────────────
-- One page of master items with, for each, the locations carrying it (price, stock, whether the price follows the
-- master, and whether the location still carries it), filtered by search (name, generic name, barcode), standard category and archive state. `total` is the
-- number of matching items. SECURITY INVOKER: RLS limits it to the caller's business tree.
create or replace function public.master_catalog_page(
  p_business_id uuid, p_search text default null, p_category text default null,
  p_archived boolean default false, p_offset integer default 0, p_limit integer default 50)
returns table (item jsonb, carried jsonb, total bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  with matching as (
    select m.* from public.master_products m
     where m.business_id = p_business_id
       and (case when p_archived then m.archived_at is not null else m.archived_at is null end)
       and (p_category is null or m.category_code = p_category)
       and (coalesce(btrim(p_search), '') = ''
            or m.name ilike '%' || btrim(p_search) || '%'
            or m.generic_name ilike '%' || btrim(p_search) || '%'
            or m.barcode = btrim(p_search))
  ), page as (
    select m.*, count(*) over () as total from matching m order by m.name_key, m.id
    offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 200)
  )
  select to_jsonb(pg) - 'total' - 'name_key',
         coalesce((select jsonb_agg(jsonb_build_object('branch_id', pr.business_id, 'product_id', pr.id, 'price', pr.price,
                                                       'stock', pr.stock, 'price_source', pr.price_source,
                                                       'active', coalesce(bp.active, true)) order by pr.business_id, pr.price)
                     from public.products pr
                     left join public.branch_products bp on bp.branch_id = pr.business_id and bp.master_product_id = pg.id
                    where pr.master_product_id = pg.id), '[]'::jsonb),
         pg.total
    from page pg
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────────────
grant select on public.product_categories, public.category_aliases to anon, authenticated;
revoke insert, update, delete on public.product_categories, public.category_aliases from anon, authenticated;
revoke all on function public.products_link_master() from public, anon, authenticated;
revoke all on function public.products_price_source() from public, anon, authenticated;
revoke all on function public.business_root(uuid) from public, anon;
revoke all on function public.carry_master_items(uuid, uuid[], numeric) from public, anon;
revoke all on function public.master_catalog_page(uuid, text, text, boolean, integer, integer) from public, anon;
grant execute on function public.business_root(uuid), public.carry_master_items(uuid, uuid[], numeric),
  public.master_catalog_page(uuid, text, text, boolean, integer, integer), public.category_code_for(text),
  public.rx_status_for(text) to authenticated, service_role;
