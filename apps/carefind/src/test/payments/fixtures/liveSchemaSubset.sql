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
