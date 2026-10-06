-- Owner decision 2026-10-05: the shop commission is 20% flat for every segment (it replaces retail 10% / wholesale 5% /
-- distributor 2.5%). Applies to NEW orders: an order's commission is stored on the order when it is created and is never
-- recomputed, so existing orders keep the commission they were created with.
--
--   * the rate is one financial_config row (shop_commission_rate), not a constant in SQL and JS;
--   * calculate_shop_commission() reads it (still rejects an unknown segment). create_shop_order() compares the client's
--     commission with this function, so the checkout code (apps/carefind/src/modules/shop/pricing.js) MUST carry the same 20%:
--     deploy the CareFind app and apply this migration together, or every shop checkout is refused as a "Commission mismatch";
--   * vendors accept the commission in the e-commerce terms. New terms version v3 (20%) becomes the active version for each segment;
--     its text is v2's with the single commission sentence changed. v1/v2 stay as the record of what earlier vendors accepted.
--     NOT enforced here: vendors who accepted v1/v2 are charged 20% on new orders per the owner's decision; they should be asked
--     to accept v3 (the terms screen already offers the active version). Legal text: please have it reviewed.

do $$
begin
  if to_regprocedure('public._fin_cfg(text)') is null then raise exception 'apply the settlement engine first'; end if;
  if to_regprocedure('public.calculate_shop_commission(text,integer)') is null then raise exception 'public.calculate_shop_commission is missing'; end if;
  if to_regclass('public.ecommerce_terms') is null then raise exception 'public.ecommerce_terms is missing'; end if;
end $$;

insert into public.financial_config (key, value, unit, description) values
  ('shop_commission_rate', 0.20, 'ratio', 'Platform commission on a shop order subtotal, every segment (owner decision 2026-10-05; replaced 10% / 5% / 2.5%). Must equal apps/carefind/src/modules/shop/pricing.js FLAT_COMMISSION_RATE.')
on conflict (key) do nothing;

create or replace function public.calculate_shop_commission(p_segment text, p_order_total_kobo integer)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_segment is null or p_segment not in ('retail', 'wholesale', 'distributor') then
    raise exception 'Invalid segment: %', p_segment;
  end if;
  return round(p_order_total_kobo * public._fin_cfg('shop_commission_rate'))::integer;
end;
$function$;

-- Terms v3: the same text, the commission sentence at 20%.
update public.ecommerce_terms set is_active = false, updated_at = now() where is_active and version <> 'v3';

insert into public.ecommerce_terms (segment, version, title, commission_rate, commission_label, content, is_active)
select t.segment, 'v3', t.title, 0.20, '20% commission on each sale',
       regexp_replace(t.content, 'CareFind charges a [0-9.]+% commission on each applicable sale', 'CareFind charges a 20% commission on each applicable sale'),
       true
  from public.ecommerce_terms t
 where t.version = 'v2'
   and not exists (select 1 from public.ecommerce_terms n where n.segment = t.segment and n.version = 'v3');

do $$
declare bad text;
begin
  if public.calculate_shop_commission('retail', 500000) <> 100000
     or public.calculate_shop_commission('wholesale', 1000000) <> 200000
     or public.calculate_shop_commission('distributor', 2000000) <> 400000 then
    raise exception 'calculate_shop_commission is not 20%% flat';
  end if;
  select string_agg(segment, ', ') into bad from (
    select s.segment from (values ('retail'), ('wholesale'), ('distributor')) s(segment)
     where (select count(*) from public.ecommerce_terms t where t.segment = s.segment and t.is_active) <> 1
        or not exists (select 1 from public.ecommerce_terms t where t.segment = s.segment and t.is_active and t.version = 'v3' and t.commission_rate = 0.20 and t.content like '%charges a 20% commission%')) x;
  if bad is not null then raise exception 'terms v3 is not the single active version for: %', bad; end if;
  if has_function_privilege('anon', 'public.calculate_shop_commission(text,integer)', 'execute') then
    -- it was already callable by the roles that call create_shop_order; only the grant state is reported, not changed
    raise notice 'calculate_shop_commission is executable by anon (unchanged from before)';
  end if;
end $$;
