// @vitest-environment node
// carehub_20270105_discovery_excludes_rep_accounts on PGlite, with the live businesses columns the function reads.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20270105_discovery_excludes_rep_accounts.sql', import.meta.url)), 'utf8')
let db
const search = async (state, extra = {}) => (await db.query(
  `select discover_facilities_cursor(p_state => $1, p_lga => $2, p_city => $3, p_category => $4, p_limit => 100, p_cursor => '0') r`,
  [state, extra.lga ?? null, extra.city ?? null, extra.category ?? 'all'])).rows[0].r

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create table businesses (id uuid primary key default gen_random_uuid(), name text, business_type text, state text, city text, lga text, area text,
      address text, phone text, latitude double precision, longitude double precision, lat double precision, lng double precision, category text,
      website text, created_at timestamp default now(), parent_business_id uuid, account_kind text not null default 'business', deleted_at timestamptz);
    insert into businesses (name, business_type, state, city, account_kind, deleted_at) values
      ('City Hospital', 'hospital', 'Lagos', 'Ikeja', 'business', null),
      ('Corner Pharmacy', 'pharmacy', 'Lagos', null, 'business', null),
      ('Zenith Pharma · Ada Obi', 'manufacturer_importer', 'Lagos', 'Ikeja', 'rep_account', null),
      ('Closed Clinic', 'clinic', 'Lagos', 'Yaba', 'business', now());
  `)
  await db.exec(MIGRATION)
})

describe('discover_facilities_cursor', () => {
  it('never lists a representative account or a deleted business', async () => {
    const r = await search('Lagos')
    expect(r.total).toBe(2)
    expect(r.rows.map((x) => x.name).sort()).toEqual(['City Hospital', 'Corner Pharmacy'])
  })

  it('filters as before', async () => {
    expect((await search('Lagos', { city: 'Ikeja' })).rows.map((x) => x.name)).toEqual(['City Hospital'])
    expect((await search('Lagos', { category: 'pharmacy' })).rows.map((x) => x.name)).toEqual(['Corner Pharmacy'])
    expect((await search('Kano')).total).toBe(0)
  })
})
