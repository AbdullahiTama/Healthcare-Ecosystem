// @vitest-environment node
// Product catalogue phase 5 (carehub_20270127_catalogue_health) on PGlite with pg_trgm, after carehub_20261215
// (foundation), carehub_20261223 / 20261224 (library), the live stock ledger (docs/architecture/stock-ledger-live-snapshot.sql)
// and carehub_20261221 (prescription safety), with the live shapes of businesses, staff, products, master_products,
// branch_products, stock_batches, stock_movements, business_claims and the shop tables, and the live
// current_business_ids(), is_platform_admin() (not executable by anon), is_business_manager() and is_business_owner().
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const repoFile = (rel) => readFileSync(fileURLToPath(new URL('../../../../../' + rel, import.meta.url)), 'utf8')
const FOUNDATION = repoFile('supabase/migrations/carehub_20261215_catalogue_foundation.sql')
const LIBRARY = repoFile('supabase/migrations/carehub_20261223_shared_product_library.sql')
const ANON_READ = repoFile('supabase/migrations/carehub_20261224_catalog_items_anon_read.sql')
const LEDGER_LIVE = repoFile('docs/architecture/stock-ledger-live-snapshot.sql')
const RX_SAFETY = repoFile('supabase/migrations/carehub_20261221_prescription_safety.sql')
const HEALTH = repoFile('supabase/migrations/carehub_20270127_catalogue_health.sql')
const SPEED = repoFile('supabase/migrations/carehub_20270128_catalogue_pairs_speed.sql')

const A = 'a0000000-0000-4000-8000-000000000001'   // Allen Pharmacy (main)
const A1 = 'a0000000-0000-4000-8000-000000000011'  // its Ikeja branch
const B = 'b0000000-0000-4000-8000-000000000001'   // another business
const M = {
  pan1: 'c0000000-0000-4000-8000-000000000001', pan2: 'c0000000-0000-4000-8000-000000000002',
  amox: 'c0000000-0000-4000-8000-000000000003', amoxCaps: 'c0000000-0000-4000-8000-000000000004',
  vitTabs: 'c0000000-0000-4000-8000-000000000005', vitTab: 'c0000000-0000-4000-8000-000000000006',
  vit500: 'c0000000-0000-4000-8000-000000000007', chipsB: 'c0000000-0000-4000-8000-000000000008',
  chipsS: 'c0000000-0000-4000-8000-000000000009', consult: 'c0000000-0000-4000-8000-00000000000a',
  theirs: 'c0000000-0000-4000-8000-00000000000b', theirs2: 'c0000000-0000-4000-8000-00000000000c',
  tram: 'c0000000-0000-4000-8000-00000000000d',
  clinda: 'c0000000-0000-4000-8000-00000000000e', clindaShort: 'c0000000-0000-4000-8000-00000000000f',
}
const P = {
  pan1A: 'e0000000-0000-4000-8000-000000000001', pan2A: 'e0000000-0000-4000-8000-000000000002',
  pan2A1: 'e0000000-0000-4000-8000-000000000003', amoxA: 'e0000000-0000-4000-8000-000000000004',
  amoxCapsA: 'e0000000-0000-4000-8000-000000000005', rxNoPrice: 'e0000000-0000-4000-8000-000000000006',
}
const LIB = 'f0000000-0000-4000-8000-000000000001'
let db

async function as(email, fn, sub = '10000000-0000-4000-8000-000000000001') {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub, email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally {
    await db.query('reset role')
    await db.query(`select set_config('request.jwt.claims','',false)`)
  }
}
async function anon(fn) {
  await db.query(`select set_config('request.jwt.claims','{"role":"anon"}',false)`)
  await db.query('set role anon')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally {
    await db.query('reset role')
    await db.query(`select set_config('request.jwt.claims','',false)`)
  }
}
const rows = async (s, p) => (await db.query(s, p)).rows
const one = async (s, p) => (await rows(s, p))[0]
const owner = (fn) => as('owner@allen.com', fn)
const manager = (fn) => as('kemi@allen.com', fn)
const cashier = (fn) => as('tunde@allen.com', fn)
const outsider = (fn) => as('owner@bello.com', fn)
const pairKey = (p) => [p.item_a, p.item_b].sort().join('|')
const pairOf = (x, y) => [x, y].sort().join('|')
const pairsOf = async (business = A) => owner((q) => q('select * from catalogue_pairs($1)', [business]))

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } })
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
  await db.exec(FOUNDATION)
  await db.exec(LIBRARY)
  await db.exec(ANON_READ)
  await db.exec(LEDGER_LIVE)
  await db.exec(RX_SAFETY)
  await db.exec(HEALTH)
  await db.exec(SPEED)
  await db.exec(`
    insert into catalog_items (id, brand_name, generic_name, category_code, rx_status, status, source)
      values ('${LIB}', 'Amoxil', 'Amoxicillin', 'antibiotics', 'prescription_only', 'active', 'admin');
    insert into master_products (id, business_id, name, generic_name, barcode, default_price, category_code, rx_status, category) values
      ('${M.pan1}', '${A}', 'Panadol Extra', null, '6001', 400, 'medicines_other', 'otc', 'Medicines'),
      ('${M.pan2}', '${A}', 'Panadol-Extra', 'Paracetamol', null, 0, 'analgesics', 'pharmacy_only', 'Analgesics'),
      ('${M.amox}', '${A}', 'Amoxil 500mg', 'Amoxicillin', '5010', 1200, 'antibiotics', 'prescription_only', 'Antibiotics'),
      ('${M.amoxCaps}', '${A}', 'Amoxicillin Caps', null, '5010', 1100, null, 'pharmacy_only', ''),
      ('${M.vitTabs}', '${A}', 'Vitamin C 1000mg tablets', 'Ascorbic acid', '7001', 500, 'vitamins', 'otc', 'Vitamins'),
      ('${M.vitTab}', '${A}', 'Vitamin C 1000mg tablet', 'Ascorbic acid', '7002', 500, 'vitamins', 'otc', 'Vitamins'),
      ('${M.vit500}', '${A}', 'Vitamin C 500mg tablets', 'Ascorbic acid', '7003', 300, 'vitamins', 'otc', 'Vitamins'),
      ('${M.chipsB}', '${A}', 'Archkings plantain chips b/s', null, '8001', 200, 'food_drinks', 'otc', 'Food'),
      ('${M.chipsS}', '${A}', 'Archkings plantain chips s/s', null, '8002', 100, 'food_drinks', 'otc', 'Food'),
      ('${M.consult}', '${A}', 'Consultation', null, null, 0, 'services', 'otc', 'Services'),
      ('${M.tram}', '${A}', 'Tramadol', 'Tramadol', '9001', 2500, 'analgesics', 'controlled', 'Analgesics'),
      ('${M.theirs}', '${B}', 'Panadol Extra', null, '6001', 380, 'analgesics', 'otc', ''),
      ('${M.theirs2}', '${B}', 'Panadol  Extra.', null, null, 380, 'analgesics', 'otc', ''),
      ('${M.clinda}', '${B}', 'Clindamycin 300mg', null, null, 900, 'antibiotics', 'prescription_only', ''),
      ('${M.clindaShort}', '${B}', 'Clinda 300mg (clindamycin)', null, null, 900, 'antibiotics', 'prescription_only', '');
    update master_products set catalog_item_id = '${LIB}' where id = '${M.amox}';
    insert into products (id, business_id, name, generic_name, category, price, stock, barcode, master_product_id, rx_status, list_on_carefind) values
      ('${P.pan1A}', '${A}', 'Panadol Extra', null, 'Medicines', 400, 5, '6001', '${M.pan1}', 'otc', true),
      ('${P.pan2A}', '${A}', 'Panadol-Extra', 'Paracetamol', 'Analgesics', 0, 3, null, '${M.pan2}', 'pharmacy_only', true),
      ('${P.pan2A1}', '${A1}', 'Panadol-Extra', 'Paracetamol', 'Analgesics', 450, 2, null, '${M.pan2}', 'pharmacy_only', true),
      ('${P.amoxA}', '${A}', 'Amoxil 500mg', 'Amoxicillin', 'Antibiotics', 1200, 4, '5010', '${M.amox}', 'prescription_only', true),
      ('${P.amoxCapsA}', '${A}', 'Amoxicillin Caps', null, '', 1100, 0, '5010', '${M.amoxCaps}', 'pharmacy_only', true),
      ('${P.rxNoPrice}', '${A}', 'Tramadol', null, 'Analgesics', 0, 1, null, '${M.tram}', 'controlled', true);
    update products set stock = -1 where id = '${P.amoxCapsA}';
    insert into branch_products (branch_id, master_product_id, active, override_price) values
      ('${A}', '${M.pan1}', true, null), ('${A}', '${M.pan2}', true, null), ('${A1}', '${M.pan2}', false, 450),
      ('${A}', '${M.amox}', true, null), ('${A}', '${M.amoxCaps}', true, null)
      on conflict (branch_id, master_product_id) do update set active = excluded.active, override_price = excluded.override_price;
    insert into stock_batches (business_id, product_id, product_name, batch_number, quantity) values ('${A}', '${P.pan2A}', 'Panadol-Extra', 'PX-1', 3);
  `)
})

describe('missing-data flags and the health score', () => {
  it('flags each item once per issue, with generic names for medicines only and barcodes for anything but a service', async () => {
    const flags = await owner((q) => q(`select m.name, catalogue_issue(m, 'no_price') no_price, catalogue_issue(m, 'no_generic') no_generic,
      catalogue_issue(m, 'no_barcode') no_barcode, catalogue_issue(m, 'other_category') other, catalogue_issue(m, 'unlinked') unlinked,
      catalogue_issue(m, 'hidden') hidden from master_products m where business_id = $1 order by name`, [A]))
    const by = Object.fromEntries(flags.map((f) => [f.name, f]))
    expect(by['Panadol-Extra']).toMatchObject({ no_price: true, no_generic: false, no_barcode: true, other: false, hidden: true })
    expect(by['Panadol Extra']).toMatchObject({ no_price: false, no_generic: true, no_barcode: false, other: true, hidden: false })
    expect(by['Amoxicillin Caps']).toMatchObject({ other: true, no_generic: true })
    expect(by['Amoxil 500mg']).toMatchObject({ unlinked: false, no_generic: false })
    expect(by['Archkings plantain chips b/s']).toMatchObject({ no_generic: false })
    expect(by.Consultation).toMatchObject({ no_price: true, no_barcode: false, no_generic: false })
  })

  it('reports a score and every count; outsiders and the public are refused', async () => {
    const h = (await owner((q) => q('select catalogue_health($1) h', [A])))[0].h
    expect(h).toMatchObject({ total: 11, counts: { no_price: 2, other_category: 2, duplicates: 3, no_generic: 2, no_barcode: 1, unlinked: 10, hidden: 1 }, duplicate_items: 6 })
    // A prescription-only item with no price at its location is not "hidden": CareFind lists it as "ask the pharmacist".
    // 100 - (25*2 + 20*2 + 15*6 + 10*2 + 10*1 + 10*10 + 10*1) / 11 = 100 - 29.1 = 71
    expect(h.score).toBe(71)
    await expect(outsider((q) => q('select catalogue_health($1)', [A]))).rejects.toThrow(/not yours/)
    await expect(anon((q) => q('select catalogue_health($1)', [A]))).rejects.toThrow()
  })

  it('an empty catalogue has no score', async () => {
    await db.query(`insert into businesses (id, name, email) values ('d0000000-0000-4000-8000-000000000001', 'New', 'new@x.com')`)
    const h = (await as('new@x.com', (q) => q(`select catalogue_health('d0000000-0000-4000-8000-000000000001') h`)))[0].h
    expect(h).toMatchObject({ total: 0, score: null })
  })

  it('the Master Catalog page filters by one flag, and still works without it', async () => {
    const page = await owner((q) => q(`select item->>'name' n, total from master_catalog_page($1, p_health => 'no_price')`, [A]))
    expect(page.map((r) => r.n).sort()).toEqual(['Consultation', 'Panadol-Extra'])
    const hidden = await owner((q) => q(`select item->>'name' n from master_catalog_page($1, p_health => 'hidden')`, [A]))
    expect(hidden.map((r) => r.n)).toEqual(['Panadol-Extra'])
    const plain = await owner((q) => q(`select count(*)::int n from master_catalog_page($1, null, null, false, 0, 50, null, null)`, [A]))
    expect(plain[0].n).toBe(11)
  })
})

describe('possible duplicates', () => {
  it('pairs a shared barcode, the same letters and digits, and a near-identical name with the same numbers', async () => {
    const pairs = await pairsOf()
    expect(Object.fromEntries(pairs.map((p) => [pairKey(p), p.reason]))).toEqual({
      [pairOf(M.amox, M.amoxCaps)]: 'barcode',
      [pairOf(M.pan1, M.pan2)]: 'name',
      [pairOf(M.vitTabs, M.vitTab)]: 'similar',
    })
  })

  it('never pairs different strengths, size variants or another business\'s items', async () => {
    const keys = (await pairsOf()).map(pairKey)
    expect(keys).not.toContain(pairOf(M.vitTabs, M.vit500))
    expect(keys).not.toContain(pairOf(M.chipsB, M.chipsS))
    expect(await outsider((q) => q('select * from catalogue_pairs($1)', [A]))).toEqual([])
    const theirs = await outsider((q) => q('select * from catalogue_pairs($1)', [B]))
    // A near-identical name is found even when the first words differ, as long as a word of 4+ letters is shared.
    expect(Object.fromEntries(theirs.map((p) => [pairKey(p), p.reason]))).toEqual({
      [pairOf(M.theirs, M.theirs2)]: 'name',
      [pairOf(M.clinda, M.clindaShort)]: 'similar',
    })
  })

  it('lists each side with its details, locations and stock, barcode matches first', async () => {
    const list = await owner((q) => q('select * from catalogue_duplicate_pairs($1)', [A]))
    expect(list.map((r) => r.reason)).toEqual(['barcode', 'name', 'similar'])
    expect(Number(list[0].total)).toBe(3)
    const pan = list.find((r) => r.reason === 'name')
    const sides = [pan.item_a, pan.item_b].sort((x, y) => x.name.localeCompare(y.name))
    expect(sides[0]).toMatchObject({ name: 'Panadol Extra', locations: 1, stock: 5 })
    expect(sides[1]).toMatchObject({ name: 'Panadol-Extra', locations: 2, stock: 5, generic_name: 'Paracetamol' })
  })

  it('a manager dismisses a pair; a cashier and an outsider cannot; nobody writes the table directly', async () => {
    await expect(cashier((q) => q('select dismiss_duplicate_pair($1, $2, $3)', [A, M.vitTab, M.vitTabs]))).rejects.toThrow(/owner or a manager/)
    await expect(outsider((q) => q('select dismiss_duplicate_pair($1, $2, $3)', [A, M.vitTab, M.vitTabs]))).rejects.toThrow(/owner or a manager/)
    await expect(manager((q) => q(`insert into catalogue_duplicate_dismissals (business_id, item_a, item_b) values ($1, $2, $3)`,
      [A, M.vitTabs, M.vitTab]))).rejects.toThrow()
    await expect(manager((q) => q('select dismiss_duplicate_pair($1, $2, $3)', [A, M.vitTab, M.theirs]))).rejects.toThrow(/not both/)
    await manager((q) => q('select dismiss_duplicate_pair($1, $2, $3)', [A, M.vitTab, M.vitTabs]))
    await manager((q) => q('select dismiss_duplicate_pair($1, $2, $3)', [A, M.vitTabs, M.vitTab])) // again, either order: no error
    expect((await pairsOf()).map(pairKey)).not.toContain(pairOf(M.vitTabs, M.vitTab))
    expect(await manager((q) => q('select count(*)::int n from catalogue_duplicate_dismissals'))).toEqual([{ n: 1 }])
    expect(await outsider((q) => q('select count(*)::int n from catalogue_duplicate_dismissals'))).toEqual([{ n: 0 }])
  })
})

describe('bulk category', () => {
  it('a manager sets a standard category on many items; other businesses\' items and archived items are untouched', async () => {
    const n = await manager((q) => q(`select set_master_category($1, $2::uuid[], 'analgesics') n`, [A, [M.pan1, M.theirs]]))
    expect(n[0].n).toBe(1)
    expect((await one('select category_code, category from master_products where id = $1', [M.pan1]))).toEqual({ category_code: 'analgesics', category: 'Medicines' })
    expect((await one('select category_code from master_products where id = $1', [M.theirs])).category_code).toBe('analgesics')
  })

  it('with no code, a linked item takes its library category; unlinked items stay as they are', async () => {
    await db.query(`update master_products set category_code = 'medicines_other' where id = $1`, [M.amox])
    const n = await owner((q) => q('select set_master_category($1, $2::uuid[]) n', [A, [M.amox, M.amoxCaps]]))
    expect(n[0].n).toBe(1)
    expect((await one('select category_code from master_products where id = $1', [M.amox])).category_code).toBe('antibiotics')
    expect((await one('select category_code from master_products where id = $1', [M.amoxCaps])).category_code).toBe(null)
  })

  it('refuses a cashier, an unknown category and more than 500 items', async () => {
    await expect(cashier((q) => q(`select set_master_category($1, $2::uuid[], 'analgesics')`, [A, [M.pan1]]))).rejects.toThrow(/owner or a manager/)
    await expect(owner((q) => q(`select set_master_category($1, $2::uuid[], 'nonsense')`, [A, [M.pan1]]))).rejects.toThrow(/does not exist/)
    const many = Array.from({ length: 501 }, () => M.pan1)
    await expect(owner((q) => q(`select set_master_category($1, $2::uuid[], 'analgesics')`, [A, many]))).rejects.toThrow(/500/)
    expect((await owner((q) => q(`select set_master_category($1, '{}'::uuid[], 'analgesics') n`, [A])))[0].n).toBe(0)
  })
})

describe('merging two catalogue items', () => {
  it('only the owner merges; a manager, a cashier and an outsider are refused', async () => {
    for (const who of [manager, cashier, outsider]) {
      await expect(who((q) => q('select merge_master_items($1, $2, $3)', [A, M.pan1, M.pan2]))).rejects.toThrow(/Only the business owner/)
    }
    await expect(owner((q) => q('select merge_master_items($1, $2, $2)', [A, M.pan1]))).rejects.toThrow(/two different/)
    await expect(owner((q) => q('select merge_master_items($1, $2, $3)', [A, M.pan1, M.theirs]))).rejects.toThrow(/current items/)
  })

  it('moves stock and batches where both are carried, stops the dropped product without deleting it, and relinks where only it is carried', async () => {
    const r = (await owner((q) => q('select merge_master_items($1, $2, $3) r', [A, M.pan1, M.pan2])))[0].r
    expect(r).toMatchObject({ kept: M.pan1, archived: M.pan2, relinked: 1, merged_locations: 1, units_moved: 3, negative_left: 0 })

    // At the main shop: 3 units moved, through the ledger, a movement on each side.
    expect((await one('select stock from products where id = $1', [P.pan1A])).stock).toBe(8)
    const dropped = await one('select stock, list_on_carefind, master_product_id from products where id = $1', [P.pan2A])
    expect(dropped).toEqual({ stock: 0, list_on_carefind: false, master_product_id: M.pan2 })
    const moves = await rows(`select product_id, quantity, movement_type, source_type from stock_movements where source_type = 'catalogue_merge' order by quantity`)
    expect(moves).toEqual([
      { product_id: P.pan2A, quantity: -3, movement_type: 'correction', source_type: 'catalogue_merge' },
      { product_id: P.pan1A, quantity: 3, movement_type: 'correction', source_type: 'catalogue_merge' },
    ])
    expect(await one(`select product_id, product_name, quantity from stock_batches where batch_number = 'PX-1'`)).toEqual({ product_id: P.pan1A, product_name: 'Panadol Extra', quantity: 3 })
    expect(await one('select active from branch_products where branch_id = $1 and master_product_id = $2', [A, M.pan2])).toEqual({ active: false })
    expect(await one('select active from branch_products where branch_id = $1 and master_product_id = $2', [A, M.pan1])).toEqual({ active: true })

    // At Ikeja only the dropped item was carried (stopped): the product now belongs to the kept item, stays stopped and keeps its price.
    expect(await one('select master_product_id, name, price::int, stock from products where id = $1', [P.pan2A1]))
      .toEqual({ master_product_id: M.pan1, name: 'Panadol Extra', price: 450, stock: 2 })
    expect(await one('select active, override_price from branch_products where branch_id = $1 and master_product_id = $2', [A1, M.pan1])).toEqual({ active: false, override_price: 450 })
    expect(await one('select count(*)::int n from branch_products where branch_id = $1 and master_product_id = $2', [A1, M.pan2])).toEqual({ n: 0 })
  })

  it('the kept item fills its empty details, keeps the stricter status, and its products follow; the dropped item is archived', async () => {
    const kept = await one('select generic_name, barcode, default_price, category_code, rx_status, archived_at from master_products where id = $1', [M.pan1])
    expect(kept).toMatchObject({ generic_name: 'Paracetamol', barcode: '6001', default_price: 400, category_code: 'analgesics', rx_status: 'pharmacy_only', archived_at: null })
    expect((await one('select archived_at from master_products where id = $1', [M.pan2])).archived_at).not.toBe(null)
    const products = await rows('select rx_status, generic_name from products where master_product_id = $1', [M.pan1])
    expect(products).toEqual([{ rx_status: 'pharmacy_only', generic_name: 'Paracetamol' }, { rx_status: 'pharmacy_only', generic_name: 'Paracetamol' }])
    expect((await pairsOf()).map(pairKey)).not.toContain(pairOf(M.pan1, M.pan2))
    await expect(owner((q) => q('select merge_master_items($1, $2, $3)', [A, M.pan1, M.pan2]))).rejects.toThrow(/current items/)
  })

  it('stock below zero is not moved: it stays on the stopped product and is counted; the library link and stricter status carry over', async () => {
    // Keep the unlinked one, drop the linked prescription-only one (stock 4 moves into a product at -1).
    const r = (await owner((q) => q('select merge_master_items($1, $2, $3) r', [A, M.amoxCaps, M.amox])))[0].r
    expect(r).toMatchObject({ merged_locations: 1, units_moved: 4, negative_left: 0 })
    expect((await one('select stock from products where id = $1', [P.amoxCapsA])).stock).toBe(3)
    const kept = await one('select catalog_item_id, rx_status, generic_name from master_products where id = $1', [M.amoxCaps])
    expect(kept).toEqual({ catalog_item_id: LIB, rx_status: 'prescription_only', generic_name: 'Amoxicillin' })
    expect((await one('select rx_status from products where id = $1', [P.amoxCapsA])).rx_status).toBe('prescription_only')

    // A dropped product below zero.
    await db.exec(`insert into master_products (id, business_id, name, default_price) values ('c0000000-0000-4000-8000-0000000000f1', '${A}', 'Oversold', 100);
      insert into products (id, business_id, name, price, stock, master_product_id) values ('e0000000-0000-4000-8000-0000000000f1', '${A}', 'Oversold', 100, 0, 'c0000000-0000-4000-8000-0000000000f1');
      update products set stock = -2 where id = 'e0000000-0000-4000-8000-0000000000f1';`)
    const r2 = (await owner((q) => q(`select merge_master_items($1, $2, 'c0000000-0000-4000-8000-0000000000f1') r`, [A, M.amoxCaps])))[0].r
    expect(r2).toMatchObject({ units_moved: 0, negative_left: 1 })
    expect((await one(`select stock from products where id = 'e0000000-0000-4000-8000-0000000000f1'`)).stock).toBe(-2)
    expect((await one('select stock from products where id = $1', [P.amoxCapsA])).stock).toBe(3)
  })

  it('refuses batch-tracked products and a service against a stocked product at the same location, changing nothing', async () => {
    await db.exec(`insert into master_products (id, business_id, name, default_price, category) values
        ('c0000000-0000-4000-8000-0000000000f2', '${A}', 'Tracked One', 100, ''), ('c0000000-0000-4000-8000-0000000000f3', '${A}', 'Tracked Two', 100, '');
      insert into products (business_id, name, price, stock, master_product_id, tracking_mode) values
        ('${A}', 'Tracked One', 100, 0, 'c0000000-0000-4000-8000-0000000000f2', 'batch'), ('${A}', 'Tracked Two', 100, 0, 'c0000000-0000-4000-8000-0000000000f3', 'none');
      insert into products (business_id, name, price, stock, master_product_id, category) values ('${A}', 'Consultation', 0, 0, '${M.consult}', 'Services');`)
    await expect(owner((q) => q(`select merge_master_items($1, 'c0000000-0000-4000-8000-0000000000f3', 'c0000000-0000-4000-8000-0000000000f2')`, [A]))).rejects.toThrow(/batch/)
    await expect(owner((q) => q(`select merge_master_items($1, $2, 'c0000000-0000-4000-8000-0000000000f3')`, [A, M.consult]))).rejects.toThrow(/service/)
    expect((await one(`select archived_at from master_products where id = 'c0000000-0000-4000-8000-0000000000f2'`)).archived_at).toBe(null)
  })
})

describe('CareFind hides items with no price', () => {
  it('carefind_products leaves out unpriced items but keeps prescription-only ones as "ask the pharmacist"', async () => {
    await db.query(`update products set list_on_carefind = true, price = 0 where id = $1`, [P.pan2A])
    const names = await anon((q) => q('select name, price, rx_restricted from carefind_products order by name'))
    expect(names.map((r) => r.name)).not.toContain('Panadol-Extra')
    expect(names.find((r) => r.name === 'Tramadol')).toMatchObject({ price: null, rx_restricted: true })
    expect(names.find((r) => r.name === 'Panadol Extra')).toBeTruthy()
  })

  it('the public cannot read an unpriced product directly; its business still can', async () => {
    expect(await anon((q) => q('select id from products where id = $1', [P.pan2A]))).toEqual([])
    expect(await owner((q) => q('select id from products where id = $1', [P.pan2A]))).toEqual([{ id: P.pan2A }])
    await db.query(`update products set price = 350 where id = $1`, [P.pan2A])
    expect(await anon((q) => q('select id from carefind_products where id = $1', [P.pan2A]))).toEqual([{ id: P.pan2A }])
  })
})

describe('re-running the migration', () => {
  it('changes nothing and keeps dismissals', async () => {
    const before = await one('select count(*)::int n from catalogue_duplicate_dismissals')
    await db.exec(HEALTH)
    await db.exec(SPEED)
    expect(await one('select count(*)::int n from catalogue_duplicate_dismissals')).toEqual(before)
    expect((await owner((q) => q('select catalogue_health($1) h', [A])))[0].h.total).toBeGreaterThan(0)
  })
})
