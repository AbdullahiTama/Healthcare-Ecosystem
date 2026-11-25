// @vitest-environment node
// carefind_20270207_nearby_product_search on PGlite: medicine search ranked by match strength, availability and
// distance over EVERY match (the app used to fetch the 100 newest and sort only those). Runs as anon (a guest) over
// the live carefind_products view; the ordering is checked against the app's own rule (src/lib/nearbyRanking.js).
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rankProducts } from '../../lib/nearbyRanking.js'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carefind_20270207_nearby_product_search.sql', import.meta.url)), 'utf8')

const USER = { lat: 6.5095, lng: 3.3711 } // Yaba, Lagos
const BIZ = {
  yaba: ['b0000000-0000-4000-8000-000000000001', 6.5140, 3.3720, true],
  ikeja: ['b0000000-0000-4000-8000-000000000002', 6.6018, 3.3515, true],
  lekki: ['b0000000-0000-4000-8000-000000000003', 6.4474, 3.5440, true],
  hidden: ['b0000000-0000-4000-8000-000000000004', 6.5100, 3.3712, false], // hidden from the public: no coordinates
  nowhere: ['b0000000-0000-4000-8000-000000000005', null, null, true],
}
const pid = (n) => 'c0000000-0000-4000-8000-' + String(n).padStart(12, '0')

let db
async function asAnon(sql, params = []) {
  await db.exec('begin')
  try {
    await db.exec('set local role anon')
    return { rows: (await db.query(sql, params)).rows }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const search = async (q, lat = null, lng = null, saleType = null, limit = 100) => {
  const r = await asAnon('select id, distance_m, match_rank from search_carefind_products($1, $2, $3, $4, $5)', [q, lat, lng, saleType, limit])
  if (r.error) throw new Error(r.error)
  return r.rows
}

// Products: [n, name, generic, category, stock, business key, created_at, sale_type, listed, rx_status, price]
const PRODUCTS = [
  [1, 'Paracetamol 500mg', 'Paracetamol', 'Medicines', 20, 'lekki', '2026-11-20', 'retail'],
  [2, 'Paracetamol 500mg', 'Paracetamol', 'Medicines', 5, 'ikeja', '2026-01-01', 'retail'],
  [3, 'Paracetamol 500mg', 'Paracetamol', 'Medicines', 0, 'yaba', '2026-11-24', 'retail'], // nearest but out of stock
  [4, 'Emzor Paracetamol', '', 'Medicines', 9, 'yaba', '2026-02-01', 'wholesale'], // nearest, "contains"
  [5, 'Vitamin C', 'Ascorbic acid', 'Paracetamol & pain', 9, 'yaba', '2026-03-01', 'retail'], // category-only match
  [6, 'Paracetamol syrup', 'Paracetamol', 'Medicines', 4, 'hidden', '2026-04-01', 'retail'],
  [7, 'Paracetamol 1g', 'Paracetamol', 'Medicines', 4, 'nowhere', '2026-05-01', 'retail'],
  [8, 'Unlisted Paracetamol', 'Paracetamol', 'Medicines', 4, 'yaba', '2026-05-01', 'retail', false],
  [9, '100% Pure_Glycerin', '', 'Skincare', 4, 'yaba', '2026-05-01', 'retail'],
  [10, 'Ibuprofen 400mg', 'Ibuprofen', 'Medicines', 30, 'yaba', '2026-06-01', 'retail'],
]

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    CREATE OR REPLACE FUNCTION public.is_rx_restricted(p_rx_status text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $function$
      select coalesce(p_rx_status, '') in ('prescription_only', 'controlled')
    $function$;
    CREATE OR REPLACE FUNCTION public.is_carefind_unpriced(p_rx_status text, p_price numeric) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp' AS $function$
      select not public.is_rx_restricted(p_rx_status) and coalesce(p_price, 0) <= 0
    $function$;
    create table businesses (id uuid primary key, name text, lat numeric, lng numeric, latitude double precision, longitude double precision, visible_on_carefind boolean);
    alter table businesses enable row level security;
    create policy "public sees visible businesses" on businesses for select to public using (visible_on_carefind);
    grant select on businesses to anon, authenticated;
    create table products (id uuid primary key, business_id uuid, owner_id uuid, name text, generic_name text, category text,
      emoji text, image_url text, description text, whatsapp text, sale_type text, price_unit text, min_purchase integer,
      seller_location text, latitude double precision, longitude double precision, price numeric, cost_price numeric,
      stock integer, reorder_level integer, rx_status text, show_price boolean default true, list_on_carefind boolean default true,
      created_at timestamp default now(), updated_at timestamptz default now());
    CREATE VIEW public.carefind_products AS SELECT id, business_id, owner_id, name, generic_name, category, emoji, image_url,
      description, whatsapp, sale_type, price_unit, min_purchase, seller_location, latitude, longitude, stock, list_on_carefind,
      created_at, rx_status, is_rx_restricted(rx_status) AS rx_restricted,
      CASE WHEN is_rx_restricted(rx_status) THEN NULL::numeric ELSE price END AS price,
      CASE WHEN is_rx_restricted(rx_status) THEN false ELSE show_price END AS show_price, updated_at
      FROM products p WHERE list_on_carefind = true AND NOT is_carefind_unpriced(rx_status, price);
    grant select on carefind_products to anon, authenticated;
  `)
  for (const [key, [id, lat, lng, visible]] of Object.entries(BIZ)) {
    await db.query('insert into businesses (id, name, lat, lng, visible_on_carefind) values ($1, $2, $3, $4, $5)', [id, key, lat, lng, visible])
  }
  for (const [n, name, generic, category, stock, biz, created, saleType, listed = true] of PRODUCTS) {
    await db.query(`insert into products (id, business_id, name, generic_name, category, stock, created_at, sale_type, list_on_carefind, price)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 500)`, [pid(n), BIZ[biz][0], name, generic, category, stock, created, saleType, listed])
  }
  await db.exec(MIGRATION)
})

const ids = (rows) => rows.map((r) => r.id)

describe('search_carefind_products', () => {
  it('ranks name matches by availability then distance; category-only matches after them', async () => {
    const rows = await search('paracetamol', USER.lat, USER.lng)
    expect(ids(rows)).toEqual([
      pid(4), // Yaba, in stock (contains "paracetamol"): nearest
      pid(2), // Ikeja
      pid(1), // Lekki
      pid(7), // business with no coordinates (location unknown; newer of the two)
      pid(6), // business hidden from guests: location unknown
      pid(3), // Yaba but out of stock
      pid(5), // category-only match
    ])
  })

  it('matches the app\'s own ranking rule exactly', async () => {
    const rows = await search('paracetamol', USER.lat, USER.lng)
    const visible = new Set(Object.values(BIZ).filter((b) => b[3]).map((b) => b[0]))
    const fixture = PRODUCTS.filter((p) => p[8] !== false).map(([n, name, generic, category, stock, biz, created]) => ({
      id: pid(n), name, generic_name: generic, category, stock, created_at: created,
      coords: visible.has(BIZ[biz][0]) && BIZ[biz][1] != null ? { lat: BIZ[biz][1], lng: BIZ[biz][2] } : null,
    })).filter((r) => [r.name, r.generic_name, r.category].some((t) => String(t).toLowerCase().includes('paracetamol')))
    const app = rankProducts(fixture, { query: 'paracetamol', userCoords: USER, pick: (r) => ({ name: r.name, genericName: r.generic_name, category: r.category, stock: r.stock, coords: r.coords, createdAt: r.created_at }) })
    expect(ids(rows)).toEqual(ids(app))
  })

  it('returns distances in metres, null where unknown', async () => {
    const rows = await search('paracetamol', USER.lat, USER.lng)
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.distance_m]))
    expect(byId[pid(4)]).toBeGreaterThan(300)
    expect(byId[pid(4)]).toBeLessThan(800)
    expect(byId[pid(2)]).toBeGreaterThan(9000)
    expect(byId[pid(6)]).toBeNull()
    expect(byId[pid(7)]).toBeNull()
  })

  it('without a location: relevance, availability, then newest', async () => {
    const rows = await search('paracetamol')
    // Starts-with matches by date (1, 7, 6, 2), then the "contains" match (4), then out of stock, then category only.
    expect(ids(rows)).toEqual([pid(1), pid(7), pid(6), pid(2), pid(4), pid(3), pid(5)])
    expect(rows.every((r) => r.distance_m === null)).toBe(true)
  })

  it('ignores an impossible location rather than failing', async () => {
    expect(ids(await search('paracetamol', 200, 3))).toEqual(ids(await search('paracetamol')))
  })

  it('never returns unlisted products', async () => {
    expect(ids(await search('unlisted'))).toEqual([])
  })

  it('matches the query literally: LIKE wildcards and filter syntax are plain text', async () => {
    expect(ids(await search('100%'))).toEqual([pid(9)])
    expect(ids(await search('pure_g'))).toEqual([pid(9)])
    expect(ids(await search('%'))).toEqual([pid(9)])
    expect(await search('a,b),name.eq.x')).toEqual([])
  })

  it('filters by sale type, and treats "all" as no filter', async () => {
    expect(ids(await search('paracetamol', null, null, 'wholesale'))).toEqual([pid(4)])
    expect((await search('paracetamol', null, null, 'all')).length).toBe(7)
  })

  it('an empty search lists everything listed, nearest in-stock first', async () => {
    const rows = await search('', USER.lat, USER.lng)
    expect(rows).toHaveLength(9)
    expect([pid(4), pid(5), pid(9), pid(10)]).toContain(rows[0].id)
  })

  it('clamps the limit to 1..200', async () => {
    expect(await search('paracetamol', null, null, null, 2)).toHaveLength(2)
    expect(await search('paracetamol', null, null, null, 0)).toHaveLength(1)
    expect((await search('', null, null, null, 100000)).length).toBe(9)
  })

  it('is safe to apply twice', async () => {
    await db.exec(MIGRATION)
    expect((await search('paracetamol')).length).toBe(7)
  })
})
