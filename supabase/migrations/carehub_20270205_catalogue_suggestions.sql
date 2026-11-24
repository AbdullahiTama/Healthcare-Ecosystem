-- Product catalogue, phase 6: smart clean-up. Suggested categories and prices that the owner reviews and accepts in bulk.
-- Design: docs/architecture/Product-Catalogue-Design.md §11 (owner's decision, 2026-11-24).
--
-- Written against the LIVE data read on 2026-11-24:
--   * 13,611 current master items have no specific category (none, or "Other medicines"); 1,283 have no price, and
--     1,212 listed products are hidden on CareFind for having none (phase 5).
--   * The CareHub library has no approved item yet, so it cannot help today (it is used as soon as it can).
--   * The category text businesses typed is often clear but not in the spelling map: SUPERMARKET (1,553 items),
--     SUPPLEMENTS/VITAMINS (272), ANTIBOTICS (119), EYE DROPS/OINTMENTS, BODY CREAMS/LOTIONS… About 2,400 items.
--   * "MEDICINES" (8,997) and "DRUGS" (1,339) say nothing; the product name does: a reviewed keyword list of drug
--     names, brands and forms ("amoxicillin", "coartem", "metformin", "inj", "eye", "cream") matches 5,223 items.
--   * The same name with a specific category at another business: 469 items.
--   * Prices: 4 items are priced at their own locations, 86 more under the same name at 3 or more other businesses.
--
-- WHAT THIS DOES
--   1. category_aliases gains the clear spellings above (new items are mapped by them from now on, as before).
--   2. category_keywords: the reviewed keyword list (one word each; lower number = checked first, so a form such as an
--      injection or eye drop wins over the drug class, and the drug class over a generic form such as a cream).
--   3. catalogue_category_suggestions(business): for each current item without a specific category, the best
--      suggestion and why: its library entry, its own category text, the category most other businesses give the same
--      name, or a keyword in its name or generic name.
--   4. catalogue_price_suggestions(business): for each current item without a price, the median price at its own
--      locations, else the median price of the same name at 3 or more other businesses (rounded to ₦10).
--   5. apply_catalogue_fixes(business, fixes, push_prices): applies the accepted ones (up to 500), only where the item
--      still has the problem, and optionally gives the price to its location products that follow the master price and
--      have none, so they reappear on CareFind.
--   6. catalogue_suggestion_dismissals / dismiss_catalogue_suggestions: "don't suggest this again" per item and kind.
--
-- SECURITY: no permission is widened. All functions are SECURITY DEFINER and require the owner or a manager of the main
-- business (catalog_require_manager); every write is scoped to that business. The suggestion functions read other
-- businesses' items only as aggregates: which category most of them use for a name, how many businesses use it, and a
-- median price only when at least three other businesses sell that name, so no single business's price is shown.
-- Nothing is applied without the owner choosing it. EXECUTE is revoked from anon explicitly (Supabase grants new
-- functions to anon directly; see carehub_20270204).
--
-- ROLLBACK: drop the functions below, catalogue_suggestion_dismissals, category_keywords, the index
-- master_products_name_key_live, and the aliases inserted in section 1 (listed there). Accepted fixes stay applied.

-- ── 1. Clear category spellings ──────────────────────────────────────────────────────────────────────────────────────
insert into public.category_aliases (alias, code, rx_status) values
  ('SUPERMARKET','general_retail',null), ('SUPPLEMENTS/VITAMINS','vitamins',null), ('ANTIBOTICS','antibiotics',null),
  ('BEAUTY','personal_care',null), ('SANITARY/HYGIENE','personal_care',null), ('EYE DROPS/OINTMENTS','eye_ear_nose',null),
  ('EYE DROPS','eye_ear_nose',null), ('EYE PREPARATION','eye_ear_nose',null), ('NASAL DROP','eye_ear_nose',null),
  ('PAIN RELIEVERS/OINTMENTS','analgesics',null), ('BODY CREAMS/LOTIONS','skin',null), ('BISCUIT','food_drinks',null),
  ('JAM','food_drinks',null), ('FAMILY PLANNING/CONDOMS/EMERGENCY SEX PILLS','sexual_health',null),
  ('ANTIALLERGY','cough_cold_allergy',null), ('ANTI ALLERGIES','cough_cold_allergy',null), ('ANTITUSIVES','cough_cold_allergy',null),
  ('BODY SPRAY','personal_care',null), ('MOUTHWASH','personal_care',null), ('MEDICAL CONSUMABLES','devices',null),
  ('ANTIHELMINTHS','antifungal_worm',null), ('ANTI-FUNGI','antifungal_worm',null), ('HERBAL SUPPLEMENT','herbal',null),
  ('OTHER CARDIAC DRUGS','cardiovascular',null), ('ASMATICS','respiratory',null)
on conflict (alias) do nothing;

-- ── 2. Keywords in product names ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.category_keywords (
  word     text primary key check (word = lower(word) and word ~ '^[a-z0-9]+$'),
  code     text not null references public.product_categories(code),
  priority integer not null default 50
);
alter table public.category_keywords enable row level security;
revoke all on public.category_keywords from public, anon, authenticated;
grant all on public.category_keywords to service_role;

insert into public.category_keywords (word, code, priority) values
  -- injections
  ('inj','injections',10), ('injection','injections',10), ('injections','injections',10), ('infusion','injections',10), ('ampoule','injections',10), ('ampoules','injections',10), ('vial','injections',10), ('dextrose','injections',10), ('saline','injections',10), ('ringer','injections',10), ('ringers','injections',10), ('lactate','injections',10), ('darrows','injections',10),
  -- eye_ear_nose
  ('eye','eye_ear_nose',20), ('ear','eye_ear_nose',20), ('nasal','eye_ear_nose',20), ('otrivin','eye_ear_nose',20), ('otic','eye_ear_nose',20), ('ophthalmic','eye_ear_nose',20),
  -- antimalarials
  ('artemether','antimalarials',30), ('lumefantrine','antimalarials',30), ('coartem','antimalarials',30), ('lonart','antimalarials',30), ('artesunate','antimalarials',30), ('amatem','antimalarials',30), ('quinine','antimalarials',30), ('chloroquine','antimalarials',30), ('camoquine','antimalarials',30), ('amodiaquine','antimalarials',30), ('sulfadoxine','antimalarials',30), ('fansidar','antimalarials',30), ('maloxine','antimalarials',30), ('proguanil','antimalarials',30), ('dihydroartemisinin','antimalarials',30), ('alaxin','antimalarials',30), ('lokmal','antimalarials',30), ('artequin','antimalarials',30), ('arthemeter','antimalarials',30), ('artemisinin','antimalarials',30), ('malareich','antimalarials',30), ('amalar','antimalarials',30), ('coatal','antimalarials',30),
  -- antibiotics
  ('amoxicillin','antibiotics',30), ('amoxil','antibiotics',30), ('ampicillin','antibiotics',30), ('ampiclox','antibiotics',30), ('augmentin','antibiotics',30), ('amoxiclav','antibiotics',30), ('cipro','antibiotics',30), ('ciprofloxacin','antibiotics',30), ('ciprotab','antibiotics',30), ('levofloxacin','antibiotics',30), ('ofloxacin','antibiotics',30), ('norfloxacin','antibiotics',30), ('metronidazole','antibiotics',30), ('flagyl','antibiotics',30), ('tinidazole','antibiotics',30), ('azithromycin','antibiotics',30), ('erythromycin','antibiotics',30), ('clarithromycin','antibiotics',30), ('cefuroxime','antibiotics',30), ('zinnat','antibiotics',30), ('ceftriaxone','antibiotics',30), ('cefixime','antibiotics',30), ('cephalexin','antibiotics',30), ('cefalexin','antibiotics',30), ('doxycycline','antibiotics',30), ('tetracycline','antibiotics',30), ('cotrimoxazole','antibiotics',30), ('septrin','antibiotics',30), ('gentamicin','antibiotics',30), ('clindamycin','antibiotics',30), ('nitrofurantoin','antibiotics',30), ('penicillin','antibiotics',30), ('cloxacillin','antibiotics',30), ('flucloxacillin','antibiotics',30), ('acyclovir','antibiotics',30), ('aciclovir','antibiotics',30), ('secnidazole','antibiotics',30), ('ceftazidime','antibiotics',30), ('cefpodoxime','antibiotics',30), ('linezolid','antibiotics',30),
  -- cardiovascular
  ('amlodipine','cardiovascular',30), ('lisinopril','cardiovascular',30), ('losartan','cardiovascular',30), ('nifedipine','cardiovascular',30), ('atenolol','cardiovascular',30), ('hydrochlorothiazide','cardiovascular',30), ('methyldopa','cardiovascular',30), ('aldomet','cardiovascular',30), ('atorvastatin','cardiovascular',30), ('simvastatin','cardiovascular',30), ('rosuvastatin','cardiovascular',30), ('propranolol','cardiovascular',30), ('furosemide','cardiovascular',30), ('lasix','cardiovascular',30), ('valsartan','cardiovascular',30), ('telmisartan','cardiovascular',30), ('candesartan','cardiovascular',30), ('bisoprolol','cardiovascular',30), ('carvedilol','cardiovascular',30), ('spironolactone','cardiovascular',30), ('moduretic','cardiovascular',30), ('amiloride','cardiovascular',30), ('clopidogrel','cardiovascular',30), ('digoxin','cardiovascular',30), ('enalapril','cardiovascular',30), ('ramipril','cardiovascular',30),
  -- antidiabetics
  ('metformin','antidiabetics',30), ('glibenclamide','antidiabetics',30), ('glimepiride','antidiabetics',30), ('gliclazide','antidiabetics',30), ('insulin','antidiabetics',30), ('sitagliptin','antidiabetics',30), ('pioglitazone','antidiabetics',30), ('glucophage','antidiabetics',30), ('daonil','antidiabetics',30),
  -- gastro
  ('omeprazole','gastro',30), ('esomeprazole','gastro',30), ('pantoprazole','gastro',30), ('lansoprazole','gastro',30), ('rabeprazole','gastro',30), ('ranitidine','gastro',30), ('cimetidine','gastro',30), ('famotidine','gastro',30), ('antacid','gastro',30), ('gestid','gastro',30), ('gaviscon','gastro',30), ('loperamide','gastro',30), ('imodium','gastro',30), ('buscopan','gastro',30), ('hyoscine','gastro',30), ('metoclopramide','gastro',30), ('plasil','gastro',30), ('ors','gastro',30), ('ondansetron','gastro',30), ('bisacodyl','gastro',30), ('dulcolax','gastro',30), ('lactulose','gastro',30), ('simethicone','gastro',30), ('magnesium','gastro',30), ('trisilicate','gastro',30),
  -- cough_cold_allergy
  ('loratadine','cough_cold_allergy',30), ('cetirizine','cough_cold_allergy',30), ('piriton','cough_cold_allergy',30), ('chlorpheniramine','cough_cold_allergy',30), ('promethazine','cough_cold_allergy',30), ('phenergan','cough_cold_allergy',30), ('benylin','cough_cold_allergy',30), ('cough','cough_cold_allergy',30), ('catarrh','cough_cold_allergy',30), ('coldcap','cough_cold_allergy',30), ('tuxil','cough_cold_allergy',30), ('dextromethorphan','cough_cold_allergy',30), ('guaifenesin','cough_cold_allergy',30), ('actifed','cough_cold_allergy',30), ('pseudoephedrine','cough_cold_allergy',30), ('fexofenadine','cough_cold_allergy',30), ('desloratadine','cough_cold_allergy',30), ('lozenge','cough_cold_allergy',30), ('lozenges','cough_cold_allergy',30), ('strepsils','cough_cold_allergy',30), ('tixylix','cough_cold_allergy',30), ('robitussin','cough_cold_allergy',30),
  -- respiratory
  ('salbutamol','respiratory',30), ('ventolin','respiratory',30), ('inhaler','respiratory',30), ('aminophylline','respiratory',30), ('montelukast','respiratory',30), ('budesonide','respiratory',30), ('seretide','respiratory',30),
  -- antifungal_worm
  ('fluconazole','antifungal_worm',30), ('ketoconazole','antifungal_worm',30), ('clotrimazole','antifungal_worm',30), ('miconazole','antifungal_worm',30), ('nystatin','antifungal_worm',30), ('griseofulvin','antifungal_worm',30), ('terbinafine','antifungal_worm',30), ('albendazole','antifungal_worm',30), ('mebendazole','antifungal_worm',30), ('vermox','antifungal_worm',30), ('zentel','antifungal_worm',30), ('ivermectin','antifungal_worm',30), ('praziquantel','antifungal_worm',30),
  -- nervous_system
  ('diazepam','nervous_system',30), ('valium','nervous_system',30), ('amitriptyline','nervous_system',30), ('carbamazepine','nervous_system',30), ('phenobarbitone','nervous_system',30), ('phenobarbital','nervous_system',30), ('haloperidol','nervous_system',30), ('chlorpromazine','nervous_system',30), ('olanzapine','nervous_system',30), ('fluoxetine','nervous_system',30), ('sertraline','nervous_system',30), ('gabapentin','nervous_system',30), ('pregabalin','nervous_system',30), ('orphenadrine','nervous_system',30),
  -- analgesics
  ('paracetamol','analgesics',30), ('panadol','analgesics',30), ('ibuprofen','analgesics',30), ('diclofenac','analgesics',30), ('piroxicam','analgesics',30), ('aspirin','analgesics',30), ('naproxen','analgesics',30), ('meloxicam','analgesics',30), ('celecoxib','analgesics',30), ('ketoprofen','analgesics',30), ('mefenamic','analgesics',30), ('ponstan','analgesics',30), ('cafenol','analgesics',30), ('feldene','analgesics',30), ('felvin','analgesics',30), ('analgin','analgesics',30), ('pcm','analgesics',30), ('emzor','analgesics',30), ('boska','analgesics',30),
  -- vitamins
  ('vitamin','vitamins',40), ('vitamins','vitamins',40), ('vit','vitamins',40), ('multivitamin','vitamins',40), ('multivitamins','vitamins',40), ('folic','vitamins',40), ('ferrous','vitamins',40), ('zinc','vitamins',40), ('calcium','vitamins',40), ('bcomplex','vitamins',40), ('astymin','vitamins',40), ('chemiron','vitamins',40), ('haematinic','vitamins',40), ('tonic','vitamins',40), ('omega','vitamins',40), ('cod','vitamins',40), ('centrum','vitamins',40), ('pregnacare','vitamins',40), ('wellman','vitamins',40), ('wellwoman','vitamins',40), ('vitabiotics','vitamins',40),
  -- sexual_health
  ('condom','sexual_health',40), ('condoms','sexual_health',40), ('postinor','sexual_health',40), ('contraceptive','sexual_health',40), ('lubricant','sexual_health',40), ('sildenafil','sexual_health',40), ('viagra','sexual_health',40), ('tadalafil','sexual_health',40), ('clomid','sexual_health',40), ('clomiphene','sexual_health',40),
  -- devices
  ('syringe','devices',40), ('syringes','devices',40), ('needle','devices',40), ('needles','devices',40), ('cannula','devices',40), ('glove','devices',40), ('gloves','devices',40), ('strip','devices',40), ('strips','devices',40), ('plaster','devices',40), ('plasters','devices',40), ('bandage','devices',40), ('gauze','devices',40), ('cotton','devices',40), ('thermometer','devices',40), ('glucometer','devices',40), ('catheter','devices',40), ('mask','devices',40), ('masks','devices',40),
  -- mother_baby
  ('diaper','mother_baby',40), ('diapers','mother_baby',40), ('baby','mother_baby',40), ('pampers','mother_baby',40), ('similac','mother_baby',40), ('cerelac','mother_baby',40), ('teether','mother_baby',40),
  -- personal_care
  ('toothpaste','personal_care',50), ('toothbrush','personal_care',50), ('soap','personal_care',50), ('pad','personal_care',50), ('pads','personal_care',50), ('deodorant','personal_care',50), ('perfume','personal_care',50), ('shampoo','personal_care',50), ('detergent','personal_care',50), ('dettol','personal_care',50), ('izal','personal_care',50),
  -- skin
  ('cream','skin',60), ('ointment','skin',60), ('lotion','skin',60), ('balm','skin',60),
  -- food_drinks
  ('milk','food_drinks',70), ('milo','food_drinks',70), ('biscuit','food_drinks',70), ('biscuits','food_drinks',70), ('juice','food_drinks',70), ('water','food_drinks',70), ('drink','food_drinks',70), ('malt','food_drinks',70), ('tea','food_drinks',70), ('coffee','food_drinks',70), ('sugar','food_drinks',70), ('noodles','food_drinks',70),
  -- food sold by pharmacies that names a skin form ("ice cream")
  ('ice','food_drinks',5), ('icecream','food_drinks',5)
on conflict (word) do update set code = excluded.code, priority = excluded.priority;

-- ── 3. What the owner dismissed ──────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.catalogue_suggestion_dismissals (
  master_product_id uuid not null references public.master_products(id) on delete cascade,
  kind              text not null check (kind in ('category', 'price')),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  dismissed_by      uuid,
  created_at        timestamptz not null default now(),
  primary key (master_product_id, kind)
);
create index if not exists catalogue_suggestion_dismissals_business on public.catalogue_suggestion_dismissals (business_id);
alter table public.catalogue_suggestion_dismissals enable row level security;
drop policy if exists "catalogue_suggestion_dismissals members read" on public.catalogue_suggestion_dismissals;
create policy "catalogue_suggestion_dismissals members read" on public.catalogue_suggestion_dismissals for select to authenticated
  using (business_id in (select public.current_business_ids()));
revoke all on public.catalogue_suggestion_dismissals from public, anon, authenticated;
grant select on public.catalogue_suggestion_dismissals to authenticated;
grant all on public.catalogue_suggestion_dismissals to service_role;

-- Other businesses' items are looked up by name.
create index if not exists master_products_name_key_live on public.master_products (name_key) where archived_at is null;

-- ── 4. Category suggestions ──────────────────────────────────────────────────────────────────────────────────────────
-- One row per current item without a specific category that has a suggestion, strongest reason first:
--   library   its CareHub library entry has a category (detail: the library name);
--   text      the category text the business typed maps to a standard group (detail: that text);
--   elsewhere other businesses give the same name a category, the most common one (detail: how many businesses);
--   keyword   a word in its name or generic name (detail: the word).
create or replace function public.catalogue_category_suggestions(p_business_id uuid, p_offset integer default 0, p_limit integer default 50)
returns table (item jsonb, category_code text, reason text, detail text, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.catalog_require_manager(p_business_id);
  return query
  with items as (
    select m.* from public.master_products m
     where m.business_id = p_business_id and m.archived_at is null
       and (m.category_code is null or m.category_code = 'medicines_other')
       and not exists (select 1 from public.catalogue_suggestion_dismissals d where d.master_product_id = m.id and d.kind = 'category')
  ), found as (
    select i.id, c.category_code as code, 'library'::text as why, c.brand_name::text as said, 1 as strength
      from items i join public.catalog_items c on c.id = i.catalog_item_id and c.status = 'active'
     where c.category_code is not null and c.category_code <> 'medicines_other'
    union all
    select i.id, public.category_code_for(i.category), 'text', btrim(i.category), 2
      from items i where public.category_code_for(i.category) <> 'medicines_other'
    union all
    select * from (
      select distinct on (i.id) i.id, x.category_code, 'elsewhere', count(distinct x.business_id)::text, 3
        from items i join public.master_products x on x.name_key = i.name_key and x.archived_at is null and x.business_id <> p_business_id
       where x.category_code is not null and x.category_code <> 'medicines_other'
       group by i.id, x.category_code
       order by i.id, count(distinct x.business_id) desc, x.category_code) e
    union all
    select * from (
      select distinct on (i.id) i.id, k.code, 'keyword', k.word, 4
        from items i
        cross join lateral regexp_split_to_table(i.name_key || ' ' || lower(coalesce(i.generic_name, '')), '[^a-z0-9]+') as t(word)
        join public.category_keywords k on k.word = t.word
       order by i.id, k.priority, k.word) w
  ), best as (
    select distinct on (f.id) f.* from found f order by f.id, f.strength
  ), page as (
    select b.*, i.name_key, count(*) over () as n
      from best b join items i on i.id = b.id
     order by b.strength, i.name_key, b.id
    offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 500)
  )
  select jsonb_build_object('id', i.id, 'name', i.name, 'generic_name', i.generic_name, 'category', i.category,
                            'category_code', i.category_code, 'rx_status', i.rx_status),
         p.code, p.why, p.said, p.n
    from page p join items i on i.id = p.id
   order by p.strength, p.name_key, p.id;
end $$;

-- ── 5. Price suggestions ─────────────────────────────────────────────────────────────────────────────────────────────
-- One row per current item without a price (services aside) that has a suggestion:
--   locations  the median price of its own location products that have one (detail: how many);
--   elsewhere  the median default price of the same name at 3 or more other businesses, rounded to ₦10 (detail: how many).
-- item.hidden counts its location products hidden on CareFind for having no price.
create or replace function public.catalogue_price_suggestions(p_business_id uuid, p_offset integer default 0, p_limit integer default 50)
returns table (item jsonb, price integer, reason text, detail text, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.catalog_require_manager(p_business_id);
  return query
  with items as (
    select m.* from public.master_products m
     where m.business_id = p_business_id and m.archived_at is null
       and coalesce(m.default_price, 0) <= 0 and coalesce(m.category_code, '') <> 'services'
       and not exists (select 1 from public.catalogue_suggestion_dismissals d where d.master_product_id = m.id and d.kind = 'price')
  ), found as (
    select i.id, round(percentile_cont(0.5) within group (order by p.price))::integer as amount, 'locations'::text as why,
           count(*)::text as said, 1 as strength
      from items i join public.products p on p.master_product_id = i.id and p.price > 0
     group by i.id
    union all
    select i.id, (round(percentile_cont(0.5) within group (order by x.default_price) / 10) * 10)::integer, 'elsewhere',
           count(distinct x.business_id)::text, 2
      from items i join public.master_products x on x.name_key = i.name_key and x.archived_at is null
                                                 and x.business_id <> p_business_id and x.default_price > 0
     group by i.id
    having count(distinct x.business_id) >= 3
  ), best as (
    select distinct on (f.id) f.* from found f where f.amount > 0 order by f.id, f.strength
  ), page as (
    select b.*, i.name_key, count(*) over () as n
      from best b join items i on i.id = b.id
     order by b.strength, i.name_key, b.id
    offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 500)
  )
  select jsonb_build_object('id', i.id, 'name', i.name, 'generic_name', i.generic_name, 'category_code', i.category_code,
                            'hidden', (select count(*) from public.products pr
                                        where pr.master_product_id = i.id and pr.list_on_carefind = true
                                          and public.is_carefind_unpriced(pr.rx_status, pr.price))),
         p.amount, p.why, p.said, p.n
    from page p join items i on i.id = p.id
   order by p.strength, p.name_key, p.id;
end $$;

-- ── 6. Applying what the owner accepted ──────────────────────────────────────────────────────────────────────────────
-- p_fixes: [{ "id": <master item>, "category_code": <code> } | { "id": …, "default_price": <naira> }, …], up to 500.
-- A fix applies only to a current item of this business that still has the problem (no specific category; no price),
-- so nothing typed since the suggestions were shown is overwritten. With p_push_prices, each newly priced item's
-- location products that follow the master price and have none take it (they reappear on CareFind); a location's own
-- price is never changed. Returns { categories, prices, location_prices }.
create or replace function public.apply_catalogue_fixes(p_business_id uuid, p_fixes jsonb, p_push_prices boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_categories integer := 0; v_prices integer := 0; v_locations integer := 0; v_priced uuid[];
begin
  perform public.catalog_require_manager(p_business_id);
  if p_fixes is null or jsonb_typeof(p_fixes) <> 'array' then
    raise exception 'Nothing to apply.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_fixes) > 500 then
    raise exception 'Apply up to 500 fixes at a time.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_fixes) e
              where coalesce(e->>'id', '') !~ '^[0-9a-fA-F-]{36}$'
                 or (e ? 'default_price' and coalesce(e->>'default_price', '') !~ '^[0-9]+(\.[0-9]+)?$')) then
    raise exception 'Some of these fixes are not valid. Reload the suggestions and try again.' using errcode = '22023';
  end if;

  update public.master_products m
     set category_code = f.code, updated_at = now()
    from (select distinct on ((e->>'id')::uuid) (e->>'id')::uuid as id, e->>'category_code' as code
            from jsonb_array_elements(p_fixes) e where e ? 'category_code') f
   where m.id = f.id and m.business_id = p_business_id and m.archived_at is null
     and (m.category_code is null or m.category_code = 'medicines_other')
     and f.code in (select c.code from public.product_categories c where c.code <> 'medicines_other');
  get diagnostics v_categories = row_count;

  with f as (
    select distinct on ((e->>'id')::uuid) (e->>'id')::uuid as id, round((e->>'default_price')::numeric)::integer as price
      from jsonb_array_elements(p_fixes) e where e ? 'default_price'
  ), done as (
    update public.master_products m
       set default_price = f.price, updated_at = now()
      from f
     where m.id = f.id and m.business_id = p_business_id and m.archived_at is null
       and coalesce(m.default_price, 0) <= 0 and f.price between 1 and 100000000
    returning m.id
  )
  select coalesce(array_agg(id), '{}') into v_priced from done;
  v_prices := cardinality(v_priced);

  if p_push_prices and v_prices > 0 then
    perform set_config('carehub.catalog_push', 'on', true);
    update public.products p
       set price = m.default_price
      from public.master_products m
     where p.master_product_id = m.id and m.id = any(v_priced)
       and p.price_source = 'master' and coalesce(p.price, 0) <= 0;
    get diagnostics v_locations = row_count;
    perform set_config('carehub.catalog_push', '', true);
  end if;

  return jsonb_build_object('categories', v_categories, 'prices', v_prices, 'location_prices', v_locations);
end $$;

-- "Don't suggest this again" for up to 500 items of this business.
create or replace function public.dismiss_catalogue_suggestions(p_business_id uuid, p_ids uuid[], p_kind text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  perform public.catalog_require_manager(p_business_id);
  if p_kind is null or p_kind not in ('category', 'price') then
    raise exception 'Choose category or price suggestions.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_ids), 0) > 500 then
    raise exception 'Choose up to 500 items at a time.' using errcode = '22023';
  end if;
  insert into public.catalogue_suggestion_dismissals (master_product_id, kind, business_id, dismissed_by)
  select m.id, p_kind, p_business_id, auth.uid()
    from public.master_products m where m.id = any(coalesce(p_ids, '{}')) and m.business_id = p_business_id
  on conflict (master_product_id, kind) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.catalogue_category_suggestions(uuid, integer, integer), public.catalogue_price_suggestions(uuid, integer, integer),
  public.apply_catalogue_fixes(uuid, jsonb, boolean), public.dismiss_catalogue_suggestions(uuid, uuid[], text)
  from public, anon;
grant execute on function public.catalogue_category_suggestions(uuid, integer, integer), public.catalogue_price_suggestions(uuid, integer, integer),
  public.apply_catalogue_fixes(uuid, jsonb, boolean), public.dismiss_catalogue_suggestions(uuid, uuid[], text)
  to authenticated, service_role;
