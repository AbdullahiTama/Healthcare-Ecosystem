-- A minimal replica of the LIVE tables the settlement engine touches (columns, NOT NULLs, CHECKs and
-- partial unique indexes as read from production on 2026-10-03). Foreign keys to auth.users are
-- omitted on purpose; everything the engine relies on for correctness is here.

create schema if not exists auth;
-- Supabase's auth.uid()/auth.role() read the request JWT claims; the tests set them with set_config().
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;

create table auth.users (id uuid primary key);
create or replace function public.is_platform_admin() returns boolean language sql stable as $$ select false $$;

create table public.profiles (
  id uuid primary key,
  subscription_price integer
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  balance numeric(14,4) default 0,   -- production scale: numeric with 4 decimals
  created_at timestamptz default now(),
  constraint wallets_user_id_key unique (user_id),
  constraint wallets_balance_nonnegative check (balance >= 0)
);

-- Production has RLS on wallets with these two policies; the second one references `balance`, which
-- blocks ALTER COLUMN TYPE until it is dropped and recreated (the coin_ledger migration does exactly that).
alter table public.wallets enable row level security;
create policy "Users can read their own wallet" on public.wallets for select using (user_id = (select auth.uid()));
create policy "wallets insert own empty" on public.wallets for insert to authenticated
  with check (user_id = auth.uid() and balance = 0);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  type text not null,
  amount numeric not null,
  naira_amount integer,
  reference text,
  recipient_id uuid,
  status text default 'pending',
  created_at timestamptz default now()
);
create unique index transactions_topup_reference_uniq on public.transactions (reference) where type = 'topup';
create unique index transactions_subscription_payment_reference_uniq on public.transactions (reference) where type = 'subscription_payment';
create unique index transactions_consultation_payment_reference_uniq on public.transactions (reference) where type = 'consultation_payment';

create table public.creator_subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid,
  creator_id uuid,
  price integer not null,
  auto_renew boolean default true,
  expires_at timestamptz not null,
  created_at timestamptz default now(),
  constraint creator_subscriptions_subscriber_id_creator_id_key unique (subscriber_id, creator_id)
);

create table public.professional_consultations (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null,
  patient_id uuid not null,
  type text not null default 'text',
  fee numeric not null default 0,
  notes text,
  status text not null default 'setup',
  created_at timestamptz not null default now()
);
create unique index professional_consultations_paid_uniq on public.professional_consultations (professional_id, patient_id) where status = 'paid';
create unique index professional_consultations_setup_uniq on public.professional_consultations (professional_id) where status = 'setup';

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  client_name text,
  source text,
  fee_amount integer,
  payment_status text,
  payment_reference text,
  payment_channel text,
  patient_user_id uuid,
  refunded_at timestamptz,
  status text,
  cancelled_at timestamptz,
  constraint appointments_payment_status_check check (payment_status is null or payment_status in ('unpaid','paid','refunded','pending'))
);

create table public.business_wallets (
  business_id uuid primary key,
  held_balance integer not null default 0,
  available_balance integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint business_wallets_available_nonnegative check (available_balance >= 0),
  constraint business_wallets_held_nonnegative check (held_balance >= 0)
);

create table public.business_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  appointment_id uuid,
  type text not null,
  amount integer not null,
  reference text,
  created_at timestamptz not null default now(),
  status text default 'pending',
  updated_at timestamptz default now()
);
create unique index business_wallet_tx_credit_ref_uniq on public.business_wallet_transactions (reference) where type = 'booking_credit';

create table public.platform_transactions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid,
  business_id uuid not null,
  type text not null,
  amount integer not null,
  reference text,
  created_at timestamptz not null default now()
);
create unique index platform_tx_commission_ref_uniq on public.platform_transactions (reference) where type = 'commission';

-- Verbatim from production (SECURITY DEFINER, service_role only).
create or replace function public.fn_credit_business_booking(p_business_id uuid, p_appointment_id uuid, p_rounded_kobo integer, p_platform_kobo integer, p_reference text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_business_kobo integer := p_rounded_kobo - p_platform_kobo;
begin
  insert into business_wallets (business_id, held_balance) values (p_business_id, v_business_kobo) on conflict (business_id) do update set held_balance = business_wallets.held_balance + excluded.held_balance, updated_at = now();
  insert into business_wallet_transactions (business_id, appointment_id, type, amount, reference) values (p_business_id, p_appointment_id, 'booking_credit', v_business_kobo, p_reference) on conflict (reference) where type = 'booking_credit' do nothing;
  insert into platform_transactions (appointment_id, business_id, type, amount, reference) values (p_appointment_id, p_business_id, 'commission', p_platform_kobo, p_reference) on conflict (reference) where type = 'commission' do nothing;
end;
$function$;


-- ---- tables the CareCoin wallet work (Phase 05) touches ------------------------------------------
create table public.gifts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid,
  recipient_id uuid,
  post_id uuid,
  live_session_id uuid,
  gift_type text,
  gift_emoji text,
  coins numeric,
  created_at timestamptz default now()
);

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount integer not null,
  bank_name text,
  bank_code text,
  account_number text,
  account_name text,
  status text default 'pending',
  paystack_reference text,
  paystack_transfer_code text,
  paystack_recipient_code text,
  created_at timestamptz default now()
);
-- Production already has this (read live 2026-10-03): a reference can never be used twice, even after the
-- earlier request was rejected or completed.
create unique index withdrawal_requests_paystack_reference_uniq on public.withdrawal_requests (paystack_reference) where paystack_reference is not null;

-- ---- CareHub plan payments (Phase 06). renew_business_plan is verbatim from production. -------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text,
  plan text,
  plan_expires_at timestamptz,
  referring_agent_id uuid
);

create table public.plan_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  months integer,
  naira_amount integer,
  reference text,
  status text,
  is_first_payment boolean,
  created_at timestamptz default now(),
  constraint plan_payments_reference_key unique (reference)
);

create or replace function public.renew_business_plan(p_business_id uuid, p_months integer, p_naira_amount integer, p_reference text)
returns table(already_processed boolean, payment_id uuid, new_expiry timestamp with time zone, is_first_payment boolean)
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_count bigint;
  v_base timestamptz;
  v_new_expiry timestamptz;
  v_payment_id uuid;
begin
  select count(*) into v_count from public.plan_payments where business_id = p_business_id;

  insert into public.plan_payments (business_id, months, naira_amount, reference, status, is_first_payment)
  values (p_business_id, p_months, p_naira_amount, p_reference, 'success', v_count = 0)
  on conflict (reference) do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    return query select true, null::uuid, null::timestamptz, false;
    return;
  end if;

  select plan_expires_at into v_base from public.businesses where id = p_business_id for update;
  if v_base is null or v_base < now() then
    v_base := now();
  end if;
  v_new_expiry := v_base + make_interval(months => p_months);
  update public.businesses set plan_expires_at = v_new_expiry where id = p_business_id;

  return query select false, v_payment_id, v_new_expiry, v_count = 0;
end;
$function$;
revoke all on function public.renew_business_plan(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.renew_business_plan(uuid, integer, integer, text) to service_role;

-- ---- Referral program tables (Phase 07), as read from production. ---------------------------------
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Agent',
  status text not null default 'pending_review'
);
create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  business_id uuid not null references public.businesses(id),
  payment_id uuid not null unique references public.plan_payments(id),
  type text not null,
  amount numeric not null,
  rate numeric not null,
  status text not null default 'accrued',
  created_at timestamptz not null default now()
);
create table public.commission_review_flags (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.plan_payments(id),
  reason text not null default '',
  created_at timestamptz not null default now()
);
create policy "commission_review_flags admin manage" on public.commission_review_flags for all using (public.is_platform_admin());
alter table public.commission_review_flags enable row level security;
create table public.agent_earnings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  payment_reference text not null
);

-- ---- CareHub business withdrawals (Phase 08), as read from production. -------------------------------
create table public.business_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  amount integer not null,
  bank_name text,
  account_number text,
  account_name text,
  status text not null default 'pending',
  paystack_reference text,
  paystack_transfer_code text,
  paystack_recipient_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index business_withdrawal_requests_paystack_reference_uniq on public.business_withdrawal_requests (paystack_reference) where paystack_reference is not null;

-- ---- Shop (Phase 10), as read from production. ---------------------------------------------------------
create table public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  order_ref text not null unique,
  customer_id uuid not null,
  vendor_business_id uuid not null,
  status text not null default 'pending_payment',
  payment_status text not null default 'pending',
  subtotal_kobo integer not null default 0,
  commission_kobo integer not null default 0,
  total_kobo integer not null,
  payment_reference text unique,
  paystack_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_orders_payment_status_check check (payment_status in ('pending','paid','failed','refunded')),
  constraint shop_orders_status_check check (status in ('pending_payment','paid','accepted','processing','packed','at_pickup_station','ready_for_pickup','in_transit','delivered','cancelled','refund_requested','refunded','disputed','delivery_quote_pending'))
);
create table public.shop_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  payment_reference text not null unique,
  amount_kobo integer not null,
  status text not null default 'pending',
  gateway text not null default 'paystack',
  gateway_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_payments_status_check check (status in ('pending','success','failed','refunded'))
);
create table public.shop_order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  from_status text,
  to_status text not null,
  changed_by uuid,
  note text,
  created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid,
  type text,
  message text,
  link text,
  created_at timestamptz not null default now()
);

-- ---- Shop returns / cancellation (vendor payout model), as read from production. -------------------------
create or replace function auth.email() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.email', true), '') $$;
alter table public.businesses add column if not exists email text;
create table public.shop_order_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shop_orders(id),
  customer_id uuid not null,
  vendor_business_id uuid not null,
  status text not null default 'requested',
  reason text not null,
  description text,
  refund_amount_kobo integer not null,
  refund_method text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shop_order_returns_refund_amount_kobo_check check (refund_amount_kobo >= 0),
  constraint shop_order_returns_refund_method_check check (refund_method = any (array['original_payment','wallet','manual'])),
  constraint shop_order_returns_status_check check (status = any (array['requested','approved','rejected','completed','cancelled']))
);
create table public.staff_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid, staff_id uuid, is_owner boolean, kind text, title text, body text, link text,
  created_at timestamptz not null default now()
);
create function public.current_business_ids() returns setof uuid language sql stable as
  $$ select id from public.businesses where lower(email) = lower(auth.email()) $$;
create function public.shop_restore_inventory_on_cancel(p_order_id uuid) returns void language sql as $$ select $$;

-- ---- Red-team (Phase 14): the pieces carefind_20261019_red_team_fixes touches, as read from production. ---------------------------
alter table auth.users add column if not exists email text;
alter table auth.users add column if not exists encrypted_password text;
alter table public.shop_orders add column if not exists fulfilment_kobo integer default 0, add column if not exists delivery_kobo integer default 0, add column if not exists delivery_address text, add column if not exists delivery_city text, add column if not exists delivery_state text, add column if not exists delivery_phone text, add column if not exists delivery_email text, add column if not exists delivery_instructions text, add column if not exists delivery_preference text, add column if not exists distance_km numeric, add column if not exists is_approved_city boolean, add column if not exists customer_name text, add column if not exists pickup_station_id uuid, add column if not exists segment text;
alter table public.businesses add column if not exists status text default 'active';
alter table public.businesses add column if not exists is_platform_admin boolean default false;
alter table public.businesses add column if not exists shop_allow_pay_on_delivery boolean default false;
alter table public.appointments add column if not exists amount integer;
alter table public.appointments add column if not exists completed_at timestamptz;
alter table public.appointments add column if not exists timeslot_id uuid;
alter table public.appointments add column if not exists released_at timestamptz;
alter table public.appointments add column if not exists dispute_until timestamptz;
create table public.staff (
  id uuid primary key default gen_random_uuid(), business_id uuid not null, email text, status text not null default 'active', auth_user_id uuid
);
create table public.service_availability (id uuid primary key default gen_random_uuid(), is_booked boolean, status text, appointment_id uuid);
create table public.purchases (
  id uuid primary key default gen_random_uuid(), business_id uuid not null, supplier_name text, product_name text, quantity integer, cost_price numeric, total_cost numeric,
  amount_paid numeric, balance numeric, supply_date text, due_date text, expiry text, batch text, status text, notes text, created_at timestamptz default now()
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(), business_id uuid not null, category text, description text, amount numeric, date text, staff_name text, created_at timestamptz default now()
);
create table public.shop_order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.shop_orders(id), ecommerce_product_id uuid, product_id uuid,
  product_name text, quantity integer not null default 1, unit_price_kobo integer not null default 0, line_total_kobo integer not null
);
-- test convenience: an order inserted DIRECTLY gets one item worth its subtotal (production orders get their items from create_shop_order;
-- the red-team tests build those through the function, whose generated refs start with CF-RT-)
create function public.fx_shop_order_default_item() returns trigger language plpgsql as $$
begin
  if new.order_ref not like 'CF-RT-%' then
    insert into public.shop_order_items (order_id, product_name, quantity, unit_price_kobo, line_total_kobo) values (new.id, 'fixture item', 1, new.subtotal_kobo, new.subtotal_kobo);
  end if;
  return new;
end $$;
create trigger fx_shop_order_default_item after insert on public.shop_orders for each row execute function public.fx_shop_order_default_item();
create table public.shop_order_tracking_events (id uuid primary key default gen_random_uuid(), order_id uuid, status text, location jsonb, notes text, created_by uuid);
create table public.shop_order_notifications (id uuid primary key default gen_random_uuid(), order_id uuid, notification_type text, message text, channel text, recipient_id uuid, sent_at timestamptz default now(), read_at timestamptz);
create table public.shop_promo_codes (
  id uuid primary key default gen_random_uuid(), code text, is_active boolean default true, valid_from timestamptz default now(), valid_until timestamptz, min_order_kobo integer default 0,
  applicable_segments text[], usage_limit integer, used_count integer default 0, usage_limit_per_user integer, discount_type text, discount_value integer, max_discount_kobo integer, description text
);
create table public.shop_promo_code_usage (id uuid primary key default gen_random_uuid(), promo_code_id uuid, user_id uuid, order_id uuid, discount_kobo integer);
create table public.shop_pickup_stations (id uuid primary key default gen_random_uuid(), is_active boolean default true);
create table public.products (id uuid primary key default gen_random_uuid(), name text, price numeric, stock integer, sale_type text);
create table public.ecommerce_products (id uuid primary key default gen_random_uuid(), business_id uuid, product_id uuid, status text default 'Active', is_restricted boolean default false, ecommerce_price_kobo integer);
create function public.generate_shop_order_ref() returns text language sql as $$ select 'CF-RT-' || floor(random() * 1e9)::text $$;
create function public.is_ecommerce_vendor_approved(p_business_id uuid) returns boolean language sql as $$ select true $$;
create function public.calculate_shop_fulfilment_fee(p_segment text, p_order_total_kobo integer, p_carton_count integer) returns integer language sql as $$ select 50000 $$;
create function public.calculate_shop_delivery_fee(p_distance_km numeric, p_delivery_preference text) returns integer language sql as $$ select 0 $$;
create function public.mint_confirmed_auth_user(p_email text, p_password text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); begin insert into auth.users (id) values (v); update auth.users set email = lower(p_email), encrypted_password = 'hash:' || p_password where id = v; return v; end $$;
-- production's anon/authenticated-callable server functions the migration revokes (bodies irrelevant here)
create function public.record_shop_notification(p_order_id uuid, p_notification_type text, p_message text, p_recipient_id uuid, p_channel text) returns uuid language sql as $$ select gen_random_uuid() $$;
create function public.cleanup_old_sequences() returns integer language sql as $$ select 0 $$;
create function public.book_appointment_slot(p_business_id uuid, p_service_id uuid, p_date date, p_time time, p_client_name text, p_phone text, p_fee_amount integer, p_payment_reference text, p_booking_type text, p_concern text) returns uuid language sql as $$ select gen_random_uuid() $$;
create function public.current_staff_id_for_business(p_business_id uuid) returns uuid language sql as $$ select null::uuid $$;
alter table public.shop_order_returns enable row level security;
create policy "shop_returns_customer_insert" on public.shop_order_returns for insert to authenticated with check (customer_id = auth.uid());
create policy "shop_returns_vendor_update" on public.shop_order_returns for update to authenticated using (true);
alter table public.shop_order_items enable row level security;
create policy "shop_order_items system insert" on public.shop_order_items for insert with check (true);
