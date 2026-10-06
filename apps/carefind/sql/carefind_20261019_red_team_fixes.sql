-- Phase 14: red-team audit fixes. Each item below was found by reading the live function bodies and policies as an attacker, and is
-- described in docs/architecture/Red-Team-Audit.md with the exact attack. In severity order:
--
--  F-37 CRITICAL  provision_staff_auth reset the PASSWORD of any existing account whose email was on a staff row of the caller's business,
--                 and a business member can add a staff row with ANY email (RLS) and anyone can register a business (anon) => account
--                 takeover of any user, including platform admins and wallet holders, from the open internet.
--  F-38 CRITICAL  create_shop_order stored the client's p_subtotal_kobo without comparing it with the items (only the TOTAL was checked), and
--                 the vendor credit is subtotal - commission: a vendor and a colluding buyer could mint arbitrary vendor credit.
--  F-39 HIGH      update_shop_order_status let ANY signed-in user change the status of ANY order (the authorization condition was true when
--                 the caller passed their own id as p_changed_by).
--  F-40 HIGH      complete_appointment_and_release released the FULL appointment fee from the business's held balance a second time (the
--                 appointments_after_update trigger already releases the booking credit), and for an appointment never paid through the
--                 platform it released OTHER customers' held money: a business could drain its own hold by completing dummy appointments.
--  F-41 HIGH      get_purchase_totals / get_purchases_page: SECURITY DEFINER, executable by ANON, no ownership check: any business's purchase
--                 records (suppliers, costs, balances owed) readable by anyone who knows a business id.
--  F-42 MEDIUM    the expense functions and get_customer_purchase_summary / get_order_notification_history had no ownership check (any
--                 signed-in user could read any business's expenses and any customer's order totals).
--  F-43 MEDIUM    shop_order_items and shop_order_returns accepted writes from customers/vendors directly (a customer could insert items or
--                 an 'approved' return for ANY order, blocking that order's real return); record_shop_notification let anyone post a
--                 notification (fake "payment confirmed") to any user; validate_promo_code (anon) answered for any user id.
--  F-44 LOW       cleanup_old_sequences (deletes rows) and book_appointment_slot (caller-chosen fee) were callable by users.

do $$
begin
  if to_regprocedure('public._apply_engine_timeouts()') is null then raise exception 'apply carefind_20261017_engine_timeouts_and_hot_paths first'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- F-37 provision_staff_auth: never touch an existing account's password; only for an ACTIVE business
-- ---------------------------------------------------------------------------------------------
create or replace function public.provision_staff_auth(p_business_id uuid, p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_staff uuid;
  v_linked uuid;
  v_uid uuid;
begin
  if not (public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then
    raise exception 'You do not have permission to manage staff for this business.';
  end if;
  -- a business that has not been approved cannot mint accounts (anyone can register one)
  if not public.is_platform_admin() and not exists (select 1 from public.businesses b where b.id = p_business_id and b.status = 'active') then
    raise exception 'Your business must be approved before you can create staff logins.';
  end if;
  if p_password is null or length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

  select id, auth_user_id into v_staff, v_linked
    from public.staff
   where business_id = p_business_id
     and lower(email) = v_email
     and status = 'active'
   limit 1;
  if v_staff is null then
    raise exception 'No active staff member with that email was found in this business.';
  end if;

  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    -- a NEW account for an address nobody has registered: the owner sets the first password (the staff member can reset it by email)
    v_uid := public.mint_confirmed_auth_user(v_email, p_password);
  else
    -- An account with this address ALREADY EXISTS. Its password and confirmation belong to its owner and are NEVER changed here (the old
    -- code reset the password of whoever owned the address, so a business could take over any account by adding a staff row with its
    -- email). The person signs in with the credentials they already have.
    if v_linked is not null and v_linked is distinct from v_uid then
      raise exception 'This staff member is already linked to a different account.';
    end if;
  end if;

  update public.staff set auth_user_id = v_uid where id = v_staff;
  return v_uid;
end $$;

-- ---------------------------------------------------------------------------------------------
-- F-38 create_shop_order: the subtotal is the items' sum, not the client's number
-- ---------------------------------------------------------------------------------------------
create or replace function public.create_shop_order(
  p_customer_id uuid, p_vendor_business_id uuid, p_items jsonb, p_subtotal_kobo integer, p_commission_kobo integer, p_fulfilment_kobo integer,
  p_delivery_kobo integer, p_total_kobo integer, p_delivery_address text, p_delivery_city text, p_delivery_state text, p_delivery_phone text,
  p_delivery_email text, p_delivery_instructions text, p_delivery_preference text, p_distance_km numeric, p_is_approved_city boolean,
  p_customer_name text, p_payment_reference text, p_pickup_station_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_order_id uuid; v_order_ref text; v_item jsonb; v_ecom_id uuid;
  v_product_id uuid; v_qty int; v_ecom_price int; v_prod_price numeric;
  v_stock int; v_prod_name text; v_expected_price int; v_unit_price int;
  v_line_total int; v_existing uuid; v_ecom_status text; v_ecom_restricted boolean;
  v_ecom_business uuid; v_status text;
  v_subtotal_calc integer := 0; v_segment text; v_total_qty integer := 0;
  v_item_types text[]; v_commission_calc integer; v_fulfilment_calc integer;
  v_delivery_calc integer; v_total_calc integer;
BEGIN
  IF p_payment_reference IS NOT NULL THEN
    SELECT id INTO v_existing FROM shop_orders WHERE payment_reference = p_payment_reference;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  END IF;
  IF p_customer_id IS DISTINCT FROM auth.uid() AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  IF NOT is_ecommerce_vendor_approved(p_vendor_business_id) THEN
    RAISE EXCEPTION 'Vendor not approved' USING ERRCODE='42501';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Cart is empty'; END IF;
  IF p_pickup_station_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM shop_pickup_stations WHERE id = p_pickup_station_id AND is_active
  ) THEN RAISE EXCEPTION 'Invalid pickup station'; END IF;

  SELECT array_agg(COALESCE(LOWER(p.sale_type), 'retail')) INTO v_item_types
  FROM jsonb_array_elements(p_items) elem
  JOIN ecommerce_products ep ON ep.id = (elem->>'ecommerce_product_id')::uuid
  JOIN products p ON p.id = ep.product_id;
  IF v_item_types @> ARRAY['distributor'] THEN v_segment := 'distributor';
  ELSIF v_item_types @> ARRAY['wholesale'] THEN v_segment := 'wholesale';
  ELSE v_segment := 'retail'; END IF;
  SELECT COALESCE(SUM((elem->>'quantity')::int), 0) INTO v_total_qty
  FROM jsonb_array_elements(p_items) elem;
  IF v_segment = 'retail' AND v_total_qty >= 100 THEN v_segment := 'distributor';
  ELSIF v_segment = 'retail' AND v_total_qty >= 10 THEN v_segment := 'wholesale'; END IF;

  v_order_ref := generate_shop_order_ref();
  v_status := CASE WHEN p_is_approved_city = false THEN 'delivery_quote_pending' ELSE 'pending_payment' END;

  BEGIN
    INSERT INTO shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status,
      subtotal_kobo, commission_kobo, fulfilment_kobo, delivery_kobo, total_kobo,
      delivery_address, delivery_city, delivery_state, delivery_phone, delivery_email,
      delivery_instructions, delivery_preference, distance_km, is_approved_city,
      customer_name, payment_reference, pickup_station_id, segment)
    VALUES (v_order_ref, p_customer_id, p_vendor_business_id, v_status, 'pending',
      p_subtotal_kobo, p_commission_kobo, p_fulfilment_kobo, p_delivery_kobo, p_total_kobo,
      p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_phone, p_delivery_email,
      p_delivery_instructions, p_delivery_preference, p_distance_km, p_is_approved_city,
      p_customer_name, p_payment_reference, p_pickup_station_id, v_segment)
    RETURNING id INTO v_order_id;
  EXCEPTION WHEN unique_violation THEN
    IF p_payment_reference IS NOT NULL THEN
      SELECT id INTO v_existing FROM shop_orders WHERE payment_reference = p_payment_reference;
      IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
    END IF;
    v_order_ref := 'CF-' || lpad((floor(random()*900000)::int + 100000)::text, 6, '0');
    INSERT INTO shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status,
      subtotal_kobo, commission_kobo, fulfilment_kobo, delivery_kobo, total_kobo,
      delivery_address, delivery_city, delivery_state, delivery_phone, delivery_email,
      delivery_instructions, delivery_preference, distance_km, is_approved_city,
      customer_name, payment_reference, pickup_station_id, segment)
    VALUES (v_order_ref, p_customer_id, p_vendor_business_id, v_status, 'pending',
      p_subtotal_kobo, p_commission_kobo, p_fulfilment_kobo, p_delivery_kobo, p_total_kobo,
      p_delivery_address, p_delivery_city, p_delivery_state, p_delivery_phone, p_delivery_email,
      p_delivery_instructions, p_delivery_preference, p_distance_km, p_is_approved_city,
      p_customer_name, p_payment_reference, p_pickup_station_id, v_segment)
    RETURNING id INTO v_order_id;
  END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ecom_id := (v_item->>'ecommerce_product_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity %', v_qty; END IF;
    SELECT business_id, product_id, status, is_restricted, ecommerce_price_kobo
    INTO v_ecom_business, v_product_id, v_ecom_status, v_ecom_restricted, v_ecom_price
    FROM ecommerce_products WHERE id = v_ecom_id FOR UPDATE;
    IF v_product_id IS NULL THEN RAISE EXCEPTION 'E-commerce product not found %', v_ecom_id; END IF;
    IF v_ecom_business != p_vendor_business_id THEN RAISE EXCEPTION 'Product % does not belong to vendor', v_ecom_id; END IF;
    IF v_ecom_status != 'Active' THEN RAISE EXCEPTION 'Product % is not active', v_ecom_id; END IF;
    IF v_ecom_restricted THEN RAISE EXCEPTION 'Product % is restricted', v_ecom_id; END IF;
    SELECT name, price, stock INTO v_prod_name, v_prod_price, v_stock
    FROM products WHERE id = v_product_id FOR UPDATE;
    IF v_prod_name IS NULL THEN RAISE EXCEPTION 'Inventory product not found for ecom %', v_ecom_id; END IF;
    IF v_stock < v_qty THEN RAISE EXCEPTION 'Insufficient stock for %: have %, need %', v_prod_name, v_stock, v_qty; END IF;
    v_expected_price := COALESCE(v_ecom_price, (v_prod_price * 100)::int);
    v_unit_price := (v_item->>'unit_price_kobo')::int;
    IF v_unit_price IS NULL THEN v_unit_price := v_expected_price; END IF;
    IF v_unit_price != v_expected_price THEN
      RAISE EXCEPTION 'Price mismatch for %: expected %, got %', v_prod_name, v_expected_price, v_unit_price USING ERRCODE='P0001';
    END IF;
    v_line_total := v_unit_price * v_qty;
    v_subtotal_calc := v_subtotal_calc + v_line_total;
    UPDATE products SET stock = stock - v_qty WHERE id = v_product_id;
    INSERT INTO shop_order_items (order_id, ecommerce_product_id, product_id, product_name, quantity, unit_price_kobo, line_total_kobo)
    VALUES (v_order_id, v_ecom_id, v_product_id, v_prod_name, v_qty, v_unit_price, v_line_total);
  END LOOP;

  v_commission_calc := public.calculate_shop_commission(v_segment, v_subtotal_calc);
  v_fulfilment_calc := public.calculate_shop_fulfilment_fee(v_segment, v_subtotal_calc, v_total_qty);
  v_delivery_calc := public.calculate_shop_delivery_fee(p_distance_km, p_delivery_preference);
  v_total_calc := v_subtotal_calc + v_fulfilment_calc + v_delivery_calc;

  -- The subtotal is what the vendor is credited from (subtotal - commission): it must be the items' own sum, never the caller's number.
  IF p_subtotal_kobo IS DISTINCT FROM v_subtotal_calc THEN
    RAISE EXCEPTION 'Subtotal mismatch: expected %, got %', v_subtotal_calc, p_subtotal_kobo USING ERRCODE='P0002';
  END IF;
  IF p_commission_kobo != v_commission_calc THEN
    RAISE EXCEPTION 'Commission mismatch: expected %, got %', v_commission_calc, p_commission_kobo USING ERRCODE='P0002';
  END IF;
  IF p_fulfilment_kobo != v_fulfilment_calc THEN
    RAISE EXCEPTION 'Fulfilment fee mismatch: expected %, got %', v_fulfilment_calc, p_fulfilment_kobo USING ERRCODE='P0002';
  END IF;
  IF abs(p_delivery_kobo - v_delivery_calc) > (v_delivery_calc * 0.05)::int + 1 THEN
    RAISE EXCEPTION 'Delivery fee mismatch: expected ~%, got %', v_delivery_calc, p_delivery_kobo USING ERRCODE='P0002';
  END IF;
  IF abs(p_total_kobo - v_total_calc) > 2 THEN
    RAISE EXCEPTION 'Order total mismatch: expected %, got %', v_total_calc, p_total_kobo USING ERRCODE='P0002';
  END IF;

  INSERT INTO shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  VALUES (v_order_id, null, v_status, p_customer_id, 'Order created');
  INSERT INTO shop_payments (order_id, payment_reference, amount_kobo, status, gateway)
  VALUES (v_order_id, COALESCE(p_payment_reference, 'pay_' || v_order_ref), p_total_kobo, 'pending', 'paystack');

  IF p_delivery_preference = 'pickup' AND EXISTS (
    SELECT 1 FROM businesses WHERE id = p_vendor_business_id AND shop_allow_pay_on_delivery = true
  ) THEN
    INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
    SELECT p_vendor_business_id, s.id, false, 'shop_order', 'New Shop Order '||v_order_ref,
      'Customer placed an order — pay at pickup',
      '/dashboard/ecommerce/orders/'||v_order_id::text
    FROM staff s WHERE s.business_id=p_vendor_business_id AND s.status='active';
    INSERT INTO staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
    VALUES (p_vendor_business_id, null, true, 'shop_order', 'New Shop Order '||v_order_ref,
      'Customer placed order '||v_order_ref||' — pay at pickup',
      '/dashboard/ecommerce/orders/'||v_order_id::text);
    INSERT INTO notifications (recipient_id, type, message, link)
    VALUES (p_customer_id, 'shop_order', 'Order '||v_order_ref||' placed — pay at pickup', '/orders/'||v_order_id::text);
  ELSE
    INSERT INTO notifications (recipient_id, type, message, link)
    VALUES (p_customer_id, 'shop_order_pending', 'Order '||v_order_ref||' created — complete payment to confirm', '/orders/'||v_order_id::text);
  END IF;
  RETURN v_order_id;
END;
$$;

-- defence in depth: the settlement engine refuses an order whose subtotal is not backed by its items
create or replace function public._settle_shop_order(i public.payment_intents)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.shop_orders%rowtype;
  v_credit integer;
  v_items_total bigint;
  v_items_n integer;
begin
  if i.entity_type is distinct from 'shop_order' or i.entity_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_shop_intent');
  end if;

  select * into o from public.shop_orders where id = i.entity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_missing');
  end if;
  if o.customer_id is distinct from i.customer_id then
    return jsonb_build_object('ok', false, 'reason', 'customer_mismatch');
  end if;
  if o.vendor_business_id is distinct from i.business_id then
    return jsonb_build_object('ok', false, 'reason', 'business_mismatch');
  end if;
  if o.payment_status = 'paid' or o.status = 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'already_paid');
  end if;
  if o.status not in ('pending_payment', 'delivery_quote_pending') then
    return jsonb_build_object('ok', false, 'reason', 'order_not_payable');
  end if;
  if o.total_kobo is distinct from i.expected_amount then
    return jsonb_build_object('ok', false, 'reason', 'amount_changed');
  end if;
  select coalesce(sum(line_total_kobo), 0), count(*) into v_items_total, v_items_n from public.shop_order_items where order_id = o.id;
  if v_items_n = 0 or v_items_total <> o.subtotal_kobo then
    return jsonb_build_object('ok', false, 'reason', 'subtotal_mismatch');
  end if;
  v_credit := o.subtotal_kobo - o.commission_kobo;
  if v_credit <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_vendor_share');
  end if;

  update public.shop_orders
     set payment_status = 'paid', status = 'paid', paystack_reference = i.reference, updated_at = now()
   where id = o.id;

  insert into public.shop_payments (order_id, payment_reference, amount_kobo, status, gateway, gateway_response)
  values (o.id, i.reference, i.expected_amount, 'success', i.provider, jsonb_build_object('intent_id', i.id, 'provider_transaction_id', i.provider_transaction_id))
  on conflict (payment_reference) do update
    set status = 'success', gateway_response = excluded.gateway_response, updated_at = now();
  update public.shop_payments set status = 'failed', updated_at = now()
   where order_id = o.id and status = 'pending' and payment_reference <> i.reference;

  insert into public.shop_vendor_credits (order_id, business_id, amount_kobo, commission_kobo)
  values (o.id, o.vendor_business_id, v_credit, o.commission_kobo);
  insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
  values (o.vendor_business_id, 'shop_credit', v_credit, 'shopcr_' || o.id, 'confirmed');

  insert into public.shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  values (o.id, o.status, 'paid', null, 'Payment verified ' || i.reference);

  insert into public.notifications (recipient_id, type, message, link)
  values (o.customer_id, 'shop_payment', 'Payment confirmed for order ' || o.order_ref, '/orders/' || o.id::text);

  update public.business_wallets set held_balance = held_balance + v_credit, updated_at = now() where business_id = o.vendor_business_id;
  if not found then
    insert into public.business_wallets (business_id, held_balance, available_balance)
    values (o.vendor_business_id, v_credit, 0)
    on conflict (business_id) do update set held_balance = public.business_wallets.held_balance + v_credit, updated_at = now();
  end if;

  return jsonb_build_object('ok', true, 'order_id', o.id, 'order_ref', o.order_ref, 'vendor_business_id', o.vendor_business_id, 'total_kobo', o.total_kobo, 'vendor_credit_kobo', v_credit);
end;
$$;
revoke all on function public._settle_shop_order(public.payment_intents) from public, anon, authenticated, service_role;

-- reconciliation: a credit must be backed by the order's items
create or replace function public.reconcile_shop_vendor_credits()
returns table (kind text, order_id uuid, detail text)
language sql
security definer
set search_path = public, pg_temp
as $$
  with cut as (select to_timestamp(public._fin_cfg('shop_vendor_cutover_epoch')) as t)
  select 'legacy_paid_order_without_credit', o.id, 'order ' || o.order_ref || ' paid ' || o.updated_at::date || ', vendor share ' || (o.subtotal_kobo - o.commission_kobo) || ' kobo'
    from public.shop_orders o, cut
   where o.payment_status = 'paid' and o.status not in ('cancelled', 'refunded')
     and not exists (select 1 from public.shop_vendor_credits c where c.order_id = o.id)
     and o.updated_at < cut.t
  union all
  select 'paid_order_without_credit', o.id, 'order ' || o.order_ref || ' paid after vendor credits went live but has no credit'
    from public.shop_orders o, cut
   where o.payment_status = 'paid' and o.status not in ('cancelled', 'refunded')
     and not exists (select 1 from public.shop_vendor_credits c where c.order_id = o.id)
     and o.updated_at >= cut.t
  union all
  select 'credit_amount_mismatch', c.order_id, 'credit ' || c.amount_kobo || ' <> subtotal - commission ' || (o.subtotal_kobo - o.commission_kobo)
    from public.shop_vendor_credits c join public.shop_orders o on o.id = c.order_id
   where c.amount_kobo <> o.subtotal_kobo - o.commission_kobo
  union all
  select 'credit_not_backed_by_items', c.order_id, 'credit ' || c.amount_kobo || ' + commission ' || c.commission_kobo || ' exceeds the items total ' || coalesce(i.s, 0)
    from public.shop_vendor_credits c
    left join (select order_id, sum(line_total_kobo) s from public.shop_order_items group by order_id) i on i.order_id = c.order_id
   where c.amount_kobo + c.commission_kobo > coalesce(i.s, 0)
  union all
  select 'credit_without_ledger_row', c.order_id, 'no shop_credit ledger row'
    from public.shop_vendor_credits c
   where not exists (select 1 from public.business_wallet_transactions t where t.type = 'shop_credit' and t.reference = 'shopcr_' || c.order_id)
  union all
  select 'released_without_ledger_row', c.order_id, 'released credit has no shop_release ledger row'
    from public.shop_vendor_credits c
   where c.status = 'released' and c.released_kobo > 0
     and not exists (select 1 from public.business_wallet_transactions t where t.type = 'shop_release' and t.reference = 'shoprl_' || c.order_id)
  union all
  select 'release_shortfall', c.order_id, 'released ' || c.released_kobo || ' of ' || (c.amount_kobo - c.reversed_kobo) || ' kobo: the held balance was already lower'
    from public.shop_vendor_credits c where c.release_shortfall_kobo > 0
  union all
  select 'refund_shortfall', f.entity_id, 'refund ' || f.reference || ' recovered ' || (f.business_recovered_held_kobo + f.business_recovered_available_kobo) || ' kobo, vendor owes ' || f.business_shortfall_kobo
    from public.refunds f where f.entity_type = 'shop_order' and f.business_shortfall_kobo > 0 and f.status <> 'failed'
  union all
  select 'approved_return_without_refund', r.order_id, 'return ' || r.id || ' approved but no live refund'
    from public.shop_order_returns r
   where r.status = 'approved'
     and not exists (select 1 from public.refunds f where f.entity_type = 'shop_order' and f.entity_id = r.order_id and f.status <> 'failed')
  union all
  select 'held_below_open_credits', c.business_id, 'wallet held ' || coalesce(w.held_balance, 0) || ' < unreleased shop credits ' || sum(c.amount_kobo - c.reversed_kobo)
    from public.shop_vendor_credits c left join public.business_wallets w on w.business_id = c.business_id
   where c.status = 'held'
   group by c.business_id, w.held_balance
  having coalesce(w.held_balance, 0) < sum(c.amount_kobo - c.reversed_kobo);
$$;
revoke all on function public.reconcile_shop_vendor_credits() from public, anon, authenticated, service_role;
grant execute on function public.reconcile_shop_vendor_credits() to service_role;

-- ---------------------------------------------------------------------------------------------
-- F-39 update_shop_order_status: only the vendor (forward through fulfilment, on a PAID order) or an admin / the server
-- ---------------------------------------------------------------------------------------------
create or replace function public.update_shop_order_status(p_order_id uuid, p_to_status text, p_changed_by uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text; v_customer uuid; v_vendor uuid; v_ref text; v_pay text;
  v_admin boolean := (auth.role() = 'service_role' or public.is_platform_admin());
  v_actor uuid;
  v_rank_from integer; v_rank_to integer;
begin
  select status, customer_id, vendor_business_id, order_ref, payment_status into v_from, v_customer, v_vendor, v_ref, v_pay
    from shop_orders where id = p_order_id for update;
  if v_from is null then raise exception 'Order not found'; end if;
  if p_to_status = v_from then return; end if;

  -- who is acting: the signed-in caller, never an id the caller names (only the server may name one)
  v_actor := case when v_admin then coalesce(p_changed_by, auth.uid()) else auth.uid() end;

  if not v_admin then
    if v_vendor not in (select public.current_business_ids()) then
      raise exception 'Not authorized to change order status' using errcode = '42501';
    end if;
    -- a vendor quotes delivery for an order awaiting a quote; otherwise it moves a PAID order forward through fulfilment.
    -- Payment, refunds, cancellation and disputes are never the vendor's to set here.
    if v_from = 'delivery_quote_pending' and p_to_status = 'pending_payment' then
      null;
    else
      v_rank_from := case v_from when 'paid' then 1 when 'accepted' then 2 when 'processing' then 3 when 'packed' then 4
                       when 'at_pickup_station' then 5 when 'ready_for_pickup' then 5 when 'in_transit' then 6 end;
      v_rank_to := case p_to_status when 'accepted' then 2 when 'processing' then 3 when 'packed' then 4
                     when 'at_pickup_station' then 5 when 'ready_for_pickup' then 5 when 'in_transit' then 6 when 'delivered' then 7 end;
      if v_pay is distinct from 'paid' or v_rank_from is null or v_rank_to is null or v_rank_to <= v_rank_from then
        raise exception 'This status change is not allowed (% to %)', v_from, p_to_status using errcode = '42501';
      end if;
    end if;
  end if;

  update shop_orders set status = p_to_status, updated_at = now() where id = p_order_id;
  insert into shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_from, p_to_status, v_actor, p_note);
  insert into notifications (recipient_id, type, message, link)
  values (v_customer, 'shop_order_status', 'Order ' || v_ref || ' is now ' || p_to_status, '/orders/' || p_order_id::text);
  insert into staff_notifications (business_id, staff_id, is_owner, kind, title, body, link)
  values (v_vendor, null, true, 'shop_order_status', 'Order ' || v_ref || ' → ' || p_to_status, 'Status changed from ' || coalesce(v_from, '') || ' to ' || p_to_status, '/dashboard/ecommerce/orders/' || p_order_id::text);
end;
$$;

-- the vendor's tracking event follows the same rules (it also set the order status)
create or replace function public.add_tracking_event(p_order_id uuid, p_status text, p_notes text, p_location jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor uuid; v_from text; v_pay text;
begin
  select vendor_business_id, status, payment_status into v_vendor, v_from, v_pay from shop_orders where id = p_order_id;
  if v_vendor is null then raise exception 'Order not found'; end if;
  if v_vendor not in (select current_business_ids()) then raise exception 'Not authorized'; end if;
  if p_status not in ('accepted', 'processing', 'packed', 'at_pickup_station', 'ready_for_pickup', 'in_transit', 'delivered') or v_pay is distinct from 'paid' then
    raise exception 'This status change is not allowed' using errcode = '42501';
  end if;
  insert into shop_order_tracking_events (order_id, status, location, notes, created_by) values (p_order_id, p_status, p_location, p_notes, auth.uid());
  update shop_orders set status = p_status, updated_at = now() where id = p_order_id;
  insert into notifications (user_id, type, title, message, data)
  select customer_id, 'order_status_update', 'Order Status Updated',
         'Your order ' || (select order_ref from shop_orders where id = p_order_id) || ' is now: ' || p_status,
         jsonb_build_object('order_id', p_order_id, 'status', p_status)
    from shop_orders where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- F-40 complete_appointment_and_release: no money logic of its own (the appointments_after_update trigger releases the booking credit, once)
-- ---------------------------------------------------------------------------------------------
create or replace function public.complete_appointment_and_release(p_appointment_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid; v_status text; v_fee integer; v_timeslot_id uuid;
begin
  select business_id, status, coalesce(amount, fee_amount), timeslot_id into v_business_id, v_status, v_fee, v_timeslot_id
    from appointments where id = p_appointment_id for update;
  if v_business_id is null then return 'not_found'; end if;
  if not (v_business_id in (select current_business_ids()) or is_platform_admin()) then return 'forbidden'; end if;
  if v_status not in ('confirmed') then return 'not_confirmed'; end if;
  if v_fee is null or v_fee <= 0 then return 'no_fee'; end if;

  -- Completing the appointment is the only step: the AFTER UPDATE trigger releases exactly the business share that THIS appointment's
  -- booking credit put on hold (card / CareCoin payments only), once. An appointment paid another way holds nothing, so nothing is
  -- released. (The old body also released the FULL fee again from the held balance: a second release, and for an appointment that was
  -- never paid through the platform it released other customers' held money.)
  update appointments set status = 'completed', completed_at = now() where id = p_appointment_id;

  if v_timeslot_id is not null then
    update service_availability set is_booked = false, status = 'available', appointment_id = null where id = v_timeslot_id;
  end if;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- F-41 / F-42 ownership checks on the business-data and customer-data readers
-- ---------------------------------------------------------------------------------------------
create or replace function public.get_purchase_totals(p_business_id uuid)
returns table (purchase_count bigint, total_paid numeric, total_owed numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select count(*)::bigint, coalesce(sum(p.amount_paid), 0)::numeric, coalesce(sum(p.balance), 0)::numeric
    from purchases p where p.business_id = p_business_id;
end;
$$;

create or replace function public.get_purchases_page(p_business_id uuid, p_search text, p_month text, p_year text, p_offset integer, p_limit integer)
returns table (id uuid, supplier_name text, product_name text, quantity integer, cost_price numeric, total_cost numeric, amount_paid numeric, balance numeric,
               supply_date text, due_date text, expiry text, batch text, status text, notes text, created_at timestamp with time zone)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select p.id, p.supplier_name, p.product_name, p.quantity, p.cost_price, p.total_cost, p.amount_paid, p.balance, p.supply_date, p.due_date, p.expiry, p.batch, p.status, p.notes, p.created_at
    from purchases p
   where p.business_id = p_business_id
     and (p_search is null or p_search = '' or p.supplier_name ilike '%' || p_search || '%' or p.product_name ilike '%' || p_search || '%')
     and (p_month is null or p_month = '' or p.created_at >= (p_month || '-01')::date)
     and (p_month is null or p_month = '' or p.created_at < ((p_month || '-01')::date + interval '1 month'))
     and (p_year is null or p_year = '' or p.created_at >= (p_year || '-01-01')::date)
     and (p_year is null or p_year = '' or p.created_at < ((p_year || '-01-01')::date + interval '1 year'))
   order by p.created_at desc
   offset p_offset limit p_limit;
end;
$$;
revoke all on function public.get_purchase_totals(uuid), public.get_purchases_page(uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.get_purchase_totals(uuid), public.get_purchases_page(uuid, text, text, text, integer, integer) to authenticated, service_role;

create or replace function public.get_expense_totals(p_business_id uuid, p_month text)
returns table (total_amount numeric, transaction_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select coalesce(sum(e.amount), 0)::numeric, count(*)::bigint
    from expenses e
   where e.business_id = p_business_id
     and (p_month is null or e.created_at >= (p_month || '-01')::date)
     and (p_month is null or e.created_at < ((p_month || '-01')::date + interval '1 month'));
end;
$$;

create or replace function public.get_expense_summary(p_business_id uuid, p_month text)
returns table (total_amount numeric, transaction_count bigint, category text, category_amount numeric, category_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select coalesce(sum(e.amount) over (), 0), count(*) over (), e.category, e.amount, 1::bigint
    from expenses e
   where e.business_id = p_business_id
     and (p_month is null or e.created_at >= (p_month || '-01')::date)
     and (p_month is null or e.created_at < ((p_month || '-01')::date + interval '1 month'))
   order by e.amount desc;
end;
$$;

create or replace function public.get_expenses_page(p_business_id uuid, p_month text, p_offset integer, p_limit integer)
returns table (id uuid, category text, description text, amount numeric, date text, staff_name text, created_at timestamp with time zone)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select e.id, e.category, e.description, e.amount, e.date, e.staff_name, e.created_at
    from expenses e
   where e.business_id = p_business_id
     and (p_month is null or e.created_at >= (p_month || '-01')::date)
     and (p_month is null or e.created_at < ((p_month || '-01')::date + interval '1 month'))
   order by e.created_at desc
   offset p_offset limit p_limit;
end;
$$;

create or replace function public.get_customer_purchase_summary(p_customer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_result jsonb;
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin() or p_customer_id = auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total_orders', count(*) filter (where status not in ('cancelled')),
    'completed_orders', count(*) filter (where status = 'delivered'),
    'total_spent_kobo', coalesce(sum(total_kobo) filter (where status not in ('cancelled')), 0),
    'total_refunded_kobo', coalesce(sum(total_kobo) filter (where status = 'refunded'), 0),
    'first_order_at', min(created_at), 'last_order_at', max(created_at),
    'average_order_value_kobo', coalesce(avg(total_kobo) filter (where status not in ('cancelled')), 0),
    'unique_vendors', count(distinct vendor_business_id) filter (where status not in ('cancelled')),
    'delivery_preference_breakdown', jsonb_build_object(
      'pickup', count(*) filter (where delivery_preference = 'pickup' and status not in ('cancelled')),
      'home', count(*) filter (where delivery_preference = 'home' and status not in ('cancelled')))
  ) into v_result from shop_orders where customer_id = p_customer_id;
  return v_result;
end;
$$;

create or replace function public.get_order_notification_history(p_order_id uuid)
returns table (id uuid, notification_type text, message text, channel text, sent_at timestamp with time zone, read_at timestamp with time zone)
language plpgsql security definer set search_path = public
as $$
begin
  if not (auth.role() = 'service_role' or public.is_platform_admin()
          or exists (select 1 from shop_orders o where o.id = p_order_id and (o.customer_id = auth.uid() or o.vendor_business_id in (select public.current_business_ids())))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select son.id, son.notification_type, son.message, son.channel, son.sent_at, son.read_at
    from shop_order_notifications son where son.order_id = p_order_id order by son.sent_at asc;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- F-43 / F-44 the rest
-- ---------------------------------------------------------------------------------------------
drop policy if exists "shop_order_items system insert" on public.shop_order_items;       -- items are written by create_shop_order only
drop policy if exists "shop_returns_customer_insert" on public.shop_order_returns;       -- returns are created by request_shop_return only
drop policy if exists "shop_returns_vendor_update" on public.shop_order_returns;         -- and decided by process_shop_return only

revoke execute on function public.record_shop_notification(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.cleanup_old_sequences() from public, anon, authenticated;
revoke execute on function public.book_appointment_slot(uuid, uuid, date, time without time zone, text, text, integer, text, text, text) from public, anon, authenticated;

-- a promo check answers for the CALLER: a signed-in user cannot probe another user's usage, and anonymous callers cannot enumerate codes
create or replace function public.validate_promo_code(p_code text, p_user_id uuid, p_order_kobo integer, p_segment text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_promo record; v_user_usage_count integer; v_discount_kobo integer;
  v_user uuid := case when auth.role() = 'service_role' then p_user_id else auth.uid() end;
begin
  select * into v_promo from shop_promo_codes
   where code = upper(p_code) and is_active = true and valid_from <= now() and (valid_until is null or valid_until > now());
  if v_promo is null then return jsonb_build_object('valid', false, 'error', 'Invalid or expired promo code'); end if;
  if p_order_kobo < v_promo.min_order_kobo then
    return jsonb_build_object('valid', false, 'error', format('Minimum order value of ₦%s required', (v_promo.min_order_kobo / 100)::text));
  end if;
  if v_promo.applicable_segments is not null and p_segment is not null then
    if not (p_segment = any (v_promo.applicable_segments)) then
      return jsonb_build_object('valid', false, 'error', 'This promo code is not valid for this segment');
    end if;
  end if;
  if v_promo.usage_limit is not null and v_promo.used_count >= v_promo.usage_limit then
    return jsonb_build_object('valid', false, 'error', 'This promo code has reached its usage limit');
  end if;
  select count(*) into v_user_usage_count from shop_promo_code_usage where promo_code_id = v_promo.id and user_id = v_user;
  if v_promo.usage_limit_per_user is not null and v_user_usage_count >= v_promo.usage_limit_per_user then
    return jsonb_build_object('valid', false, 'error', 'You have already used this promo code');
  end if;
  if v_promo.discount_type = 'percentage' then
    v_discount_kobo := (p_order_kobo * v_promo.discount_value) / 100;
    if v_promo.max_discount_kobo is not null and v_discount_kobo > v_promo.max_discount_kobo then v_discount_kobo := v_promo.max_discount_kobo; end if;
  else
    v_discount_kobo := v_promo.discount_value;
  end if;
  if v_discount_kobo > p_order_kobo then v_discount_kobo := p_order_kobo; end if;
  return jsonb_build_object('valid', true, 'promo_code_id', v_promo.id, 'discount_type', v_promo.discount_type, 'discount_value', v_promo.discount_value,
                            'discount_kobo', v_discount_kobo, 'description', v_promo.description);
end;
$$;
revoke all on function public.validate_promo_code(text, uuid, integer, text) from public, anon;
grant execute on function public.validate_promo_code(text, uuid, integer, text) to authenticated, service_role;

-- the engine entry points keep their timeouts (CREATE OR REPLACE replaced _settle_shop_order's settings)
select public._apply_engine_timeouts();

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('get_purchase_totals', 'get_purchases_page', 'record_shop_notification', 'cleanup_old_sequences', 'book_appointment_slot')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_n > 0 then raise exception 'a business-data function is still executable by anon'; end if;
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('record_shop_notification', 'cleanup_old_sequences', 'book_appointment_slot') and has_function_privilege('authenticated', p.oid, 'execute');
  if v_n > 0 then raise exception 'a server-only function is still executable by signed-in users'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and policyname in ('shop_order_items system insert', 'shop_returns_customer_insert', 'shop_returns_vendor_update')) then
    raise exception 'a client write policy on shop items / returns survived';
  end if;
  if not (coalesce((select proconfig from pg_proc where proname = '_settle_shop_order' and pronamespace = 'public'::regnamespace), '{}') @> array['lock_timeout=10s']) then
    raise exception '_settle_shop_order lost its timeouts';
  end if;
end $$;
