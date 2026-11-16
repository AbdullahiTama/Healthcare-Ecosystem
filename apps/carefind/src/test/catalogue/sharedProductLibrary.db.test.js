// @vitest-environment node
// Product catalogue phase 4 (carehub_20261223_shared_product_library), on PGlite with the live shapes of businesses,
// staff, products, master_products, branch_products and staff_notifications, the live current_business_ids(),
// is_platform_admin() and is_business_manager(), and carehub_20261215 (catalogue foundation) applied first.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const read = (f) => readFileSync(fileURLToPath(new URL(`../../../../../supabase/migrations/${f}`, import.meta.url)), 'utf8')
const FOUNDATION = read('carehub_20261215_catalogue_foundation.sql')
const MIGRATION = read('carehub_20261223_shared_product_library.sql')

const A = 'a0000000-0000-4000-8000-000000000001'   // Allen Pharmacy (main)
const A1 = 'a0000000-0000-4000-8000-000000000011'  // its Ikeja branch
const B = 'b0000000-0000-4000-8000-000000000001'
const C = 'c0000000-0000-4000-8000-000000000001'
const ADMIN = 'd0000000-0000-4000-8000-000000000001'
let db

async function as(email, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: '10000000-0000-4000-8000-000000000001', email, role: 'authenticated' })])
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
const lib = (key) => one('select * from catalog_items where match_key = $1 and status <> $2', [key, 'retired'])
const master = (business, key) => one('select * from master_products where business_id = $1 and name_key = $2 and archived_at is null', [business, key])
const admin = (fn) => as('admin@carehub.ng', fn)
const owner = (fn) => as('owner@allen.com', fn)

beforeAll(async () => {
  db = new PGlite()
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
    create table products (id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id) on delete cascade,
      name text not null, generic_name text, category text, price numeric default 0, stock integer default 0, emoji text default '📦',
      list_on_carefind boolean default true, created_at timestamp default now(), cost_price numeric default 0, barcode text,
      reorder_level integer default 5, sale_type text, show_price boolean default true not null);
    create table master_products (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id),
      name text not null, description text default '', category text default '', default_price integer default 0 not null,
      created_at timestamptz default now() not null, updated_at timestamptz default now() not null);
    create table branch_products (id uuid primary key default gen_random_uuid(), branch_id uuid not null references businesses(id),
      master_product_id uuid not null references master_products(id), active boolean default true not null, override_price integer,
      created_at timestamptz default now() not null, unique (branch_id, master_product_id));
    create table staff_notifications (id uuid primary key default gen_random_uuid(), business_id uuid, staff_id uuid, is_owner boolean,
      kind text not null, title text not null, body text, link text, read_at timestamptz, created_at timestamptz default now());
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
    create function is_business_manager(bid uuid) returns boolean language sql stable security definer set search_path = public as $$
      with recursive ancestry as (
        select b.id, b.parent_business_id, b.email, 0 as depth from businesses b where b.id = bid
        union all select p.id, p.parent_business_id, p.email, a.depth + 1 from businesses p join ancestry a on p.id = a.parent_business_id where a.depth < 10)
      select (bid in (select current_business_ids()) and (exists (select 1 from ancestry a where lower(a.email) = lower(auth.email()))
        or exists (select 1 from staff s where s.business_id = bid and lower(s.email) = lower(auth.email()) and s.status = 'active' and s.role ~* 'manager')))
        or public.is_platform_admin() $$;
    create function deactivate_branch_product(p_branch_id uuid, p_master_product_id uuid) returns boolean language plpgsql set search_path = public as $$
      begin update branch_products set active = false where branch_id = p_branch_id and master_product_id = p_master_product_id; return found; end $$;
    do $$ declare t text; begin foreach t in array array['businesses','staff','products','master_products','branch_products','staff_notifications'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
      execute format('grant all on %I to service_role', t);
    end loop; end $$;
    create policy "own business" on businesses for all to authenticated using (id in (select current_business_ids()) or is_platform_admin()) with check (true);
    create policy "own products" on products for all to authenticated using (business_id in (select current_business_ids())) with check (business_id in (select current_business_ids()));
    create policy "own notifications" on staff_notifications for select to authenticated using (business_id in (select current_business_ids()));
    -- live policies
    create policy "master_products tenant visibility" on master_products for all using (business_id in (select current_business_ids()) or is_platform_admin());
    create policy "master_products owner insert" on master_products for insert with check (business_id in (select current_business_ids()) or is_platform_admin());
    create policy "master_products owner update" on master_products for update using (business_id in (select current_business_ids()) or is_platform_admin())
      with check (business_id in (select current_business_ids()) or is_platform_admin());
    create policy "branch_products tenant visibility" on branch_products for all using (branch_id in (select current_business_ids()) or is_platform_admin());

    insert into businesses (id, name, email, is_platform_admin) values ('${A}', 'Allen Pharmacy', 'owner@allen.com', false),
      ('${B}', 'Bello Chemist', 'owner@bello.com', false), ('${C}', 'Chi Stores', 'owner@chi.com', false), ('${ADMIN}', 'CareHub', 'admin@carehub.ng', true);
    insert into businesses (id, name, email, parent_business_id) values ('${A1}', 'Allen · Ikeja', 'ikeja@allen.com', '${A}');
    insert into staff (business_id, email, role) values ('${A1}', 'tunde@allen.com', 'Cashier'), ('${A}', 'kemi@allen.com', 'Store Manager');
    insert into products (business_id, name, generic_name, category, price, barcode, stock) values
      ('${A}',  'Amoxil 500 mg',   'Amoxicillin', 'Antibiotics', 1200, '5012345', 5),
      ('${A1}', 'Amoxil 500 mg',   null,          'Antibiotics', 1250, null,      3),
      ('${B}',  'AMOXIL 500mg',    'Amoxicillin', 'Antibiotics', 1100, '5012345', 2),
      ('${A}',  'Panadol Extra',   null,          'Analgesics',  400,  '6009999', 9),
      ('${B}',  'Panadol Extra',   null,          'Medicines',   380,  null,      4),
      ('${C}',  'panadol extra',   'Paracetamol', 'Medicines',   420,  '6009999', 6),
      ('${A}',  'Cough Syrup X',   null,          'Cough and cold', 900, null,    1),
      ('${B}',  'Cough Syrup X',   null,          'Antibiotics', 900,  null,      1),
      ('${A}',  'Allen House Tea', null,          'Drinks',      300,  null,      8),
      ('${A}',  'Scanned Thing',   null,          'Medicines',   100,  '7770001', 1);
  `)
  await db.exec(FOUNDATION)
  await db.exec(MIGRATION)
})

describe('matching key and seeding', () => {
  it('normalises case, spaces and a number with its unit', async () => {
    const r = await one(`select catalog_key('  AMOXIL   500 mg ') a, catalog_key('Amoxil 500mg') b, catalog_key('Cream 1 %') c, catalog_key('Take 2 tablets') d, catalog_key('  ') e`)
    expect(r).toEqual({ a: 'amoxil 500mg', b: 'amoxil 500mg', c: 'cream 1%', d: 'take 2 tablets', e: null })
  })

  it('seeds pending items for names used by two or more businesses, with the most common details', async () => {
    const amox = await lib('amoxil 500mg')
    expect(amox).toMatchObject({ status: 'pending', source: 'seeded', business_count: 2, generic_name: 'Amoxicillin',
      category_code: 'antibiotics', rx_status: 'prescription_only', barcodes: ['5012345'] })
    const panadol = await lib('panadol extra')
    expect(panadol).toMatchObject({ brand_name: 'Panadol Extra', business_count: 3, generic_name: 'Paracetamol', barcodes: ['6009999'] })
    expect(await lib('allen house tea')).toBeUndefined()
    expect(await lib('scanned thing')).toBeUndefined()
  })

  it('a tie in prescription status goes to the stricter one', async () => {
    expect((await lib('cough syrup x')).rx_status).toBe('prescription_only')
  })

  it('seeding again adds nothing, and a retired name is never seeded again', async () => {
    const n = await admin((q) => q('select admin_seed_catalog_candidates(2) n'))
    expect(n[0].n).toBe(0)
    const id = (await lib('cough syrup x')).id
    await admin((q) => q(`select admin_review_catalog_items(array[$1]::uuid[], 'retire', 'Not a real product') n`, [id]))
    expect((await admin((q) => q('select admin_seed_catalog_candidates(2) n')))[0].n).toBe(0)
    expect(await lib('cough syrup x')).toBeUndefined()
  })
})

describe('access', () => {
  it('the public and businesses see approved items only; admins see everything', async () => {
    const total = Number((await one('select count(*) n from catalog_items')).n)
    expect(await anon((q) => q('select * from catalog_items'))).toHaveLength(0)
    expect(await owner((q) => q('select * from catalog_items'))).toHaveLength(0)
    expect(await admin((q) => q('select * from catalog_items'))).toHaveLength(total)
  })

  it('nobody writes the tables directly, admins included', async () => {
    await expect(admin((q) => q(`insert into catalog_items (brand_name, source) values ('X', 'admin')`))).rejects.toThrow(/permission denied/)
    await expect(owner((q) => q(`update catalog_items set status = 'active'`))).rejects.toThrow(/permission denied/)
    await expect(owner((q) => q(`insert into catalog_suggestions (business_id, brand_name) values ($1, 'X')`, [A]))).rejects.toThrow(/permission denied/)
  })

  it('admin functions refuse anyone else', async () => {
    const id = (await lib('panadol extra')).id
    for (const sql of [`select admin_review_catalog_items(array['${id}']::uuid[], 'approve')`, `select * from admin_catalog_page()`,
      `select admin_save_catalog_item(null, '{"brand_name":"X"}')`, `select admin_import_catalog_items('[]')`, `select admin_seed_catalog_candidates(2)`,
      `select * from admin_catalog_suggestions()`]) {
      await expect(owner((q) => q(sql))).rejects.toThrow(/Only CareHub admins/)
    }
    expect((await lib('panadol extra')).status).toBe('pending')
  })
})

describe('admin review', () => {
  it('pages the queue, most widely used first, with search', async () => {
    const page = await admin((q) => q(`select * from admin_catalog_page('pending', null, null, 0, 50)`))
    expect(page[0].item).toMatchObject({ brand_name: 'Panadol Extra', business_count: 3, status: 'pending', source: 'seeded' })
    expect(Number(page[0].total)).toBe(page.length)
    const found = await admin((q) => q(`select * from admin_catalog_page('pending', null, 'amoxil 500 MG', 0, 50)`))
    expect(found.map((r) => r.item.brand_name)).toEqual(['Amoxil 500 mg'])
  })

  it('approves in bulk; approved items become public and searchable by name, generic name or barcode', async () => {
    const ids = [(await lib('panadol extra')).id, (await lib('amoxil 500mg')).id]
    const n = await admin((q) => q(`select admin_review_catalog_items($1::uuid[], 'approve') n`, [ids]))
    expect(n[0].n).toBe(2)
    expect(await lib('panadol extra')).toMatchObject({ status: 'active', verified_at: expect.any(Date) })
    expect(await anon((q) => q('select brand_name from catalog_items order by 1'))).toEqual([{ brand_name: 'Amoxil 500 mg' }, { brand_name: 'Panadol Extra' }])
    const byName = await owner((q) => q(`select item from catalog_search('panad')`))
    expect(byName.map((r) => r.item.brand_name)).toEqual(['Panadol Extra'])
    expect(byName[0].item).not.toHaveProperty('verified_by')
    expect((await owner((q) => q(`select item from catalog_search('amoxicillin')`)))[0].item.brand_name).toBe('Amoxil 500 mg')
    expect((await anon((q) => q(`select item from catalog_search('5012345')`)))[0].item.brand_name).toBe('Amoxil 500 mg')
    expect(await owner((q) => q(`select item from catalog_search('x')`))).toHaveLength(0)
  })

  it('saves a new item and refuses a duplicate name and strength', async () => {
    const r = await admin((q) => q(`select admin_save_catalog_item(null, $1::jsonb) r`,
      [JSON.stringify({ brand_name: 'Ventolin', strength: '100 mcg', dose_form: 'Inhaler', category_code: 'respiratory', barcodes: '111222, 333444 x' })]))
    expect(r[0].r).toMatchObject({ brand_name: 'Ventolin', strength: '100 mcg', status: 'active', source: 'admin', barcodes: ['111222', '333444'] })
    expect((await lib('ventolin 100mcg')).rx_status).toBe('prescription_only')
    await expect(admin((q) => q(`select admin_save_catalog_item(null, '{"brand_name":"VENTOLIN 100mcg"}')`))).rejects.toThrow(/already has this name and strength/)
    await expect(admin((q) => q(`select admin_save_catalog_item(null, '{"brand_name":"X","category_code":"nope"}')`))).rejects.toThrow(/Choose a category/)
    await expect(admin((q) => q(`select admin_save_catalog_item(null, '{"brand_name":"  "}')`))).rejects.toThrow(/Enter the product name/)
  })

  it('reopens a retired item into the queue', async () => {
    const retired = await one(`select id from catalog_items where match_key = 'cough syrup x'`)
    expect((await admin((q) => q(`select admin_review_catalog_items(array[$1]::uuid[], 'reopen') n`, [retired.id])))[0].n).toBe(1)
    expect((await lib('cough syrup x')).status).toBe('pending')
  })
})

describe('business links', () => {
  it('lists library matches for unlinked items: by barcode first, then by name', async () => {
    const m = await owner((q) => q(`select * from catalog_link_matches($1, 0, 50)`, [A]))
    expect(m.map((r) => [r.master.name, r.library.brand_name, r.match_by])).toEqual([
      ['Amoxil 500 mg', 'Amoxil 500 mg', 'barcode'], ['Panadol Extra', 'Panadol Extra', 'barcode']])
    expect(Number(m[0].total)).toBe(2)
    expect(await as('owner@bello.com', (q) => q(`select * from catalog_link_matches($1, 0, 50)`, [A]))).toHaveLength(0)
  })

  it('a cashier cannot link; the owner links, empty fields fill in and location products follow', async () => {
    const amox = await master(A, 'amoxil 500 mg')
    const libAmox = await lib('amoxil 500mg')
    const links = JSON.stringify([{ master_product_id: amox.id, catalog_item_id: libAmox.id }])
    await expect(as('tunde@allen.com', (q) => q('select link_master_to_catalog($1, $2::jsonb)', [A, links]))).rejects.toThrow(/owner or a manager/)
    await expect(as('tunde@allen.com', (q) => q('select link_master_to_catalog($1, $2::jsonb)', [A1, links]))).rejects.toThrow(/owner or a manager/)
    await db.query(`update products set rx_status = 'otc', generic_name = null where business_id = $1 and master_product_id = $2`, [A1, amox.id])
    expect((await owner((q) => q('select link_master_to_catalog($1, $2::jsonb) n', [A, links])))[0].n).toBe(1)
    expect(await master(A, 'amoxil 500 mg')).toMatchObject({ catalog_item_id: libAmox.id, generic_name: 'Amoxicillin', rx_status: 'prescription_only' })
    expect(await one('select rx_status, generic_name from products where business_id = $1 and master_product_id = $2', [A1, amox.id]))
      .toEqual({ rx_status: 'prescription_only', generic_name: 'Amoxicillin' })
  })

  it('a manager can link; another business\'s item and a pending library item are not linked', async () => {
    const panadol = await master(A, 'panadol extra')
    const theirs = await master(B, 'panadol extra')
    const pending = await lib('cough syrup x')
    const libPanadol = (await lib('panadol extra')).id
    const cough = (await master(A, 'cough syrup x')).id
    const r = await as('kemi@allen.com', (q) => q('select link_master_to_catalog($1, $2::jsonb) n', [A, JSON.stringify([
      { master_product_id: panadol.id, catalog_item_id: libPanadol },
      { master_product_id: theirs.id, catalog_item_id: libPanadol }])]))
    expect(r[0].n).toBe(1)
    expect((await master(B, 'panadol extra')).catalog_item_id).toBeNull()
    await expect(owner((q) => q('select link_master_to_catalog($1, $2::jsonb)', [A,
      JSON.stringify([{ master_product_id: cough, catalog_item_id: pending.id }])]))).rejects.toThrow(/not available/)
    await expect(owner((q) => q('update master_products set catalog_item_id = $1 where id = $2', [pending.id, cough])))
      .rejects.toThrow(/not available/)
  })

  it('a linked item cannot be looser than the library; unlinking keeps its details', async () => {
    const amox = await master(A, 'amoxil 500 mg')
    await owner((q) => q(`update master_products set rx_status = 'otc' where id = $1`, [amox.id]))
    expect((await master(A, 'amoxil 500 mg')).rx_status).toBe('prescription_only')
    expect((await owner((q) => q('select unlink_master_from_catalog($1, $2) ok', [A, amox.id])))[0].ok).toBe(true)
    expect(await master(A, 'amoxil 500 mg')).toMatchObject({ catalog_item_id: null, generic_name: 'Amoxicillin', rx_status: 'prescription_only' })
    const libAmox = (await lib('amoxil 500mg')).id
    await owner((q) => q('select link_master_to_catalog($1, $2::jsonb)', [A, JSON.stringify([{ master_product_id: amox.id, catalog_item_id: libAmox }])]))
  })

  it('a stricter library status reaches every linked item and its products; a looser one does not', async () => {
    const libPanadol = await lib('panadol extra')
    expect((await master(A, 'panadol extra')).rx_status).toBe('pharmacy_only')
    await admin((q) => q(`select admin_save_catalog_item($1, $2::jsonb)`, [libPanadol.id, JSON.stringify({ ...libPanadol, barcodes: libPanadol.barcodes, rx_status: 'prescription_only' })]))
    expect((await master(A, 'panadol extra')).rx_status).toBe('prescription_only')
    expect((await one('select rx_status from products where business_id = $1 and name = $2', [A, 'Panadol Extra'])).rx_status).toBe('prescription_only')
    expect((await master(C, 'panadol extra')).rx_status).toBe('pharmacy_only')
    await admin((q) => q(`select admin_save_catalog_item($1, $2::jsonb)`, [libPanadol.id, JSON.stringify({ ...libPanadol, rx_status: 'otc' })]))
    expect((await master(A, 'panadol extra')).rx_status).toBe('prescription_only')
  })

  it('a new item can be added straight from the library', async () => {
    const ventolin = await lib('ventolin 100mcg')
    await owner((q) => q(`insert into master_products (business_id, name, default_price, catalog_item_id) values ($1, 'Ventolin Inhaler', 2500, $2)`, [A, ventolin.id]))
    expect(await master(A, 'ventolin inhaler')).toMatchObject({ strength: '100 mcg', dose_form: 'Inhaler', barcode: '111222', category_code: 'respiratory', rx_status: 'prescription_only' })
  })

  it('the catalogue page shows the library entry and filters linked or unlinked items', async () => {
    const linked = await owner((q) => q(`select * from master_catalog_page($1, null, null, false, 0, 50, null, 'linked')`, [A]))
    expect(linked.map((r) => r.item.name).sort()).toEqual(['Amoxil 500 mg', 'Panadol Extra', 'Ventolin Inhaler'])
    expect(linked.find((r) => r.item.name === 'Amoxil 500 mg').item.library).toMatchObject({ brand_name: 'Amoxil 500 mg', rx_status: 'prescription_only' })
    const unlinked = await owner((q) => q(`select * from master_catalog_page($1, null, null, false, 0, 50, null, 'unlinked')`, [A]))
    expect(unlinked.map((r) => r.item.name)).not.toContain('Amoxil 500 mg')
    expect(unlinked.every((r) => r.item.library === null)).toBe(true)
    const all = await owner((q) => q(`select * from master_catalog_page(p_business_id => $1)`, [A]))
    expect(all.length).toBe(linked.length + unlinked.length)
  })
})

describe('suggestions', () => {
  it('the owner suggests an unlinked item once; linked items and other businesses are refused', async () => {
    const tea = await master(A, 'allen house tea')
    const id = await owner((q) => q(`select suggest_catalog_item($1, $2, 'Our own blend') id`, [A, tea.id]))
    expect(await one('select * from catalog_suggestions where id = $1', [id[0].id]))
      .toMatchObject({ business_id: A, brand_name: 'Allen House Tea', status: 'pending', note: 'Our own blend', suggested_by_email: 'owner@allen.com' })
    await expect(owner((q) => q('select suggest_catalog_item($1, $2)', [A, tea.id]))).rejects.toThrow(/already been suggested/)
    const amox = (await master(A, 'amoxil 500 mg')).id
    await expect(owner((q) => q('select suggest_catalog_item($1, $2)', [A, amox]))).rejects.toThrow(/already linked/)
    await expect(as('owner@bello.com', (q) => q('select suggest_catalog_item($1, $2)', [A, tea.id]))).rejects.toThrow(/owner or a manager/)
    expect(await owner((q) => q('select brand_name from catalog_suggestions'))).toHaveLength(1)
    expect(await as('owner@bello.com', (q) => q('select brand_name from catalog_suggestions'))).toHaveLength(0)
  })

  it('an admin adds a suggestion to the library: the item is linked and the owner told', async () => {
    const s = (await admin((q) => q(`select * from admin_catalog_suggestions('pending')`)))[0]
    expect(s).toMatchObject({ business_name: 'Allen Pharmacy', existing: null })
    const itemId = (await admin((q) => q(`select admin_decide_catalog_suggestion($1, 'create', null, $2::jsonb) id`,
      [s.suggestion.id, JSON.stringify({ brand_name: 'Allen House Tea', category_code: 'food_drinks', rx_status: 'otc' })])))[0].id
    expect(await one('select status, source from catalog_items where id = $1', [itemId])).toEqual({ status: 'active', source: 'suggested' })
    expect((await master(A, 'allen house tea')).catalog_item_id).toBe(itemId)
    expect(await one('select status, catalog_item_id from catalog_suggestions where id = $1', [s.suggestion.id])).toEqual({ status: 'approved', catalog_item_id: itemId })
    expect(await owner((q) => q(`select kind, title, link from staff_notifications where kind like 'catalog%'`)))
      .toEqual([{ kind: 'catalog_suggestion_approved', title: 'Added to the CareHub library', link: '/dashboard/mastercatalog' }])
    await expect(admin((q) => q(`select admin_decide_catalog_suggestion($1, 'reject')`, [s.suggestion.id]))).rejects.toThrow(/already been decided/)
  })

  it('links a suggestion to an existing item, or rejects it with a reason', async () => {
    const scanned = await master(A, 'scanned thing')
    const cough = await master(A, 'cough syrup x')
    await owner((q) => q('select suggest_catalog_item($1, $2)', [A, scanned.id]))
    await owner((q) => q('select suggest_catalog_item($1, $2)', [A, cough.id]))
    const list = await admin((q) => q(`select * from admin_catalog_suggestions('pending')`))
    const sCough = list.find((r) => r.suggestion.brand_name === 'Cough Syrup X')
    expect(sCough.existing).toMatchObject({ brand_name: 'Cough Syrup X', status: 'pending' })
    const sScan = list.find((r) => r.suggestion.brand_name === 'Scanned Thing')
    await expect(admin((q) => q(`select admin_decide_catalog_suggestion($1, 'link', $2)`, [sScan.suggestion.id, sCough.existing.id]))).rejects.toThrow(/approved library item/)
    const libPanadol = (await lib('panadol extra')).id
    await admin((q) => q(`select admin_decide_catalog_suggestion($1, 'link', $2)`, [sScan.suggestion.id, libPanadol]))
    expect((await master(A, 'scanned thing')).catalog_item_id).toBe((await lib('panadol extra')).id)
    await admin((q) => q(`select admin_decide_catalog_suggestion($1, 'reject', null, null, 'Please add the strength')`, [sCough.suggestion.id]))
    expect(await owner((q) => q(`select body from staff_notifications where kind = 'catalog_suggestion_rejected'`)))
      .toEqual([{ body: 'Cough Syrup X was not added: Please add the strength' }])
    const page = await owner((q) => q(`select * from master_catalog_page($1, 'cough syrup')`, [A]))
    expect(page[0].item.suggestion).toMatchObject({ status: 'rejected', review_note: 'Please add the strength' })
  })

  it('linking an item withdraws its pending suggestion', async () => {
    await db.query(`insert into master_products (business_id, name, default_price) values ($1, 'Panadol Extra Caplets', 100)`, [B])
    const m = await master(B, 'panadol extra')
    await as('owner@bello.com', (q) => q('select suggest_catalog_item($1, $2)', [B, m.id]))
    const libPanadol = (await lib('panadol extra')).id
    await as('owner@bello.com', (q) => q('select link_master_to_catalog($1, $2::jsonb)', [B, JSON.stringify([{ master_product_id: m.id, catalog_item_id: libPanadol }])]))
    expect((await one('select status from catalog_suggestions where master_product_id = $1', [m.id])).status).toBe('withdrawn')
  })
})

describe('official list import', () => {
  it('adds new items, fills in and approves matches, raises the prescription status, and reports problems', async () => {
    const before = await lib('cough syrup x')
    const res = await admin((q) => q('select admin_import_catalog_items($1::jsonb) r', [JSON.stringify([
      { brand_name: 'Coartem', strength: '20/120 mg', dose_form: 'Tablet', manufacturer: 'Novartis', nafdac_no: 'a4-1234', category: 'Antimalarials', rx_status: 'POM', barcodes: ['8880001'] },
      { brand_name: 'cough  syrup x', nafdac_no: 'B1-9', manufacturer: 'Emzor', rx_status: 'controlled' },
      { brand_name: 'Coartem 20/120mg tabs', nafdac_no: 'A4 1234', pack_size: '24' },
      { brand_name: '   ', nafdac_no: 'Z' },
      { brand_name: 'Something', nafdac_no: 'B1-9' },
    ])]))
    expect(res[0].r).toEqual({ inserted: 1, updated: 3, skipped: 1, errors: [{ row: 3, reason: 'No product name' }] })
    expect(await lib('coartem 20/120mg')).toMatchObject({ source: 'nafdac_import', status: 'active', nafdac_no: 'A4-1234', manufacturer: 'Novartis',
      rx_status: 'prescription_only', category_code: 'antimalarials', pack_size: '24', barcodes: ['8880001'] })
    expect(await lib('cough syrup x')).toMatchObject({ id: before.id, status: 'active', nafdac_no: 'B1-9', manufacturer: 'Emzor', rx_status: 'controlled', brand_name: 'Cough Syrup X' })
    await expect(admin((q) => q(`select admin_import_catalog_items((select jsonb_agg('{}'::jsonb) from generate_series(1, 1001)))`))).rejects.toThrow(/up to 1000/)
  })
})

describe('merge', () => {
  it('moves links and barcodes to the kept item and retires the other', async () => {
    const dup = (await admin((q) => q(`select admin_save_catalog_item(null, '{"brand_name":"Panadol Xtra","barcodes":["6009998"],"manufacturer":"GSK"}') r`)))[0].r
    const cough = (await master(A, 'cough syrup x')).id
    await owner((q) => q('select link_master_to_catalog($1, $2::jsonb)', [A, JSON.stringify([{ master_product_id: cough, catalog_item_id: dup.id }])]))
    const keep = await lib('panadol extra')
    await expect(admin((q) => q('select admin_merge_catalog_items($1, $1)', [keep.id]))).rejects.toThrow(/two different/)
    const moved = await admin((q) => q('select admin_merge_catalog_items($1, $2) n', [keep.id, dup.id]))
    expect(moved[0].n).toBe(1)
    expect((await master(A, 'cough syrup x')).catalog_item_id).toBe(keep.id)
    expect(await one('select status, review_note from catalog_items where id = $1', [dup.id])).toEqual({ status: 'retired', review_note: 'Merged into Panadol Extra' })
    const kept = await lib('panadol extra')
    expect(kept.barcodes.sort()).toEqual(['6009998', '6009999'])
    expect(kept.manufacturer).toBe('GSK')
  })

  it('retiring an item removes its business links but keeps their details', async () => {
    const ventolin = await lib('ventolin 100mcg')
    await admin((q) => q(`select admin_review_catalog_items(array[$1]::uuid[], 'retire')`, [ventolin.id]))
    expect(await master(A, 'ventolin inhaler')).toMatchObject({ catalog_item_id: null, strength: '100 mcg', rx_status: 'prescription_only' })
    expect(await owner((q) => q(`select item from catalog_search('ventolin')`))).toHaveLength(0)
  })
})

describe('re-running', () => {
  it('applying the migration again is safe and adds no candidates', async () => {
    const before = await one('select count(*) n from catalog_items')
    await db.exec(MIGRATION)
    expect(await one('select count(*) n from catalog_items')).toEqual(before)
  })
})
