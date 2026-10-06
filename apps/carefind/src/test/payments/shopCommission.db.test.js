// @vitest-environment node
// Owner decision 2026-10-05: the shop commission is 20% flat. Real Postgres (PGlite): the function, the single config row,
// the new terms version, and the guarantee that existing orders keep the commission they were created with.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
let db
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(read('./fixtures/liveSchemaSubset.sql'))
  await db.exec(read('../../../../../supabase/migrations/carefind_20261003_payment_intents_foundation.sql'))
  await db.exec(read('../../../../../supabase/migrations/carefind_20261004_settle_payment_intent.sql'))
  // production start state: the old schedule and the active v2 terms (text exactly as in production: one commission sentence)
  await db.exec(`
    create function public.calculate_shop_commission(p_segment text, p_order_total_kobo integer) returns integer
      language plpgsql immutable security definer set search_path to 'public' as $$
      declare v_rate numeric;
      begin
        if p_segment = 'retail' then v_rate := 0.10; elsif p_segment = 'wholesale' then v_rate := 0.05; elsif p_segment = 'distributor' then v_rate := 0.025;
        else raise exception 'Invalid segment: %', p_segment; end if;
        return round(p_order_total_kobo * v_rate);
      end; $$;
    create table public.ecommerce_terms (
      id uuid primary key default gen_random_uuid(), segment text not null, version text not null, title text not null,
      commission_rate numeric not null, commission_label text not null, content text not null,
      is_active boolean not null default true, updated_at timestamptz not null default now(), unique (segment, version));
    insert into public.ecommerce_terms (segment, version, title, commission_rate, commission_label, content, is_active) values
      ('retail', 'v1', 'Retail v1', 0.10, '10% of sale', 'old v1 text', false),
      ('retail', 'v2', 'Retail Terms', 0.10, '10% commission on each sale', E'Welcome.\\n\\n3. Commission\\nCareFind charges a 10% commission on each applicable sale and pays you the rest.\\n\\n4. Other', true),
      ('wholesale', 'v2', 'Wholesale Terms', 0.05, '5% commission on each sale', E'Welcome.\\n\\n3. Commission\\nCareFind charges a 5% commission on each applicable sale and pays you the rest.', true),
      ('distributor', 'v2', 'Distributor Terms', 0.025, '2.5% commission on each sale', E'Welcome.\\n\\n3. Commission\\nCareFind charges a 2.5% commission on each applicable sale and pays you the rest.', true);
    -- an existing order created at the old rate
    create table if not exists public.zz_old_order (id int, commission_kobo int);
    insert into public.zz_old_order values (1, 50000);
  `)
  await db.exec(read('../../../../../supabase/migrations/carefind_20261011_shop_commission_flat.sql'))
}, 120_000)

describe('shop commission is 20% flat', () => {
  it('every segment pays 20% of the subtotal, rounded to the kobo', async () => {
    for (const [seg, total, expected] of [['retail', 500000, 100000], ['wholesale', 1000000, 200000], ['distributor', 2000000, 400000], ['retail', 333, 67], ['retail', 0, 0]]) {
      expect((await one('select calculate_shop_commission($1,$2) c', [seg, total])).c).toBe(expected)
    }
  })

  it('an unknown or missing segment is still refused', async () => {
    await expect(db.query("select calculate_shop_commission('manufacturer', 1000)")).rejects.toThrow(/Invalid segment/)
    await expect(db.query('select calculate_shop_commission(null, 1000)')).rejects.toThrow(/Invalid segment/)
  })

  it('the rate is one config row and changing it changes the result (the function reads it, it is no longer immutable)', async () => {
    expect(Number((await one("select value from financial_config where key = 'shop_commission_rate'")).value)).toBe(0.2)
    await db.query("update financial_config set value = 0.15 where key = 'shop_commission_rate'")
    try { expect((await one("select calculate_shop_commission('retail', 100000) c")).c).toBe(15000) }
    finally { await db.query("update financial_config set value = 0.20 where key = 'shop_commission_rate'") }
    expect((await one("select provolatile v from pg_proc where proname = 'calculate_shop_commission'")).v).toBe('s')
  })

  it('existing orders keep the commission they were created with (it is stored, never recomputed)', async () => {
    expect((await one('select commission_kobo c from zz_old_order where id = 1')).c).toBe(50000)
  })
})

describe('terms v3', () => {
  it('v3 is the single ACTIVE version for each segment, at 20%, and v1/v2 stay as the record', async () => {
    const rows = await all('select segment, version, is_active, commission_rate::float r, commission_label from ecommerce_terms order by segment, version')
    for (const seg of ['retail', 'wholesale', 'distributor']) {
      const mine = rows.filter((r) => r.segment === seg)
      expect(mine.filter((r) => r.is_active)).toEqual([expect.objectContaining({ version: 'v3', r: 0.2, commission_label: '20% commission on each sale' })])
      expect(mine.some((r) => r.version === 'v2' && !r.is_active)).toBe(true)
    }
    expect(rows.find((r) => r.segment === 'retail' && r.version === 'v1')).toBeTruthy()
  })

  it('the v3 text is v2\'s with ONLY the commission sentence changed', async () => {
    for (const [seg, old] of [['retail', '10%'], ['wholesale', '5%'], ['distributor', '2.5%']]) {
      const v2 = (await one('select content from ecommerce_terms where segment = $1 and version = $2', [seg, 'v2'])).content
      const v3 = (await one('select content from ecommerce_terms where segment = $1 and version = $2', [seg, 'v3'])).content
      expect(v3).toBe(v2.replace(`CareFind charges a ${old} commission`, 'CareFind charges a 20% commission'))
      expect(v3).toContain('CareFind charges a 20% commission on each applicable sale')
    }
  })

  it('re-running the terms step does not duplicate v3', async () => {
    const before = (await one("select count(*)::int c from ecommerce_terms where version = 'v3'")).c
    await db.exec(read('../../../../../supabase/migrations/carefind_20261011_shop_commission_flat.sql'))
    expect((await one("select count(*)::int c from ecommerce_terms where version = 'v3'")).c).toBe(before)
  })
})
