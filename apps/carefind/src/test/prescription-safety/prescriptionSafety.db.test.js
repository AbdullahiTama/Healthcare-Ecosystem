// @vitest-environment node
// carehub_20261221_prescription_safety on PGlite, with the live shapes and policies of products, ecommerce_products,
// shop_order_items and the shop_public_products view.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20261221_prescription_safety.sql', import.meta.url)), 'utf8')

const SHOP = 'a0000000-0000-4000-8000-000000000001'
const OTHER = 'b0000000-0000-4000-8000-000000000001'
const OWNER = '10000000-0000-4000-8000-000000000001'
const SELLER = '20000000-0000-4000-8000-000000000001' // a CareFind seller who owns a listing directly
const P = { para: 'c0000000-0000-4000-8000-000000000001', amox: 'c0000000-0000-4000-8000-000000000002', tram: 'c0000000-0000-4000-8000-000000000003',
  vitc: 'c0000000-0000-4000-8000-000000000004', hidden: 'c0000000-0000-4000-8000-000000000005', sellerRx: 'c0000000-0000-4000-8000-000000000006' }
const E = { para: 'e0000000-0000-4000-8000-000000000001', amox: 'e0000000-0000-4000-8000-000000000002', vitc: 'e0000000-0000-4000-8000-000000000004' }
let db

async function as(role, uid, email, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claims', JSON.stringify({ sub: uid, email, role })])
  await db.query(`set role ${role}`)
  try { return await fn((s, p) => db.query(s, p).then((r) => r.rows)) } finally {
    await db.query('reset role'); await db.query(`select set_config('request.jwt.claims','',false)`)
  }
}
const asPublic = (fn) => as('anon', null, null, fn)
const asOwner = (fn) => as('authenticated', OWNER, 'owner@shop.com', fn)
const asSeller = (fn) => as('authenticated', SELLER, 'seller@x.com', fn)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, email text);
    create table business_claims (id uuid primary key default gen_random_uuid(), business_id uuid, user_id uuid, status text);
    create table products (id uuid primary key, business_id uuid, owner_id uuid, name text not null, generic_name text, category text, price numeric default 0,
      cost_price numeric default 0, stock integer default 0, emoji text, image_url text, description text, whatsapp text, sale_type text, price_unit text,
      min_purchase integer, seller_location text, latitude double precision, longitude double precision, show_price boolean default true not null,
      list_on_carefind boolean default true, created_at timestamp default now(), rx_status text);
    create table ecommerce_products (id uuid primary key, business_id uuid, product_id uuid, status text, description text, category text,
      ecommerce_price_kobo integer, attributes jsonb, active_at timestamptz, created_at timestamptz default now(), updated_at timestamptz,
      prescription_required boolean default false, warnings text, restrictions text, is_restricted boolean default false);
    create table shop_order_items (id uuid primary key default gen_random_uuid(), order_id uuid, ecommerce_product_id uuid, product_id uuid,
      product_name text, quantity integer, unit_price_kobo integer, line_total_kobo integer);
    create function current_business_ids() returns setof uuid language sql stable security definer set search_path = public as $$
      select id from businesses where lower(email) = lower(auth.email()) $$;
    create function is_platform_admin() returns boolean language sql stable as $$ select false $$;
    create function is_ecommerce_vendor_approved(uuid) returns boolean language sql stable as $$ select true $$;
    do $$ declare t text; begin foreach t in array array['products','ecommerce_products','shop_order_items','business_claims','businesses'] loop
      execute format('alter table %I enable row level security', t);
      execute format('grant select, insert, update, delete on %I to anon, authenticated', t);
      execute format('grant all on %I to service_role', t);
    end loop; end $$;
    create policy "claims readable" on business_claims for select using (true);
    -- live policies
    create policy "products of own business" on products for all to authenticated using (business_id in (select current_business_ids()) or is_platform_admin());
    create policy "public can view listed products" on products for select using (list_on_carefind = true);
    create policy "ecommerce_products public read" on ecommerce_products for select using (status = 'Active' and is_restricted = false and is_ecommerce_vendor_approved(business_id)
      and exists (select 1 from products p where p.id = ecommerce_products.product_id and (p.stock is null or p.stock > 0)));
    create view shop_public_products with (security_invoker = true) as
      select ep.id, ep.business_id, ep.product_id, ep.description, ep.category, ep.ecommerce_price_kobo, ep.attributes, ep.active_at, ep.prescription_required,
        ep.warnings, ep.restrictions, p.name as product_name, p.generic_name, p.price as inventory_price, p.stock, p.category as inventory_category,
        p.sale_type, p.price_unit, p.image_url as fallback_image_url
      from ecommerce_products ep join products p on p.id = ep.product_id
      where ep.status = 'Active' and ep.is_restricted = false and is_ecommerce_vendor_approved(ep.business_id) and (p.stock is null or p.stock > 0);
    grant select on shop_public_products to anon, authenticated;

    insert into businesses values ('${SHOP}', 'owner@shop.com'), ('${OTHER}', 'other@x.com');
    insert into products (id, business_id, owner_id, name, price, cost_price, stock, rx_status, list_on_carefind) values
      ('${P.para}', '${SHOP}', null, 'Paracetamol', 300, 200, 10, 'otc', true),
      ('${P.amox}', '${SHOP}', null, 'Amoxil 500', 1200, 900, 10, 'prescription_only', true),
      ('${P.tram}', '${SHOP}', null, 'Tramadol', 2500, 2000, 10, 'controlled', true),
      ('${P.vitc}', '${SHOP}', null, 'Vitamin C', 500, 300, 10, 'pharmacy_only', true),
      ('${P.hidden}', '${SHOP}', null, 'Unlisted Rx', 900, 500, 10, 'prescription_only', false),
      ('${P.sellerRx}', null, '${SELLER}', 'Seller Rx', 700, 400, 5, 'prescription_only', true);
    insert into ecommerce_products (id, business_id, product_id, status, ecommerce_price_kobo, prescription_required) values
      ('${E.para}', '${SHOP}', '${P.para}', 'Active', 30000, false),
      ('${E.amox}', '${SHOP}', '${P.amox}', 'Active', 120000, false),
      ('${E.vitc}', '${SHOP}', '${P.vitc}', 'Active', 50000, true);
  `)
  await db.exec(MIGRATION)
})

describe('the products table', () => {
  it('the public no longer reads prescription-only or controlled items, with or without a price', async () => {
    const names = await asPublic((q) => q('select name from products order by name'))
    expect(names.map((r) => r.name)).toEqual(['Paracetamol', 'Vitamin C'])
    expect(await asPublic((q) => q(`select price from products where id = '${P.amox}'`))).toEqual([])
  })

  it('the business, the listing\'s own seller and an approved claimant still see their items in full', async () => {
    const own = await asOwner((q) => q(`select name, price::int from products where id = '${P.amox}'`))
    expect(own).toEqual([{ name: 'Amoxil 500', price: 1200 }])
    expect((await asSeller((q) => q(`select price::int from products where id = '${P.sellerRx}'`)))[0].price).toBe(700)
    await db.query(`insert into business_claims (business_id, user_id, status) values ('${SHOP}', '30000000-0000-4000-8000-000000000001', 'approved')`)
    const claimant = await as('authenticated', '30000000-0000-4000-8000-000000000001', 'c@x.com', (q) => q(`select price::int from products where id = '${P.tram}'`))
    expect(claimant).toEqual([{ price: 2500 }])
  })
})

describe('carefind_products', () => {
  it('lists every listed item; restricted ones have no price and say so; cost is never exposed', async () => {
    const rows = await asPublic((q) => q('select * from carefind_products order by name'))
    expect(rows.map((r) => [r.name, r.rx_restricted, r.price == null ? null : Number(r.price), r.show_price])).toEqual([
      ['Amoxil 500', true, null, false],
      ['Paracetamol', false, 300, true],
      ['Seller Rx', true, null, false],
      ['Tramadol', true, null, false],
      ['Vitamin C', false, 500, true],
    ])
    expect(Object.keys(rows[0])).not.toContain('cost_price')
  })

  it('unlisted items never appear', async () => {
    expect(await asPublic((q) => q(`select 1 from carefind_products where id = '${P.hidden}'`))).toEqual([])
  })

  it('the public cannot write through it', async () => {
    await expect(asPublic((q) => q(`update carefind_products set price = 1 where id = '${P.para}'`))).rejects.toThrow()
  })
})

describe('the shop', () => {
  it('lists neither prescription-only products nor "prescription required" listings', async () => {
    const view = await asPublic((q) => q('select product_name from shop_public_products order by product_name'))
    expect(view.map((r) => r.product_name)).toEqual(['Paracetamol'])
    const table = await asPublic((q) => q('select id from ecommerce_products'))
    expect(table.map((r) => r.id)).toEqual([E.para])
  })

  it('refuses an order line for a prescription medicine, whoever inserts it', async () => {
    await expect(db.query(`insert into shop_order_items (order_id, ecommerce_product_id, product_id, product_name, quantity, unit_price_kobo, line_total_kobo)
      values (gen_random_uuid(), '${E.amox}', '${P.amox}', 'Amoxil 500', 1, 120000, 120000)`)).rejects.toThrow(/Amoxil 500 is a prescription medicine and is not sold online/)
    await expect(db.query(`insert into shop_order_items (order_id, ecommerce_product_id, product_id, product_name, quantity, unit_price_kobo, line_total_kobo)
      values (gen_random_uuid(), '${E.vitc}', '${P.vitc}', 'Vitamin C', 1, 50000, 50000)`)).rejects.toThrow(/prescription medicine/)
  })

  it('an ordinary order line is accepted', async () => {
    await db.query(`insert into shop_order_items (order_id, ecommerce_product_id, product_id, product_name, quantity, unit_price_kobo, line_total_kobo)
      values (gen_random_uuid(), '${E.para}', '${P.para}', 'Paracetamol', 2, 30000, 60000)`)
    expect((await db.query(`select count(*)::int n from shop_order_items where product_id = '${P.para}'`)).rows[0].n).toBe(1)
  })
})

describe('re-running', () => {
  it('the migration can be applied again', async () => {
    await db.exec(MIGRATION)
    const names = await asPublic((q) => q('select name from carefind_products order by name'))
    expect(names).toHaveLength(5)
  })
})
