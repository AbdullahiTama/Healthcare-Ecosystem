// @vitest-environment node
// carefind_20270206_guest_shop_read on PGlite, over the live chain that refused MED Market to visitors who are not
// signed in (verified live 2026-11-25): ecommerce_products public read → products' own row security → business_claims
// → is_platform_admin(), which anon may not execute. Live helper definitions and function grants, verbatim.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carefind_20270206_guest_shop_read.sql', import.meta.url)), 'utf8')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const UNAPPROVED = 'a0000000-0000-4000-8000-000000000002'
const P_OK = 'c0000000-0000-4000-8000-000000000001'
const P_OUT = 'c0000000-0000-4000-8000-000000000002'
const P_RX = 'c0000000-0000-4000-8000-000000000003'
const P_UNAPPROVED = 'c0000000-0000-4000-8000-000000000004'
const E = (n) => 'e0000000-0000-4000-8000-00000000000' + n

let db
// Runs `sql` as `who` ('anon' or an authenticated email) in a rolled-back transaction.
async function as(who, sql) {
  await db.exec('begin')
  try {
    if (who === 'anon') {
      await db.exec('set local role anon')
    } else {
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: '10000000-0000-4000-8000-000000000001', email: who, role: 'authenticated' })])
      await db.exec('set local role authenticated')
    }
    return { rows: (await db.query(sql)).rows }
  } catch (e) {
    return { error: e.message, code: e.code }
  } finally {
    await db.exec('rollback')
  }
}
const shopIds = async (who) => {
  const r = await as(who, 'select id from ecommerce_products order by id')
  return r.error ? r : r.rows.map((x) => x.id)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;

    create table businesses (id uuid primary key, name text, email text, is_platform_admin boolean default false);
    create table ecommerce_applications (business_id uuid, status text);
    create table business_claims (id uuid primary key default gen_random_uuid(), business_id uuid, user_id uuid, status text);
    create table products (id uuid primary key, business_id uuid, owner_id uuid, name text, generic_name text, category text,
      emoji text, image_url text, description text, whatsapp text, sale_type text, price_unit text, min_purchase integer,
      seller_location text, latitude double precision, longitude double precision, price numeric, cost_price numeric,
      stock integer, reorder_level integer, rx_status text, show_price boolean default true, list_on_carefind boolean default true,
      created_at timestamp default now(), updated_at timestamptz default now());
    create table ecommerce_products (id uuid primary key, business_id uuid, product_id uuid, status text,
      is_restricted boolean default false, prescription_required boolean);

    -- Live definitions, verbatim (2026-11-25).
    CREATE OR REPLACE FUNCTION public.is_rx_restricted(p_rx_status text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $function$
      select coalesce(p_rx_status, '') in ('prescription_only', 'controlled')
    $function$;
    CREATE OR REPLACE FUNCTION public.is_carefind_unpriced(p_rx_status text, p_price numeric) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $function$
      select not public.is_rx_restricted(p_rx_status) and coalesce(p_price, 0) <= 0
    $function$;
    CREATE OR REPLACE FUNCTION public.is_ecommerce_vendor_approved(p_business_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      SELECT EXISTS (SELECT 1 FROM ecommerce_applications WHERE business_id = p_business_id AND status = 'Approved');
    $function$;
    CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      SELECT COALESCE((SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())), false)
    $function$;
    CREATE OR REPLACE FUNCTION public.current_business_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      SELECT b.id FROM businesses b WHERE lower(b.email) = lower(auth.email())
    $function$;
    -- Function grants as live: anon may not execute is_platform_admin.
    revoke execute on function public.is_platform_admin(), public.current_business_ids(), public.is_ecommerce_vendor_approved(uuid),
      public.is_rx_restricted(text), public.is_carefind_unpriced(text, numeric) from public;
    grant execute on function public.is_platform_admin() to authenticated, service_role;
    grant execute on function public.current_business_ids(), public.is_ecommerce_vendor_approved(uuid),
      public.is_rx_restricted(text), public.is_carefind_unpriced(text, numeric) to anon, authenticated, service_role;

    -- Live policies (the ones on the chain), verbatim.
    alter table products enable row level security;
    alter table business_claims enable row level security;
    alter table ecommerce_products enable row level security;
    create policy "products of own business" on products for all to authenticated
      using ((business_id in (select current_business_ids())) or is_platform_admin());
    create policy "public can view listed products" on products for select to public
      using ((list_on_carefind = true) AND (((NOT is_rx_restricted(rx_status)) AND (NOT is_carefind_unpriced(rx_status, price)))
        OR (owner_id = (SELECT auth.uid())) OR (business_id IN (SELECT bc.business_id FROM business_claims bc
        WHERE ((bc.user_id = (SELECT auth.uid())) AND (bc.status = 'approved'))))));
    create policy "business_claims visible to claimant or claimed business" on business_claims for select to public
      using (is_platform_admin() OR (user_id = (SELECT auth.uid())) OR (business_id IN (SELECT current_business_ids())));
    create policy "ecommerce_products public read" on ecommerce_products for select to public
      using ((status = 'Active') AND (is_restricted = false) AND is_ecommerce_vendor_approved(business_id)
        AND (COALESCE(prescription_required, false) = false) AND (EXISTS (SELECT 1 FROM products p
        WHERE ((p.id = ecommerce_products.product_id) AND ((p.stock IS NULL) OR (p.stock > 0)) AND (NOT is_rx_restricted(p.rx_status))))));
    create policy "ecommerce_products tenant write" on ecommerce_products for all to authenticated
      using (((business_id in (select current_business_ids())) or is_platform_admin()) and (is_ecommerce_vendor_approved(business_id) or is_platform_admin()));
    grant select, insert, update, delete on products, business_claims, ecommerce_products to anon, authenticated;

    -- The public view as live (2026-11-25), owned by the superuser so it reads products without the caller's RLS.
    CREATE VIEW public.carefind_products AS SELECT id, business_id, owner_id, name, generic_name, category, emoji, image_url,
      description, whatsapp, sale_type, price_unit, min_purchase, seller_location, latitude, longitude, stock, list_on_carefind,
      created_at, rx_status, is_rx_restricted(rx_status) AS rx_restricted,
      CASE WHEN is_rx_restricted(rx_status) THEN NULL::numeric ELSE price END AS price,
      CASE WHEN is_rx_restricted(rx_status) THEN false ELSE show_price END AS show_price, updated_at
      FROM products p WHERE list_on_carefind = true AND NOT is_carefind_unpriced(rx_status, price);
    grant select on carefind_products to anon, authenticated;

    insert into businesses (id, name, email) values ('${BIZ}', 'Pharm', 'owner@pharm.ng'), ('${UNAPPROVED}', 'Other', 'owner@other.ng');
    insert into ecommerce_applications values ('${BIZ}', 'Approved'), ('${UNAPPROVED}', 'Pending');
    insert into products (id, business_id, name, price, cost_price, stock, rx_status, reorder_level) values
      ('${P_OK}', '${BIZ}', 'Paracetamol', 500, 300, 10, null, 12),
      ('${P_OUT}', '${BIZ}', 'Vitamin C', 800, 500, 0, null, null),
      ('${P_RX}', '${BIZ}', 'Amoxicillin', 1500, 900, 10, 'prescription_only', null),
      ('${P_UNAPPROVED}', '${UNAPPROVED}', 'Ibuprofen', 400, 200, 10, null, null);
    insert into ecommerce_products (id, business_id, product_id, status, is_restricted, prescription_required) values
      ('${E(1)}', '${BIZ}', '${P_OK}', 'Active', false, false),
      ('${E(2)}', '${BIZ}', '${P_OUT}', 'Active', false, false),
      ('${E(3)}', '${BIZ}', '${P_RX}', 'Active', false, false),
      ('${E(4)}', '${UNAPPROVED}', '${P_UNAPPROVED}', 'Active', false, false),
      ('${E(5)}', '${BIZ}', '${P_OK}', 'Not Activated', false, false),
      ('${E(6)}', '${BIZ}', '${P_OK}', 'Active', true, false),
      ('${E(7)}', '${BIZ}', '${P_OK}', 'Active', false, true);
  `)
})

describe('before the fix (reproduces the report)', () => {
  it('refuses a visitor who is not signed in, with the live error', async () => {
    const r = await shopIds('anon')
    expect(r.error).toMatch(/permission denied for function is_platform_admin/)
  })
  it('works for a signed-in shopper (control)', async () => {
    expect(await shopIds('shopper@mail.ng')).toEqual([E(1)])
  })
  it('anon cannot read products at all today (so cost_price is not exposed to anon)', async () => {
    expect((await as('anon', 'select cost_price from products')).error).toMatch(/is_platform_admin/)
  })
})

describe('after carefind_20270206_guest_shop_read', () => {
  beforeAll(async () => { await db.exec(MIGRATION) })

  it('shows a visitor exactly the sellable shop items', async () => {
    // Active, approved vendor, in stock, not prescription, not restricted: only E1.
    expect(await shopIds('anon')).toEqual([E(1)])
  })

  it('shows a signed-in shopper exactly what they saw before', async () => {
    expect(await shopIds('shopper@mail.ng')).toEqual([E(1)])
  })

  it('still shows the vendor all of its own items (tenant policy unchanged)', async () => {
    expect(await shopIds('owner@pharm.ng')).toEqual([E(1), E(2), E(3), E(5), E(6), E(7)])
  })

  it('does not open products, or its cost price, to anon', async () => {
    expect((await as('anon', 'select cost_price from products')).error).toMatch(/is_platform_admin/)
    expect((await as('anon', 'select id from products')).error).toMatch(/is_platform_admin/)
  })

  it('gives anon only a boolean from the helper', async () => {
    const r = await as('anon', `select ecommerce_product_sellable('${P_OK}') ok, ecommerce_product_sellable('${P_OUT}') out, ecommerce_product_sellable('${P_RX}') rx, ecommerce_product_sellable(gen_random_uuid()) missing`)
    expect(r.rows).toEqual([{ ok: true, out: false, rx: false, missing: false }])
  })

  it('follows stock changes: an item sells out of the public shop', async () => {
    await db.exec(`update products set stock = 0 where id = '${P_OK}'`)
    try {
      expect(await shopIds('anon')).toEqual([])
    } finally {
      await db.exec(`update products set stock = 10 where id = '${P_OK}'`)
    }
  })

  it('gives anon the shop item\'s product details through the public view, with reorder_level and no cost', async () => {
    const r = await as('anon', `select name, price, stock, reorder_level from carefind_products where id = '${P_OK}'`)
    expect(r.rows).toEqual([{ name: 'Paracetamol', price: '500', stock: 10, reorder_level: 12 }])
    const cols = await db.query(`select string_agg(column_name, ',' order by ordinal_position) c from information_schema.columns where table_name = 'carefind_products'`)
    expect(cols.rows[0].c).toMatch(/,updated_at,reorder_level$/)
    expect(cols.rows[0].c).not.toMatch(/cost/)
  })

  it('keeps the view\'s rows and prescription price hiding unchanged', async () => {
    const r = await as('anon', `select id, price from carefind_products order by id`)
    expect(r.rows).toEqual([
      { id: P_OK, price: '500' }, { id: P_OUT, price: '800' }, { id: P_RX, price: null }, { id: P_UNAPPROVED, price: '400' },
    ])
  })

  it('is safe to apply twice', async () => {
    await db.exec(MIGRATION)
    expect(await shopIds('anon')).toEqual([E(1)])
  })
})
