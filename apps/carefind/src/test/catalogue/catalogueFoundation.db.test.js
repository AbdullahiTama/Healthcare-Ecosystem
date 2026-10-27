// @vitest-environment node
// Product catalogue phase 1 (carehub_20261215_catalogue_foundation), on PGlite with the live shapes of businesses,
// staff, products, master_products and branch_products, their live RLS, and the live current_business_ids().
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20261215_catalogue_foundation.sql', import.meta.url)), 'utf8')

const A = 'a0000000-0000-4000-8000-000000000001'   // main business
const A1 = 'a0000000-0000-4000-8000-000000000011'  // its branch
const A2 = 'a0000000-0000-4000-8000-000000000012'  // a second branch, carrying nothing yet
const B = 'b0000000-0000-4000-8000-000000000001'   // another business
const OLD_MASTER = 'c0000000-0000-4000-8000-000000000001'
let db

async function as(email, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ email, role: 'authenticated' })])
  await db.query('set role authenticated')
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally {
    await db.query('reset role')
    await db.query(`select set_config('request.jwt.claims','',false)`)
  }
}
const rows = async (s, p) => (await db.query(s, p)).rows
const one = async (s, p) => (await rows(s, p))[0]
const masterOf = (business, key) => one('select * from master_products where business_id = $1 and name_key = $2 and archived_at is null', [business, key])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key default gen_random_uuid(), name text, email text, parent_business_id uuid,
      branch_depth_limit integer default 3, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, email text, status text default 'active');
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
    create function deactivate_branch_product(p_branch_id uuid, p_master_product_id uuid) returns boolean language plpgsql set search_path = public as $$
      begin update branch_products set active = false where branch_id = p_branch_id and master_product_id = p_master_product_id; return found; end $$;
    do $$ declare t text; begin foreach t in array array['businesses','staff','products','master_products','branch_products'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select, insert, update, delete on %I to authenticated', t);
      execute format('grant all on %I to service_role', t);
    end loop; end $$;
    create policy "own business" on businesses for all to authenticated using (id in (select current_business_ids())) with check (true);
    create policy "own products" on products for all to authenticated using (business_id in (select current_business_ids())) with check (business_id in (select current_business_ids()));
    -- live policies
    create policy "master_products tenant visibility" on master_products for all using (business_id in (select current_business_ids()) or is_platform_admin());
    create policy "master_products owner insert" on master_products for insert with check (business_id in (select current_business_ids()) or is_platform_admin());
    create policy "branch_products tenant visibility" on branch_products for all using (branch_id in (select current_business_ids()) or is_platform_admin());
    create policy "branch_products owner insert" on branch_products for insert with check (branch_id in (select current_business_ids()) or is_platform_admin());
  `)
  await db.exec(`
    insert into businesses (id, name, email) values ('${A}', 'Main', 'owner@a.com'), ('${B}', 'Other', 'owner@b.com');
    insert into businesses (id, name, email, parent_business_id) values ('${A1}', 'Branch 1', 'b1@a.com', '${A}'), ('${A2}', 'Branch 2', 'b2@a.com', '${A}');
    insert into staff (business_id, email) values ('${A1}', 'cashier@a.com');
    insert into master_products (id, business_id, name, category, default_price) values ('${OLD_MASTER}', '${A}', 'Paracetamol 500mg', 'Medicines', 500);
    insert into branch_products (branch_id, master_product_id, override_price) values ('${A}', '${OLD_MASTER}', 500);
    insert into products (business_id, name, generic_name, category, price, cost_price, barcode, stock) values
      ('${A}',  'Neurotex Forte',   'Vitamin B complex', 'ANAGELSIC', 500, 300, null,      10),
      ('${A1}', 'Neurotex Forte',   null,                'ANALGESIC', 500, 320, '6001234', 4),
      ('${A1}', ' NEUROTEX  FORTE', null,                'ANALGESIC', 600, 0,   null,      2),
      ('${A}',  'Amoxil 500',       'Amoxicillin',       'Antibiotics', 1200, 900, null,   5),
      ('${A}',  'Mystery Tonic',    null,                'weird new cat', 0, 0, null,      1),
      ('${A1}', 'paracetamol 500mg', null,               'Medicines', 450, 200, null,      7),
      ('${A}',  '   ',              null,                'Medicines', 100, 0, null,        0),
      ('${B}',  'Neurotex Forte',   null,                'Medicines', 800, 0, null,        3);
  `)
  await db.exec(MIGRATION)
})

describe('standard categories', () => {
  it('maps every spelling to a group, with prescription status; unknown text becomes "other medicines"', async () => {
    const r = await one(`select category_code_for('anagelsic') a, category_code_for(' Antibiotics ') b, category_code_for('PRESCRIPTION') c,
      rx_status_for('PRESCRIPTION') d, rx_status_for('antibiotics') e, category_code_for('weird') f, rx_status_for('weird') g,
      category_code_for('') h, category_code_for('vitamins') i, rx_status_for('ANTACID') j`)
    expect(r).toEqual({ a: 'analgesics', b: 'antibiotics', c: 'medicines_other', d: 'prescription_only', e: 'prescription_only',
      f: 'medicines_other', g: 'pharmacy_only', h: null, i: 'vitamins', j: 'otc' })
  })

  it('every alias points at a real group', async () => {
    expect((await one('select count(*)::int n from category_aliases a left join product_categories c using (code) where c.code is null')).n).toBe(0)
  })
})

describe('backfill', () => {
  it('creates one master item per normalised name in the main business, across its branches', async () => {
    const m = await masterOf(A, 'neurotex forte')
    expect(m).toMatchObject({ name: 'Neurotex Forte', default_price: 500, generic_name: 'Vitamin B complex', barcode: '6001234',
      category_code: 'analgesics', rx_status: 'otc' })
    expect(Number(m.default_cost)).toBe(300) // median of 300 and 320 (lower middle); a zero cost is ignored
    expect((await one(`select count(*)::int n from master_products where business_id = '${A1}'`)).n).toBe(0)
    // the other business gets its own item, never shared
    expect((await masterOf(B, 'neurotex forte')).default_price).toBe(800)
  })

  it('links every named product by id, and marks whether it sells at the master price', async () => {
    const m = await masterOf(A, 'neurotex forte')
    const linked = await rows(`select business_id, price::int, price_source, rx_status from products where master_product_id = $1 order by price, business_id`, [m.id])
    expect(linked).toEqual([
      { business_id: A, price: 500, price_source: 'master', rx_status: 'otc' },
      { business_id: A1, price: 500, price_source: 'master', rx_status: 'otc' },
      { business_id: A1, price: 600, price_source: 'branch', rx_status: 'otc' },
    ])
    expect((await one(`select count(*)::int n from products where master_product_id is null and btrim(name) <> ''`)).n).toBe(0)
    expect((await one(`select master_product_id from products where btrim(name) = ''`)).master_product_id).toBeNull()
  })

  it('antibiotics are prescription-only; an unknown category is pharmacy-only', async () => {
    expect((await masterOf(A, 'amoxil 500')).rx_status).toBe('prescription_only')
    expect(await masterOf(A, 'mystery tonic')).toMatchObject({ category_code: 'medicines_other', rx_status: 'pharmacy_only', default_price: 0 })
  })

  it('reuses an existing master item and keeps its links', async () => {
    const p = await one(`select master_product_id, price_source from products where name = 'paracetamol 500mg'`)
    expect(p).toEqual({ master_product_id: OLD_MASTER, price_source: 'branch' })
    expect((await one(`select category_code, rx_status from master_products where id = '${OLD_MASTER}'`))).toEqual({ category_code: 'medicines_other', rx_status: 'pharmacy_only' })
    expect((await one(`select count(*)::int n from master_products where business_id = '${A}' and name_key = 'paracetamol 500mg'`)).n).toBe(1)
    expect((await one(`select override_price from branch_products where branch_id = '${A}' and master_product_id = '${OLD_MASTER}'`)).override_price).toBe(500)
  })

  it('records where each item is carried', async () => {
    const m = await masterOf(A, 'neurotex forte')
    expect((await rows(`select branch_id from branch_products where master_product_id = $1 order by branch_id`, [m.id])).map((r) => r.branch_id)).toEqual([A, A1])
  })

  it('re-running the migration changes nothing', async () => {
    const count = async () => one(`select (select count(*)::int from master_products) m, (select count(*)::int from branch_products) b,
      (select count(*)::int from products where master_product_id is not null) p, (select count(*)::int from product_categories) c`)
    const before = await count()
    await db.exec(MIGRATION)
    expect(await count()).toEqual(before)
  })
})

describe('auto-add', () => {
  it('a product added at a branch by its staff joins the main business catalogue', async () => {
    await as('cashier@a.com', (q) => q(`insert into products (business_id, name, category, price) values ('${A1}', 'Coartem 80/480', 'ANTIMALARIAL', 2500)`))
    const m = await masterOf(A, 'coartem 80/480')
    expect(m).toMatchObject({ name: 'Coartem 80/480', default_price: 2500, category_code: 'antimalarials', rx_status: 'pharmacy_only' })
    expect(await one(`select master_product_id, price_source, rx_status from products where name = 'Coartem 80/480'`))
      .toEqual({ master_product_id: m.id, price_source: 'master', rx_status: 'pharmacy_only' })
    expect((await one(`select active from branch_products where branch_id = '${A1}' and master_product_id = $1`, [m.id])).active).toBe(true)
  })

  it('a second spelling of a known product links to the same item; its own price marks it as a branch price', async () => {
    const m = await masterOf(A, 'neurotex forte')
    await as('owner@a.com', (q) => q(`insert into products (business_id, name, price) values ('${A2}', 'NEUROTEX FORTE', 650)`))
    expect(await one(`select master_product_id, price_source from products where business_id = '${A2}' and name = 'NEUROTEX FORTE'`))
      .toEqual({ master_product_id: m.id, price_source: 'branch' })
  })

  it('refuses a link to another business\'s master item', async () => {
    const theirs = await masterOf(B, 'neurotex forte')
    await expect(as('owner@a.com', (q) => q(`insert into products (business_id, name, master_product_id) values ('${A}', 'Sneaky', $1)`, [theirs.id])))
      .rejects.toThrow(/belongs to another business/)
  })

  it('cannot be called directly', async () => {
    await expect(as('owner@a.com', (q) => q('select products_link_master()'))).rejects.toThrow()
  })
})

describe('price source', () => {
  it('a price typed at a branch becomes the branch\'s own price', async () => {
    const id = (await one(`select id from products where business_id = '${A}' and name = 'Neurotex Forte'`)).id
    await as('owner@a.com', (q) => q(`update products set price = 550 where id = $1`, [id]))
    expect((await one('select price_source from products where id = $1', [id])).price_source).toBe('branch')
    await as('owner@a.com', (q) => q(`update products set price = 500, price_source = 'master' where id = $1`, [id]))
    // a stock change alone never touches it
    await as('owner@a.com', (q) => q(`update products set price_source = 'master' where id = $1`, [id]))
    await as('owner@a.com', (q) => q(`update products set stock = stock + 1 where id = $1`, [id]))
    expect((await one('select price_source from products where id = $1', [id])).price_source).toBe('master')
  })
})

describe('carry_master_items', () => {
  it('creates the branch products at stock 0, at the master price, in one call', async () => {
    const ids = [(await masterOf(A, 'amoxil 500')).id, (await masterOf(A, 'mystery tonic')).id]
    const n = await as('owner@a.com', (q) => q(`select carry_master_items('${A2}', $1::uuid[]) n`, [ids]))
    expect(n[0].n).toBe(2)
    const made = await rows(`select name, price::int, stock, price_source, rx_status from products where business_id = '${A2}' and master_product_id = any($1::uuid[]) order by name`, [ids])
    expect(made).toEqual([
      { name: 'Amoxil 500', price: 1200, stock: 0, price_source: 'master', rx_status: 'prescription_only' },
      { name: 'Mystery Tonic', price: 0, stock: 0, price_source: 'master', rx_status: 'pharmacy_only' },
    ])
  })

  it('carrying again does not duplicate; a given price becomes that branch\'s own price', async () => {
    const id = (await masterOf(A, 'amoxil 500')).id
    await as('owner@a.com', (q) => q(`select carry_master_items('${A2}', array['${id}']::uuid[], 1300)`))
    expect(await rows(`select price::int, price_source from products where business_id = '${A2}' and master_product_id = $1`, [id]))
      .toEqual([{ price: 1300, price_source: 'branch' }])
    expect((await one(`select override_price from branch_products where branch_id = '${A2}' and master_product_id = $1`, [id])).override_price).toBe(1300)
  })

  it('ignores items of another business, refuses a location the caller does not belong to, and a zero price', async () => {
    const theirs = (await masterOf(B, 'neurotex forte')).id
    const n = await as('owner@a.com', (q) => q(`select carry_master_items('${A2}', array['${theirs}']::uuid[]) n`))
    expect(n[0].n).toBe(0)
    const mine = (await masterOf(A, 'amoxil 500')).id
    await expect(as('owner@b.com', (q) => q(`select carry_master_items('${A2}', array['${mine}']::uuid[])`))).rejects.toThrow(/Location not found/)
    await expect(as('owner@a.com', (q) => q(`select carry_master_items('${A2}', array['${mine}']::uuid[], 0)`))).rejects.toThrow(/greater than zero/)
  })

  it('activate_branch_product keeps working, now by id', async () => {
    const id = (await masterOf(A, 'coartem 80/480')).id
    const r = await as('owner@a.com', (q) => q(`select activate_branch_product('${A2}', '${id}') pid`))
    expect((await one('select business_id, master_product_id from products where id = $1', [r[0].pid]))).toEqual({ business_id: A2, master_product_id: id })
  })

  it('stopping an item at a branch shows in the catalogue page; carrying it again restarts it', async () => {
    const id = (await masterOf(A, 'coartem 80/480')).id
    await as('owner@a.com', (q) => q(`select deactivate_branch_product('${A2}', '${id}')`))
    const carriedAt = async () => (await as('owner@a.com', (q) => q(`select carried from master_catalog_page('${A}', 'coartem')`)))[0].carried
      .find((c) => c.branch_id === A2)
    expect((await carriedAt()).active).toBe(false)
    await as('owner@a.com', (q) => q(`select carry_master_items('${A2}', array['${id}']::uuid[])`))
    expect((await carriedAt()).active).toBe(true)
  })
})

describe('push_master_product', () => {
  it('updates every linked product by id; the price only where the branch follows the master', async () => {
    const m = await masterOf(A, 'neurotex forte')
    await db.query(`update master_products set name = 'Neurotex Forte Tablets', default_price = 700, generic_name = 'B1/B6/B12', category = 'Vitamins',
      category_code = 'vitamins' where id = $1`, [m.id])
    const n = await as('owner@a.com', (q) => q(`select push_master_product($1, '${A}') n`, [m.id]))
    const linked = await rows(`select business_id, name, generic_name, price::int, price_source from products where master_product_id = $1 order by business_id, price`, [m.id])
    expect(n[0].n).toBe(linked.length)
    expect(linked.every((p) => p.name === 'Neurotex Forte Tablets' && p.generic_name === 'B1/B6/B12')).toBe(true)
    expect(linked.map((p) => [p.business_id, p.price, p.price_source])).toEqual([
      [A, 700, 'master'], [A1, 600, 'branch'], [A1, 700, 'master'], [A2, 650, 'branch'],
    ])
  })

  it('does nothing for another business', async () => {
    const theirs = (await masterOf(B, 'neurotex forte')).id
    const r = await as('owner@a.com', (q) => q(`select push_master_product('${theirs}', '${B}') n`))
    expect(r[0].n).toBeNull()
    expect((await one(`select name from products where business_id = '${B}'`)).name).toBe('Neurotex Forte')
  })
})

describe('master_catalog_page', () => {
  it('pages, searches by name, generic or barcode, filters by category, and lists where each item is carried', async () => {
    const page = await as('owner@a.com', (q) => q(`select * from master_catalog_page('${A}', null, null, false, 0, 2)`))
    expect(page).toHaveLength(2)
    expect(Number(page[0].total)).toBe(5)
    expect(page[0].item.name_key).toBeUndefined()

    const byGeneric = await as('owner@a.com', (q) => q(`select * from master_catalog_page('${A}', 'amoxicillin')`))
    expect(byGeneric.map((r) => r.item.name)).toEqual(['Amoxil 500'])
    expect(byGeneric[0].carried.map((c) => c.branch_id).sort()).toEqual([A, A2])

    const byBarcode = await as('owner@a.com', (q) => q(`select * from master_catalog_page('${A}', '6001234')`))
    expect(byBarcode.map((r) => r.item.name)).toEqual(['Neurotex Forte Tablets'])

    const rx = await as('owner@a.com', (q) => q(`select * from master_catalog_page('${A}', null, 'antibiotics')`))
    expect(rx.map((r) => r.item.name)).toEqual(['Amoxil 500'])
  })

  it('shows archived items only when asked, and nothing of another business', async () => {
    await db.query(`update master_products set archived_at = now() where business_id = '${A}' and name_key = 'mystery tonic'`)
    const live = await as('owner@a.com', (q) => q(`select * from master_catalog_page('${A}')`))
    expect(live.map((r) => r.item.name)).not.toContain('Mystery Tonic')
    const archived = await as('owner@a.com', (q) => q(`select * from master_catalog_page('${A}', null, null, true)`))
    expect(archived.map((r) => r.item.name)).toEqual(['Mystery Tonic'])
    expect(await as('owner@b.com', (q) => q(`select * from master_catalog_page('${A}')`))).toEqual([])
  })

  it('an archived name can be used again (a new item is created)', async () => {
    await as('owner@a.com', (q) => q(`insert into products (business_id, name) values ('${A}', 'Mystery Tonic')`))
    expect((await one(`select count(*)::int n from master_products where business_id = '${A}' and name_key = 'mystery tonic'`)).n).toBe(2)
  })
})

describe('business_root', () => {
  it('answers members and server code only', async () => {
    expect((await one(`select business_root('${A1}') r`)).r).toBe(A)
    expect((await as('cashier@a.com', (q) => q(`select business_root('${A1}') r`)))[0].r).toBe(A)
    expect((await as('owner@b.com', (q) => q(`select business_root('${A1}') r`)))[0].r).toBeNull()
  })
})
