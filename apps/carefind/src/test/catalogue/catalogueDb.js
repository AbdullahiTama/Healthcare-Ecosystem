// Shared PGlite set-up for the catalogue health and clean-up tests (phases 5 and 6): pg_trgm, the live shapes of
// businesses, staff, products, master_products, branch_products, stock_batches, stock_movements, business_claims and
// the shop tables; the live current_business_ids(), is_platform_admin() (not executable by anon, as live),
// is_business_manager() and is_business_owner(); then carehub_20261215 (foundation), 20261223 / 20261224 (library), the
// live stock ledger (docs/architecture/stock-ledger-live-snapshot.sql), 20261221 (prescription safety) and
// 20270127 / 20270128 (catalogue health). Fixtures: Allen Pharmacy (A, owner@allen.com) with its Ikeja branch (A1),
// a cashier (tunde@allen.com) and a manager (kemi@allen.com); Bello Chemist (B, owner@bello.com).
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const repoFile = (rel) => readFileSync(fileURLToPath(new URL('../../../../../' + rel, import.meta.url)), 'utf8')
export const MIGRATIONS = {
  FOUNDATION: repoFile('supabase/migrations/carehub_20261215_catalogue_foundation.sql'),
  LIBRARY: repoFile('supabase/migrations/carehub_20261223_shared_product_library.sql'),
  ANON_READ: repoFile('supabase/migrations/carehub_20261224_catalog_items_anon_read.sql'),
  LEDGER_LIVE: repoFile('docs/architecture/stock-ledger-live-snapshot.sql'),
  RX_SAFETY: repoFile('supabase/migrations/carehub_20261221_prescription_safety.sql'),
  HEALTH: repoFile('supabase/migrations/carehub_20270127_catalogue_health.sql'),
  SPEED: repoFile('supabase/migrations/carehub_20270128_catalogue_pairs_speed.sql'),
}
export const A = 'a0000000-0000-4000-8000-000000000001'   // Allen Pharmacy (main)
export const A1 = 'a0000000-0000-4000-8000-000000000011'  // its Ikeja branch
export const B = 'b0000000-0000-4000-8000-000000000001'   // another business

// A database with the live shapes and every catalogue migration up to phase 5 applied.
export async function createCatalogueDb() {
  const db = new PGlite({ extensions: { pg_trgm } })
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key default gen_random_uuid(), name text, email text, parent_business_id uuid,
      branch_depth_limit integer default 3, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, email text, role text, status text default 'active');
    create table products (id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id) on delete cascade, owner_id uuid,
      name text not null, generic_name text, category text, price numeric default 0, stock integer default 0, emoji text default '📦',
      image_url text, description text, whatsapp text, price_unit text, min_purchase integer, seller_location text,
      latitude double precision, longitude double precision,
      list_on_carefind boolean default true, created_at timestamp default now(), cost_price numeric default 0, barcode text,
      reorder_level integer default 5, sale_type text, show_price boolean default true not null, tracking_mode text not null default 'none');
    create table master_products (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id),
      name text not null, description text default '', category text default '', default_price integer default 0 not null,
      created_at timestamptz default now() not null, updated_at timestamptz default now() not null);
    create table branch_products (id uuid primary key default gen_random_uuid(), branch_id uuid not null references businesses(id),
      master_product_id uuid not null references master_products(id), active boolean default true not null, override_price integer,
      created_at timestamptz default now() not null, unique (branch_id, master_product_id));
    create table staff_notifications (id uuid primary key default gen_random_uuid(), business_id uuid, staff_id uuid, is_owner boolean,
      kind text not null, title text not null, body text, link text, read_at timestamptz, created_at timestamptz default now());
    create table stock_batches (id uuid primary key default gen_random_uuid(), business_id uuid, product_id uuid, product_name text not null default '',
      batch_number text, quantity integer not null default 0, expiry_date date, status text not null default 'available', created_at timestamptz default now());
    create table stock_movements (id uuid primary key default gen_random_uuid(), business_id uuid, batch_id uuid, from_location_id uuid, to_location_id uuid, movement_type text,
      quantity integer, reason text, moved_by text, created_at timestamptz default now(), product_id uuid, source_type text, source_id text, source_line_id text,
      idempotency_key text, actor_id uuid, qty_before integer, qty_after integer,
      constraint stock_movements_type_check check (movement_type in ('opening','purchase_receipt','sale','sale_reversal','return_restock','return_writeoff','adjustment','write_off','transfer','tracking_change','correction')));
    create table business_claims (id uuid primary key default gen_random_uuid(), business_id uuid, user_id uuid, status text);
    create table ecommerce_products (id uuid primary key default gen_random_uuid(), business_id uuid, product_id uuid, status text, description text, category text,
      ecommerce_price_kobo integer, attributes jsonb, active_at timestamptz, prescription_required boolean default false, warnings text, restrictions text,
      is_restricted boolean default false);
    create table shop_order_items (id uuid primary key default gen_random_uuid(), order_id uuid, ecommerce_product_id uuid, product_id uuid, product_name text);
    -- live definitions
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      with recursive visible as (
        select b.id, b.parent_business_id, b.branch_depth_limit, 0 as depth from businesses b where lower(b.email) = lower(auth.email())
        union
        select b.id, b.parent_business_id, b.branch_depth_limit, 0 from businesses b join staff s on s.business_id = b.id
         where lower(s.email) = lower(auth.email()) and s.status = 'active'
        union all
        select c.id, c.parent_business_id, c.branch_depth_limit, visible.depth + 1 from businesses c join visible on c.parent_business_id = visible.id
         where visible.depth < visible.branch_depth_limit)
      select distinct id from visible $$;
    create function is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
      select coalesce((select is_platform_admin from businesses where lower(email) = lower(auth.email()) limit 1), false) $$;
    revoke execute on function is_platform_admin() from public, anon;
    grant execute on function is_platform_admin() to authenticated, service_role;
    create function is_business_manager(bid uuid) returns boolean language sql stable security definer set search_path = public as $$
      with recursive ancestry as (
        select b.id, b.parent_business_id, b.email, 0 as depth from businesses b where b.id = bid
        union all select p.id, p.parent_business_id, p.email, a.depth + 1 from businesses p join ancestry a on p.id = a.parent_business_id where a.depth < 10)
      select (bid in (select current_business_ids()) and (exists (select 1 from ancestry a where lower(a.email) = lower(auth.email()))
        or exists (select 1 from staff s where s.business_id = bid and lower(s.email) = lower(auth.email()) and s.status = 'active' and s.role ~* 'manager')))
        or public.is_platform_admin() $$;
    create function is_business_owner(bid uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
      with recursive ancestry as (
        select b.id, b.parent_business_id, b.email, 0 as depth from public.businesses b where b.id = bid
        union all select p.id, p.parent_business_id, p.email, a.depth + 1 from public.businesses p join ancestry a on p.id = a.parent_business_id where a.depth < 10)
      select auth.uid() is not null and bid in (select public.current_business_ids())
        and (exists (select 1 from ancestry a where lower(a.email) = lower(auth.email()))
          or exists (select 1 from public.staff s where s.business_id = bid and s.status = 'active' and s.role = 'Owner' and lower(s.email) = lower(auth.email()))) $$;
    create function is_ecommerce_vendor_approved(uuid) returns boolean language sql stable as $$ select true $$;
    create function deactivate_branch_product(p_branch_id uuid, p_master_product_id uuid) returns boolean language plpgsql set search_path = public as $$
      begin update branch_products set active = false where branch_id = p_branch_id and master_product_id = p_master_product_id; return found; end $$;
    create function enforce_product_stock_floor() returns trigger language plpgsql as $$
      begin if new.stock < 0 and (tg_op = 'INSERT' or new.stock < coalesce(old.stock, 0)) then
        raise exception 'INSUFFICIENT_STOCK: product stock cannot be reduced below zero (would be %).', new.stock using errcode = 'check_violation'; end if; return new; end $$;
    do $$ declare t text; begin foreach t in array array['businesses','staff','products','master_products','branch_products','staff_notifications',
        'stock_batches','stock_movements','business_claims','ecommerce_products','shop_order_items'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
      execute format('grant select on %I to anon', t);
      execute format('grant all on %I to service_role', t);
    end loop; end $$;
    create policy "own business" on businesses for all to authenticated using (id in (select current_business_ids()) or is_platform_admin()) with check (true);
    create policy "own products" on products for all to authenticated using (business_id in (select current_business_ids())) with check (business_id in (select current_business_ids()));
    create policy "own batches" on stock_batches for all to authenticated using (business_id in (select current_business_ids()));
    create policy "own movements" on stock_movements for select to authenticated using (business_id in (select current_business_ids()));
    create policy "claims readable" on business_claims for select using (true);
    create policy "master_products tenant visibility" on master_products for all using (business_id in (select current_business_ids()) or is_platform_admin());
    create policy "master_products owner insert" on master_products for insert with check (business_id in (select current_business_ids()) or is_platform_admin());
    create policy "master_products owner update" on master_products for update using (business_id in (select current_business_ids()) or is_platform_admin())
      with check (business_id in (select current_business_ids()) or is_platform_admin());
    create policy "branch_products tenant visibility" on branch_products for all using (branch_id in (select current_business_ids()) or is_platform_admin());
    create policy "public can view listed products" on products for select using (list_on_carefind = true);

    insert into businesses (id, name, email) values ('${A}', 'Allen Pharmacy', 'owner@allen.com'), ('${B}', 'Bello Chemist', 'owner@bello.com');
    insert into businesses (id, name, email, parent_business_id) values ('${A1}', 'Allen · Ikeja', 'ikeja@allen.com', '${A}');
    insert into staff (business_id, email, role) values ('${A1}', 'tunde@allen.com', 'Cashier'), ('${A}', 'kemi@allen.com', 'Store Manager');
  `)
  await db.exec(MIGRATIONS.FOUNDATION)
  await db.exec(MIGRATIONS.LIBRARY)
  await db.exec(MIGRATIONS.ANON_READ)
  await db.exec(MIGRATIONS.LEDGER_LIVE)
  await db.exec(MIGRATIONS.RX_SAFETY)
  await db.exec(MIGRATIONS.HEALTH)
  await db.exec(MIGRATIONS.SPEED)
  return db
}

// Runs fn(query) as a signed-in user with that email (as) or as the public (anon), then resets the session.
export function sessions(db) {
  async function run(claims, role, fn) {
    await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify(claims)])
    await db.query(`set role ${role}`)
    try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally {
      await db.query('reset role')
      await db.query(`select set_config('request.jwt.claims','',false)`)
    }
  }
  const as = (email, fn, sub = '10000000-0000-4000-8000-000000000001') => run({ sub, email, role: 'authenticated' }, 'authenticated', fn)
  const anon = (fn) => run({ role: 'anon' }, 'anon', fn)
  return { as, anon }
}
