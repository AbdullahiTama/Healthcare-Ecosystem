// @vitest-environment node
// carefind_20270201_seo_updated_at on PGlite. Tables carry the columns the triggers read (all checked against the live
// schema on 2026-11-22); is_rx_restricted / is_carefind_unpriced are the live definitions; carefind_products starts as
// carehub_20270127_catalogue_health left it, so the CREATE OR REPLACE in the migration is exercised for real.
// updated_at feeds the sitemaps' <lastmod> and the daily IndexNow submission (api/_lib/indexNow.js).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carefind_20270201_seo_updated_at.sql', import.meta.url)), 'utf8')

const BIZ = 'a0000000-0000-4000-8000-000000000001'
const PROD = 'c0000000-0000-4000-8000-000000000001'
const RX = 'c0000000-0000-4000-8000-000000000002'
const PROFILE = '10000000-0000-4000-8000-000000000001'
const NEWS = 'd0000000-0000-4000-8000-000000000001'
const POST = 'e0000000-0000-4000-8000-000000000001'
const OLD = '2026-01-01 00:00:00+00'

let db
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
// Each test runs in a transaction that is rolled back. now() is the transaction start, so a bump shows as now().
async function tx(fn) {
  await db.exec('begin')
  try { return await fn() } finally { await db.exec('rollback') }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create function is_rx_restricted(p_rx_status text) returns boolean language sql immutable set search_path to 'public', 'pg_temp' as $f$
      select coalesce(p_rx_status, '') in ('prescription_only', 'controlled') $f$;
    create function is_carefind_unpriced(p_rx_status text, p_price numeric) returns boolean language sql immutable set search_path to 'public', 'pg_temp' as $f$
      select not public.is_rx_restricted(p_rx_status) and coalesce(p_price, 0) <= 0 $f$;

    create table businesses (id uuid primary key, name text, email text, address text, city text, state text, lga text, area text, phone text,
      whatsapp text, hours jsonb, website text, description text, logo_url text, cover_url text, maps_link text, business_type text,
      status text, visible_on_carefind boolean, show_prices boolean, lat numeric, lng numeric, latitude numeric, longitude numeric,
      deleted_at timestamptz, plan text, payout_code text, created_at timestamptz default now());
    -- businesses grants columns one by one to the public roles (as live); email and payout_code are not among them.
    grant select (id, name, address, city, state, status, visible_on_carefind, created_at) on businesses to anon, authenticated;
    grant update on businesses to authenticated;

    create table products (id uuid primary key, business_id uuid, owner_id uuid, name text not null, generic_name text, category text,
      emoji text, image_url text, description text, whatsapp text, sale_type text, price_unit text, min_purchase integer,
      seller_location text, latitude numeric, longitude numeric, stock integer default 0, list_on_carefind boolean default false,
      created_at timestamptz default now(), rx_status text, price numeric, show_price boolean default true, cost_price numeric);
    grant select, update on products to authenticated;

    create table profiles (id uuid primary key, full_name text, display_name text, bio text, specialty text, verification_label text,
      is_verified boolean default false, avatar_url text, location text, website text, last_seen_at timestamptz, created_at timestamptz default now());
    grant select (id, full_name, is_verified) on profiles to anon, authenticated;
    grant update on profiles to authenticated;

    create table news (id uuid primary key, headline text, subtitle text, body text, hero_image_url text, status text, view_count integer default 0,
      published_at timestamptz);
    grant select on news to anon, authenticated;

    create table posts (id uuid primary key, user_id uuid, content text, image_url text, image_urls text[], post_type text,
      subscriber_only boolean default false, is_premium boolean default false, like_count integer default 0, created_at timestamptz default now());
    grant select, update on posts to anon, authenticated;

    -- carefind_products as carehub_20270127_catalogue_health left it.
    create view carefind_products as
    select p.id, p.business_id, p.owner_id, p.name, p.generic_name, p.category, p.emoji, p.image_url, p.description,
           p.whatsapp, p.sale_type, p.price_unit, p.min_purchase, p.seller_location, p.latitude, p.longitude, p.stock,
           p.list_on_carefind, p.created_at, p.rx_status,
           public.is_rx_restricted(p.rx_status) as rx_restricted,
           case when public.is_rx_restricted(p.rx_status) then null else p.price end as price,
           case when public.is_rx_restricted(p.rx_status) then false else p.show_price end as show_price
      from public.products p
     where p.list_on_carefind = true and not public.is_carefind_unpriced(p.rx_status, p.price);
    revoke all on carefind_products from public, anon, authenticated;
    grant select on carefind_products to anon, authenticated, service_role;

    -- Rows that existed before the migration.
    insert into businesses (id, name, city, state, status, visible_on_carefind, plan) values ('${BIZ}', 'Ada Pharmacy', 'Ikeja', 'Lagos', 'active', true, 'free');
    insert into products (id, business_id, name, generic_name, stock, list_on_carefind, price) values
      ('${PROD}', '${BIZ}', 'Amoxil 500mg', 'amoxicillin', 10, true, 1200),
      ('${RX}', '${BIZ}', 'Tramadol 50mg', 'tramadol', 5, true, 900);
    update products set rx_status = 'controlled' where id = '${RX}';
    insert into profiles (id, full_name, is_verified) values ('${PROFILE}', 'Dr Ada', false);
    insert into news (id, headline, status) values ('${NEWS}', 'Malaria vaccine rollout', 'approved');
    insert into posts (id, content, post_type) values ('${POST}', 'Hand washing saves lives', 'article');
  `)
  await db.exec(MIGRATION)
})

describe('carefind_20270201_seo_updated_at', () => {
  it('leaves existing rows NULL (no backfill) and stamps new rows', async () => {
    expect((await one(`select updated_at from businesses where id = $1`, [BIZ])).updated_at).toBeNull()
    expect((await one(`select updated_at from products where id = $1`, [PROD])).updated_at).toBeNull()
    await tx(async () => {
      await db.exec(`insert into news (id, headline, status) values ('d0000000-0000-4000-8000-000000000002', 'New', 'approved')`)
      const r = await one(`select updated_at = now() fresh from news where id = 'd0000000-0000-4000-8000-000000000002'`)
      expect(r.fresh).toBe(true)
    })
  })

  it('a change to something shown publicly bumps updated_at, on every table', async () => {
    await tx(async () => {
      await db.exec(`update businesses set phone = '0800' where id = '${BIZ}'`)
      await db.exec(`update products set price = 1500 where id = '${PROD}'`)
      await db.exec(`update profiles set is_verified = true where id = '${PROFILE}'`)
      await db.exec(`update news set body = 'Updated' where id = '${NEWS}'`)
      await db.exec(`update posts set content = 'Edited' where id = '${POST}'`)
      for (const t of ['businesses', 'products', 'profiles', 'news', 'posts']) {
        const r = await one(`select bool_and(updated_at = now()) ok from ${t} where updated_at is not null`)
        expect(r.ok, t).toBe(true)
      }
    })
  })

  it('everyday writes that change nothing public keep the previous value', async () => {
    await tx(async () => {
      await db.exec(`alter table businesses disable trigger seo_touch_updated_at; update businesses set updated_at = '${OLD}'; alter table businesses enable trigger seo_touch_updated_at`)
      await db.exec(`alter table products disable trigger seo_touch_updated_at; update products set updated_at = '${OLD}'; alter table products enable trigger seo_touch_updated_at`)
      await db.exec(`alter table profiles disable trigger seo_touch_updated_at; update profiles set updated_at = '${OLD}'; alter table profiles enable trigger seo_touch_updated_at`)
      await db.exec(`alter table news disable trigger seo_touch_updated_at; update news set updated_at = '${OLD}'; alter table news enable trigger seo_touch_updated_at`)
      await db.exec(`alter table posts disable trigger seo_touch_updated_at; update posts set updated_at = '${OLD}'; alter table posts enable trigger seo_touch_updated_at`)

      await db.exec(`update businesses set plan = 'pro', payout_code = 'X1' where id = '${BIZ}'`)
      await db.exec(`update products set stock = 7, cost_price = 400 where id = '${PROD}'`) // still in stock
      await db.exec(`update profiles set last_seen_at = now() where id = '${PROFILE}'`)
      await db.exec(`update news set view_count = view_count + 1 where id = '${NEWS}'`)
      await db.exec(`update posts set like_count = like_count + 1 where id = '${POST}'`)
      await db.exec(`update businesses set name = name where id = '${BIZ}'`) // same value
      for (const t of ['businesses', 'products', 'profiles', 'news', 'posts']) {
        const r = await one(`select bool_and(updated_at = $1::timestamptz) ok from ${t}`, [OLD])
        expect(r.ok, t).toBe(true)
      }
    })
  })

  it('a product going out of stock, or back in, counts as a public change', async () => {
    await tx(async () => {
      await db.exec(`alter table products disable trigger seo_touch_updated_at; update products set updated_at = '${OLD}'; alter table products enable trigger seo_touch_updated_at`)
      await db.exec(`update products set stock = 0 where id = '${PROD}'`)
      expect((await one(`select updated_at = now() bumped from products where id = '${PROD}'`)).bumped).toBe(true)
    })
    await tx(async () => {
      await db.exec(`alter table products disable trigger seo_touch_updated_at; update products set stock = 0, updated_at = '${OLD}'; alter table products enable trigger seo_touch_updated_at`)
      await db.exec(`update products set stock = 3 where id = '${PROD}'`)
      expect((await one(`select updated_at = now() bumped from products where id = '${PROD}'`)).bumped).toBe(true)
    })
  })

  it('a client cannot set updated_at itself, in either direction', async () => {
    await tx(async () => {
      await db.exec(`alter table posts disable trigger seo_touch_updated_at; update posts set updated_at = '${OLD}'; alter table posts enable trigger seo_touch_updated_at`)
      await db.exec(`set local role authenticated`)
      await db.exec(`update posts set updated_at = '2099-01-01' where id = '${POST}'`)
      await db.exec(`update posts set updated_at = now() + interval '1 day', content = 'Edited' where id = '${POST}'`)
      await db.exec(`reset role`)
      expect((await one(`select updated_at = now() ok from posts where id = '${POST}'`)).ok).toBe(true)
    })
  })

  it('carefind_products gains updated_at last, keeps its columns, filters and Rx price masking', async () => {
    const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'carefind_products' order by ordinal_position`)).rows.map(r => r.column_name)
    expect(cols.at(-1)).toBe('updated_at')
    expect(cols.slice(0, -1)).toEqual(['id', 'business_id', 'owner_id', 'name', 'generic_name', 'category', 'emoji', 'image_url', 'description',
      'whatsapp', 'sale_type', 'price_unit', 'min_purchase', 'seller_location', 'latitude', 'longitude', 'stock', 'list_on_carefind', 'created_at',
      'rx_status', 'rx_restricted', 'price', 'show_price'])
    await tx(async () => {
      await db.exec(`set local role anon`)
      const rows = (await db.query(`select id, price, show_price, updated_at from carefind_products order by name`)).rows
      await db.exec(`reset role`)
      expect(rows.map(r => r.id)).toEqual([PROD, RX])
      expect(rows[1]).toMatchObject({ price: null, show_price: false })
    })
  })

  it('anon can read updated_at on businesses and profiles, and nothing more than before', async () => {
    await tx(async () => {
      await db.exec(`set local role anon`)
      expect(await one(`select id, updated_at from businesses`)).toHaveProperty('updated_at')
      expect(await one(`select id, updated_at from profiles`)).toHaveProperty('updated_at')
      await expect(db.query(`select email from businesses`)).rejects.toThrow(/permission denied/)
    })
  })

  it('the trigger functions cannot be called by API roles', async () => {
    const r = await one(`select bool_or(has_function_privilege(r, f, 'execute')) any_exec
      from unnest(array['anon','authenticated']) r,
           unnest(array['seo_touch_businesses()','seo_touch_products()','seo_touch_profiles()','seo_touch_news()','seo_touch_posts()']::regprocedure[]) f`)
    expect(r.any_exec).toBe(false)
  })

  it('is idempotent (re-running changes nothing and does not fail)', async () => {
    await db.exec(MIGRATION)
    expect((await one(`select count(*)::int n from pg_trigger where tgname = 'seo_touch_updated_at'`)).n).toBe(5)
  })
})
