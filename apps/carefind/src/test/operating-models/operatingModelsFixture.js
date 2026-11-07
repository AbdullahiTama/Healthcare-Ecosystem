// Shared PGlite fixture for the importer operating-model suites: the live table shapes, helpers and policies listed in
// operatingModels.db.test.js, the live stock ledger, carehub_20270102 and (unless asked not to) carehub_20270106.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoFile = (rel) => readFileSync(fileURLToPath(new URL('../../../../../' + rel, import.meta.url)), 'utf8')
export const MIGRATION = repoFile('supabase/migrations/carehub_20270102_importer_operating_models.sql')
// The owner's decision of 2026-11-07: under Centralised a supply takes the goods out of company stock.
export const CENTRALISED_STOCK = repoFile('supabase/migrations/carehub_20270106_centralised_supply_takes_stock.sql')
export const LEDGER_LIVE = repoFile('docs/architecture/stock-ledger-live-snapshot.sql')

export const CO = 'a0000000-0000-4000-8000-000000000001'
export const OTHER = 'b0000000-0000-4000-8000-000000000001'
export const PHARM = 'b0000000-0000-4000-8000-000000000002'
export const M = { amox: 'c0000000-0000-4000-8000-000000000001', para: 'c0000000-0000-4000-8000-000000000002' }
export const P = { amox: 'd0000000-0000-4000-8000-000000000001', para: 'd0000000-0000-4000-8000-000000000002', loose: 'd0000000-0000-4000-8000-000000000003' }
export const S = { mgr: 'e0000000-0000-4000-8000-000000000001', viewer: 'e0000000-0000-4000-8000-000000000002', ada: 'e0000000-0000-4000-8000-000000000003',
  bayo: 'e0000000-0000-4000-8000-000000000004', clerk: 'e0000000-0000-4000-8000-000000000005', chi: 'e0000000-0000-4000-8000-000000000006' }
export const USERS = { 'owner@co.com': 1, 'mgr@co.com': 2, 'viewer@co.com': 3, 'ada@co.com': 4, 'bayo@co.com': 5, 'clerk@co.com': 6,
  'other@x.com': 7, 'chi@co.com': 8, 'admin@carehub.ng': 9 }
export const OWNER = 'owner@co.com'
export const T = { lagos: 'f0000000-0000-4000-8000-000000000001', ibadan: 'f0000000-0000-4000-8000-000000000002', foreign: 'f0000000-0000-4000-8000-000000000003' }

// Boots a fresh database. centralisedStock: false stops before carehub_20270106 (the earlier Centralised stock rule).
export async function bootOperatingModels({ centralisedStock = true } = {}) {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;

    create table businesses (id uuid primary key default gen_random_uuid(), name text not null, owner text not null default '', branch_name text, email text,
      parent_business_id uuid references businesses(id), branch_depth_limit integer default 3, is_platform_admin boolean default false,
      business_type text, status text default 'active', plan text default 'growth', plan_expires_at timestamptz, state text, city text, lga text, area text,
      address text, phone text, visible_on_carefind boolean default true, ecommerce_enabled boolean not null default false, booking_enabled boolean default false,
      deleted_at timestamptz, created_at timestamptz default now(), referring_agent_id uuid,
      constraint businesses_main_has_email check (parent_business_id is not null or email is not null));
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id), full_name text not null, email text not null,
      role text, status text default 'active', auth_user_id uuid);
    create unique index staff_email_lower_key on staff (lower(email));
    create table roles (id uuid primary key default gen_random_uuid(), business_id uuid, name text, permissions jsonb, created_at timestamptz default now());
    create table master_products (id uuid primary key, business_id uuid references businesses(id), name text not null, category text default '', default_price integer default 0,
      generic_name text, barcode text, rx_status text default 'pharmacy_only', default_cost numeric default 0, reorder_level integer default 5);
    create table products (id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id), name text not null, generic_name text, category text,
      price numeric default 0, cost_price numeric default 0, stock integer default 0, reorder_level integer default 5, barcode text, sale_type text, list_on_carefind boolean default true,
      emoji text, master_product_id uuid references master_products(id), rx_status text, price_source text default 'master' check (price_source in ('master','branch')),
      price_unit text, sales_unit text, tracking_mode text not null default 'none');
    create table stock_batches (id uuid primary key default gen_random_uuid(), business_id uuid, product_id uuid, product_name text not null default '',
      batch_number text, quantity integer not null default 0, expiry_date date, status text not null default 'available', created_at timestamptz default now());
    create table stock_movements (id uuid primary key default gen_random_uuid(), business_id uuid, batch_id uuid, from_location_id uuid, to_location_id uuid, movement_type text,
      quantity integer, reason text, moved_by text, created_at timestamptz default now(), product_id uuid, source_type text, source_id text, source_line_id text,
      idempotency_key text, actor_id uuid, qty_before integer, qty_after integer,
      constraint stock_movements_type_check check (movement_type in ('opening','purchase_receipt','sale','sale_reversal','return_restock','return_writeoff','adjustment','write_off','transfer','tracking_change','correction')));
    create unique index stock_movements_idem_uniq on stock_movements (business_id, idempotency_key) where idempotency_key is not null;
    create table staff_notifications (id uuid primary key default gen_random_uuid(), business_id uuid, staff_id uuid, is_owner boolean, kind text not null, title text not null,
      body text, link text, read_at timestamptz, created_at timestamptz default now());
    create table audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid not null, actor_type text not null, branch_id uuid not null references businesses(id),
      action text not null, target_type text, target_id uuid, metadata jsonb, created_at timestamptz not null default now());
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, txn_no text not null default 'T', is_on_hold boolean, status text,
      cashier_staff_id uuid, deleted_at timestamptz, is_credit boolean default false, balance numeric default 0);
    create table territories (id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id), name text not null, level text,
      parent_territory_id uuid, created_at timestamptz default now());
    create table orders (id uuid primary key default gen_random_uuid(), business_id uuid, order_ref text, customer_name text, status text not null default 'submitted',
      total_value numeric default 0, created_by_staff_id uuid, created_by_name text, created_at timestamptz default now());
    create function plan_limit(p_plan text, p_what text) returns integer language sql immutable as $$
      select case coalesce(p_plan, 'basic') when 'growth' then case p_what when 'locations' then 5 end
        when 'custom' then null else case p_what when 'staff' then 5 when 'locations' then 2 when 'products' then 5000 end end $$;
    create function plan_state(p_expires_at timestamptz) returns text language sql stable as $$ select 'active'::text $$;
    create table stock_transfers (id uuid primary key default gen_random_uuid(), from_branch_id uuid, to_branch_id uuid, status text not null default 'in_transit');
    create table ecommerce_products (id uuid primary key default gen_random_uuid(), business_id uuid not null, product_id uuid not null, status text not null default 'draft');

    -- live definitions
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      with recursive visible as (
        select b.id, b.parent_business_id, b.branch_depth_limit, 0 as depth from businesses b where lower(b.email) = lower(auth.email())
        union all
        select child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1 from businesses child join visible on child.parent_business_id = visible.id
         where visible.depth < visible.branch_depth_limit)
      select id from visible
      union
      select b.id from businesses b join staff s on s.business_id = b.id where lower(s.email) = lower(auth.email()) and s.status = 'active' $$;
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email())), false) $$;
    create function is_business_owner_email(p_email text, p_business_id uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
      with recursive chain as (
        select b.id, b.parent_business_id, b.email, 0 as depth from public.businesses b where b.id = p_business_id
        union all select p.id, p.parent_business_id, p.email, c.depth + 1 from public.businesses p join chain c on p.id = c.parent_business_id where c.depth < 10)
      select coalesce(p_email, '') <> '' and exists (select 1 from chain where lower(email) = lower(trim(p_email))) $$;
    create function caller_owns_business(bid uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
      with recursive up(id, parent_business_id, email, depth) as (
        select b.id, b.parent_business_id, b.email, 0 from public.businesses b where b.id = bid
        union select p.id, p.parent_business_id, p.email, up.depth + 1 from public.businesses p join up on p.id = up.parent_business_id where up.depth < 10)
      select auth.email() is not null and exists (select 1 from up where lower(up.email) = lower(auth.email())) $$;
    -- The live guard refuses any browser change of a member's business (and much more); server code is trusted.
    create function guard_staff_writes() returns trigger language plpgsql as $$
      begin
        if current_user in ('authenticated', 'anon') and (tg_op <> 'UPDATE' or new.business_id is distinct from old.business_id) then
          raise exception 'A staff member''s business, email and login cannot be edited.' using errcode = '42501';
        end if;
        return coalesce(new, old);
      end $$;
    create trigger guard_staff_writes before insert or update or delete on staff for each row execute function guard_staff_writes();
    create function enforce_product_stock_floor() returns trigger language plpgsql as $$
      begin if new.stock < 0 and (tg_op = 'INSERT' or new.stock < coalesce(old.stock, 0)) then
        raise exception 'INSUFFICIENT_STOCK: product stock cannot be reduced below zero (would be %).', new.stock using errcode = 'check_violation'; end if; return new; end $$;
    create trigger enforce_product_stock_floor before insert or update of stock on products for each row execute function enforce_product_stock_floor();

    do $$ declare t text; begin foreach t in array array['businesses','staff','roles','products','master_products','stock_movements','staff_notifications','audit_log',
      'sales','stock_transfers','ecommerce_products','territories','orders'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
      execute format('grant all on %I to service_role', t);
    end loop; end $$;
    create policy "products of own business" on products for all to authenticated
      using (business_id in (select current_business_ids()) or is_platform_admin()) with check (business_id in (select current_business_ids()) or is_platform_admin());
    create policy "own business row" on businesses for all to authenticated
      using (lower(email) = lower(auth.email()) or is_platform_admin()) with check (lower(email) = lower(auth.email()) or is_platform_admin());
    create policy "owner manages own branches" on businesses for all to authenticated
      using (parent_business_id is not null and caller_owns_business(parent_business_id)) with check (parent_business_id is not null and caller_owns_business(parent_business_id));
    create policy "public can view active visible businesses" on businesses for select using (status = 'active' and visible_on_carefind = true);
    create policy "staff of own business" on staff for all to authenticated using (business_id in (select current_business_ids()));
    create policy "own ecommerce" on ecommerce_products for all to authenticated using (business_id in (select current_business_ids())) with check (business_id in (select current_business_ids()));
    create policy "own sales" on sales for all to authenticated using (business_id in (select current_business_ids())) with check (business_id in (select current_business_ids()));

    insert into businesses (id, name, owner, email, business_type, state, city) values
      ('${CO}', 'Zenith Pharma Ltd', 'Mrs Owner', 'owner@co.com', 'manufacturer_importer', 'Lagos', 'Ikeja'),
      ('${OTHER}', 'Other Importer', 'Other', 'other@x.com', 'manufacturer_importer', 'Oyo', 'Ibadan'),
      ('${PHARM}', 'A Pharmacy', 'P', 'pharm@x.com', 'pharmacy', 'Lagos', 'Yaba');
    insert into businesses (name, owner, email, is_platform_admin, business_type) values ('CareHub', 'Admin', 'admin@carehub.ng', true, 'other');
    insert into staff (id, business_id, full_name, email, role) values
      ('${S.mgr}', '${CO}', 'Musa Manager', 'mgr@co.com', 'Sales Manager'), ('${S.viewer}', '${CO}', 'Vera Viewer', 'viewer@co.com', 'Accounts'),
      ('${S.ada}', '${CO}', 'Ada Obi', 'ada@co.com', 'Medical sales rep'), ('${S.bayo}', '${CO}', 'Bayo Ade', 'bayo@co.com', 'Medical sales rep'),
      ('${S.clerk}', '${CO}', 'Clara Clerk', 'clerk@co.com', 'Cashier');
    insert into staff (id, business_id, full_name, email, role, status) values ('${S.chi}', '${CO}', 'Chi Eze', 'chi@co.com', 'Medical sales rep', 'invited');
    insert into roles (business_id, name, permissions) values
      ('${CO}', 'Sales Manager', '{"canManageRepLedger": true}'), ('${CO}', 'Accounts', '{"canViewRepLedger": true}'),
      ('${CO}', 'Medical sales rep', '{"nav": ["activity", "pos"]}');
    insert into master_products (id, business_id, name) values ('${M.amox}', '${CO}', 'Amoxil 500'), ('${M.para}', '${CO}', 'Paracetamol');
    insert into products (id, business_id, name, price, cost_price, stock, master_product_id, list_on_carefind) values
      ('${P.amox}', '${CO}', 'Amoxil 500', 1200, 900, 100, '${M.amox}', true), ('${P.para}', '${CO}', 'Paracetamol', 300, 200, 50, '${M.para}', true),
      ('${P.loose}', '${CO}', 'Unlinked Syrup', 500, 300, 10, null, true);
  `)
  await db.exec(LEDGER_LIVE)
  await db.exec(MIGRATION)
  if (centralisedStock) await db.exec(CENTRALISED_STOCK)
  // Live: guard_business_insert runs before every insert into businesses.
  await db.exec('create trigger guard_business_insert before insert on businesses for each row execute function guard_business_insert()')
  await db.exec(`insert into territories (id, business_id, name, level) values
    ('${T.lagos}', '${CO}', 'Lagos Mainland', 'area'), ('${T.ibadan}', '${CO}', 'Ibadan', 'area'), ('${T.foreign}', '${OTHER}', 'Abuja', 'area')`)
  return db
}
