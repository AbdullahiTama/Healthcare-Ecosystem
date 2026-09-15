-- ============================================================================
-- CareHub customer & requisition modules — one idempotent script covering:
--
--   1. client_id links on sales / appointments / debts (customer database
--      integration: full per-customer history across POS, appointments and
--      debt management)
--   2. out_of_stock — digital replacement for the paper "out of stock" book
--   3. customer_requests — log of products customers ask for but are unavailable
--   4. requisitions — supplier orders with product list, quantity, optional
--      cost and total, exportable as PDF
--   5. RLS for the three new tables, same template as phase2_rls_pilot.sql
--      (current_business_ids() / is_platform_admin() helpers from that file
--      must exist first — run phase2_rls_pilot.sql before this one)
--
-- Applies to the shared Supabase project. Run once via the Supabase SQL
-- editor; every statement is idempotent so re-running is safe.
-- ============================================================================

-- 1. Customer database links -------------------------------------------------
alter table sales
  add column if not exists client_id uuid references clients(id) on delete set null;
alter table appointments
  add column if not exists client_id uuid references clients(id) on delete set null;
alter table debts
  add column if not exists client_id uuid references clients(id) on delete set null;

create index if not exists sales_client_id_idx on sales(client_id);
create index if not exists appointments_client_id_idx on appointments(client_id);
create index if not exists debts_client_id_idx on debts(client_id);

-- 2. Out-of-stock book -------------------------------------------------------
create table if not exists out_of_stock (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  product_id uuid references products(id) on delete set null,
  product_name text not null,
  notes text,
  status text not null default 'open',       -- open | fulfilled
  created_by text,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);

-- 3. Customer requests -------------------------------------------------------
create table if not exists customer_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  client_id uuid references clients(id) on delete set null,
  client_name text,
  phone text,
  product_name text not null,
  quantity text,
  notes text,
  status text not null default 'open',       -- open | fulfilled
  created_at timestamptz not null default now()
);

-- 4. Requisitions (supplier orders) ------------------------------------------
create table if not exists requisitions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  supplier_name text not null,
  items jsonb not null default '[]',         -- [{product_name, quantity, cost, unit}]
  total numeric default 0,
  notes text,
  status text not null default 'draft',      -- draft | sent
  created_at timestamptz not null default now()
);

-- 5. RLS — same pattern as phase2_rls_pilot.sql ------------------------------
alter table out_of_stock enable row level security;
drop policy if exists "out_of_stock of own business" on out_of_stock;
create policy "out_of_stock of own business" on out_of_stock
  for all
  using (business_id in (select current_business_ids()) or is_platform_admin())
  with check (business_id in (select current_business_ids()) or is_platform_admin());

alter table customer_requests enable row level security;
drop policy if exists "customer_requests of own business" on customer_requests;
create policy "customer_requests of own business" on customer_requests
  for all
  using (business_id in (select current_business_ids()) or is_platform_admin())
  with check (business_id in (select current_business_ids()) or is_platform_admin());

alter table requisitions enable row level security;
drop policy if exists "requisitions of own business" on requisitions;
create policy "requisitions of own business" on requisitions
  for all
  using (business_id in (select current_business_ids()) or is_platform_admin())
  with check (business_id in (select current_business_ids()) or is_platform_admin());
