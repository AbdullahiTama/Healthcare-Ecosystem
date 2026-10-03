-- Financial program, Phase 02: the canonical payment_intents model.
--
-- Nothing is migrated onto these tables yet (Phases 04/06 do that). This only creates the
-- foundation, server-only and self-defending:
--   * payment_intents          one row per expected gateway payment; identity is immutable and the
--                              status column can only move along the state machine (trigger).
--   * payment_provider_events  every webhook/redirect observation, persisted before processing;
--                              unique (provider, event_id) is the replay/duplicate guard.
--   * financial_config         the commercial constants that are currently hard-coded in JS and SQL.
--                              Values below MIRROR the existing rules exactly; none is changed here.
--
-- Access: no client role can read or write any of these tables. Supabase's default privileges
-- re-grant ALL to anon/authenticated at table creation, so they are revoked explicitly and the
-- result is asserted at the bottom (a statement completing is not evidence it did anything).
--
-- customer_id / business_id deliberately have no FK: a money record must outlive the account or
-- business it refers to (the wallets FK is ON DELETE CASCADE; this table must not be).

-- ---------------------------------------------------------------------------------------------
-- payment_intents
-- ---------------------------------------------------------------------------------------------
create table public.payment_intents (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null,
  provider              text not null default 'paystack',
  provider_transaction_id text,
  application           text not null,
  purpose               text not null,
  customer_id           uuid,
  business_id           uuid,
  entity_type           text,
  entity_id             uuid,
  expected_amount       bigint not null,   -- minor units (kobo); integers only, never decimals
  currency              text not null default 'NGN',
  status                text not null default 'created',
  metadata              jsonb not null default '{}'::jsonb,
  expires_at            timestamptz not null default (now() + interval '24 hours'),
  verified_at           timestamptz,
  settled_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint payment_intents_reference_key unique (reference),
  constraint payment_intents_reference_format check (reference ~ '^[A-Za-z0-9_-]{8,100}$'),
  constraint payment_intents_provider_format check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint payment_intents_application_check check (application in ('carefind', 'carehub')),
  constraint payment_intents_purpose_check check (purpose in (
    'wallet_topup', 'creator_subscription', 'consultation', 'booking', 'appointment', 'plan_renewal', 'shop_order'
  )),
  constraint payment_intents_amount_positive check (expected_amount > 0),
  constraint payment_intents_currency_check check (currency = 'NGN'),
  constraint payment_intents_status_check check (status in (
    'created', 'pending', 'verified', 'settled', 'failed', 'expired', 'needs_refund', 'refunded'
  )),
  constraint payment_intents_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint payment_intents_entity_pair check ((entity_type is null) = (entity_id is null)),
  constraint payment_intents_verified_has_timestamp check (
    status not in ('verified', 'settled', 'needs_refund', 'refunded') or verified_at is not null
  ),
  constraint payment_intents_settled_has_timestamp check (status <> 'settled' or settled_at is not null)
);

comment on table public.payment_intents is
  'One expected gateway payment. Server-only. Identity columns are immutable; status follows the Phase 01 state machine (trigger).';
comment on column public.payment_intents.expected_amount is 'Minor units (kobo). The ONLY amount settlement will accept.';

-- Provider transaction ids are unique per provider once known.
create unique index payment_intents_provider_txn_key
  on public.payment_intents (provider, provider_transaction_id)
  where provider_transaction_id is not null;
create index payment_intents_customer_idx on public.payment_intents (customer_id, created_at desc)
  where customer_id is not null;
create index payment_intents_business_idx on public.payment_intents (business_id, created_at desc)
  where business_id is not null;
create index payment_intents_entity_idx on public.payment_intents (entity_type, entity_id)
  where entity_id is not null;
-- Expiry sweep.
create index payment_intents_open_expiry_idx on public.payment_intents (expires_at)
  where status in ('created', 'pending');
-- Reconciliation: paid-but-unsettled and refund backlog.
create index payment_intents_unsettled_idx on public.payment_intents (verified_at)
  where status in ('verified', 'needs_refund');

create or replace function public.payment_intents_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  allowed text[] := array[
    'created>pending', 'created>verified', 'created>failed', 'created>expired',
    'pending>verified', 'pending>failed', 'pending>expired',
    -- a late provider success on a closed attempt is accepted, never dropped
    'expired>verified', 'failed>verified',
    'verified>settled', 'verified>needs_refund',
    'needs_refund>refunded', 'settled>refunded'
  ];
begin
  if tg_op = 'DELETE' then
    raise exception 'payment_intents rows are never deleted' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'created' or new.verified_at is not null or new.settled_at is not null
       or new.provider_transaction_id is not null then
      raise exception 'a payment intent must be inserted as a fresh, unverified "created" row' using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id
     or new.reference is distinct from old.reference
     or new.provider is distinct from old.provider
     or new.application is distinct from old.application
     or new.purpose is distinct from old.purpose
     or new.customer_id is distinct from old.customer_id
     or new.business_id is distinct from old.business_id
     or new.entity_type is distinct from old.entity_type
     or new.entity_id is distinct from old.entity_id
     or new.expected_amount is distinct from old.expected_amount
     or new.currency is distinct from old.currency
     or new.created_at is distinct from old.created_at then
    raise exception 'payment_intents identity columns are immutable' using errcode = '23514';
  end if;

  if old.provider_transaction_id is not null
     and new.provider_transaction_id is distinct from old.provider_transaction_id then
    raise exception 'payment_intents.provider_transaction_id cannot be changed once set' using errcode = '23514';
  end if;
  if old.verified_at is not null and new.verified_at is distinct from old.verified_at then
    raise exception 'payment_intents.verified_at cannot be changed once set' using errcode = '23514';
  end if;
  if old.settled_at is not null and new.settled_at is distinct from old.settled_at then
    raise exception 'payment_intents.settled_at cannot be changed once set' using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
    if (old.status || '>' || new.status) <> all (allowed) then
      raise exception 'illegal payment intent transition % -> %', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'verified' then new.verified_at := coalesce(new.verified_at, now()); end if;
    if new.status = 'settled'  then new.settled_at  := coalesce(new.settled_at, now());  end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger payment_intents_guard
  before insert or update or delete on public.payment_intents
  for each row execute function public.payment_intents_guard();

create or replace function public.financial_no_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'truncating % is not allowed', tg_table_name using errcode = '42501';
end;
$$;

create trigger payment_intents_no_truncate
  before truncate on public.payment_intents
  for each statement execute function public.financial_no_truncate();

-- ---------------------------------------------------------------------------------------------
-- payment_provider_events
-- ---------------------------------------------------------------------------------------------
create table public.payment_provider_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,
  event_id      text not null,     -- provider-stable id; the adapter derives one when the provider has none
  event_type    text not null,
  reference     text,
  payload       jsonb not null,
  signature_ok  boolean not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  outcome       text,
  attempts      integer not null default 0,
  last_error    text,

  constraint payment_provider_events_dedupe unique (provider, event_id),
  constraint payment_provider_events_provider_format check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  constraint payment_provider_events_outcome_check check (
    outcome is null or outcome in ('processed', 'ignored', 'failed', 'duplicate')
  ),
  constraint payment_provider_events_attempts_nonneg check (attempts >= 0),
  constraint payment_provider_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint payment_provider_events_processed_has_outcome check (processed_at is null or outcome is not null)
);

comment on table public.payment_provider_events is
  'Append-only log of provider webhooks/redirects, stored before processing. Server-only. unique(provider,event_id) is the replay guard.';

create index payment_provider_events_reference_idx on public.payment_provider_events (reference)
  where reference is not null;
create index payment_provider_events_backlog_idx on public.payment_provider_events (received_at)
  where processed_at is null;

create or replace function public.payment_provider_events_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payment_provider_events rows are never deleted' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.provider is distinct from old.provider
     or new.event_id is distinct from old.event_id
     or new.event_type is distinct from old.event_type
     or new.reference is distinct from old.reference
     or new.payload is distinct from old.payload
     or new.signature_ok is distinct from old.signature_ok
     or new.received_at is distinct from old.received_at then
    raise exception 'payment_provider_events are immutable; only processing fields may change' using errcode = '23514';
  end if;
  if old.processed_at is not null and new.processed_at is distinct from old.processed_at then
    raise exception 'payment_provider_events.processed_at cannot be changed once set' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger payment_provider_events_guard
  before update or delete on public.payment_provider_events
  for each row execute function public.payment_provider_events_guard();
create trigger payment_provider_events_no_truncate
  before truncate on public.payment_provider_events
  for each statement execute function public.financial_no_truncate();

-- ---------------------------------------------------------------------------------------------
-- financial_config  (mirrors today's hard-coded rules; changing a value is a commercial decision)
-- ---------------------------------------------------------------------------------------------
create table public.financial_config (
  key         text primary key,
  value       numeric not null,
  unit        text not null,
  description text not null,
  updated_at  timestamptz not null default now(),
  constraint financial_config_key_format check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  constraint financial_config_nonnegative check (value >= 0),
  constraint financial_config_rate_range check (key not like '%\_rate' escape '\' or value <= 1)
);

comment on table public.financial_config is
  'Single source of truth for commercial constants. Server-only. Seed values equal the rules currently hard-coded in JS/SQL.';

insert into public.financial_config (key, value, unit, description) values
  ('coin_value_kobo',               20000, 'kobo',  '1 CareCoin = 200 naira (JS COIN_VALUE_NAIRA=200; SQL 20000)'),
  ('booking_platform_rate',         0.20,  'ratio', 'Platform share of a booking (settle_card_booking / pay_booking_with_credits: *0.2)'),
  ('withdrawal_fee_rate',           0.20,  'ratio', 'CareFind withdrawal fee (initiate-withdrawal TRANSFER_FEE_RATE)'),
  ('referral_first_payment_rate',   0.40,  'ratio', 'Referral commission on a business''s first plan payment (referral_program.js)'),
  ('referral_residual_rate',        0.05,  'ratio', 'Referral commission on every later plan payment (referral_program.js)'),
  ('subscription_max_coins',        12,    'coins', 'Highest creator subscription price (charge-subscription.js)'),
  ('min_withdrawal_coins',          5,     'coins', 'Smallest CareFind withdrawal (request_withdrawal / initiate-withdrawal)'),
  ('payment_intent_ttl_minutes',    1440,  'minutes', 'How long an unpaid payment intent stays open');

create or replace function public.financial_config_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'financial_config keys are never deleted' using errcode = '42501';
  end if;
  if new.key is distinct from old.key then
    raise exception 'financial_config.key is immutable' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger financial_config_guard
  before update or delete on public.financial_config
  for each row execute function public.financial_config_guard();
create trigger financial_config_no_truncate
  before truncate on public.financial_config
  for each statement execute function public.financial_no_truncate();

-- ---------------------------------------------------------------------------------------------
-- Access: server-only. RLS on with NO policies, plus explicit revokes (default privileges
-- re-grant to anon/authenticated at creation, so the revoke is not optional).
-- ---------------------------------------------------------------------------------------------
alter table public.payment_intents         enable row level security;
alter table public.payment_provider_events enable row level security;
alter table public.financial_config        enable row level security;

revoke all on public.payment_intents, public.payment_provider_events, public.financial_config
  from public, anon, authenticated;
-- service_role keeps SELECT/INSERT/UPDATE only; row deletion and truncation are also blocked by triggers.
revoke delete, truncate on public.payment_intents, public.payment_provider_events, public.financial_config
  from service_role;

revoke execute on function public.payment_intents_guard(), public.payment_provider_events_guard(),
  public.financial_config_guard(), public.financial_no_truncate() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Self-check: fail the migration if the end state is not what it claims.
-- ---------------------------------------------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(table_name || ':' || grantee || ':' || privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('payment_intents', 'payment_provider_events', 'financial_config')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if bad is not null then raise exception 'client roles still hold grants: %', bad; end if;

  select string_agg(c.relname, ', ') into bad
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('payment_intents', 'payment_provider_events', 'financial_config')
     and not c.relrowsecurity;
  if bad is not null then raise exception 'RLS not enabled on: %', bad; end if;

  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public' and tablename in ('payment_intents', 'payment_provider_events', 'financial_config');
  if bad is not null then raise exception 'unexpected policies: %', bad; end if;
end $$;
