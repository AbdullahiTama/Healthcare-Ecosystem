// @vitest-environment node
// Financial audit F-06: a card booking is settled from the amount actually paid, never from a fee
// rounded up to a CareCoin boundary.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 9000).toString(16).padStart(12, '0')}`

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
  // production start state: settle_card_booking exists, service_role only
  await db.exec(`
    create function public.settle_card_booking(p_appointment_id uuid, p_reference text) returns text language sql as $$ select 'old'::text $$;
    revoke all on function public.settle_card_booking(uuid, text) from public, anon, authenticated;
    grant execute on function public.settle_card_booking(uuid, text) to service_role;
  `)
  await db.exec(read('../../../../../supabase/migrations/carefind_20261004_settle_payment_intent.sql'))
  await db.exec(read('../../../../../supabase/migrations/carefind_20261004_settle_card_booking_actual_amount.sql'))
}, 120_000) // PGlite start-up + migrations is slow when many suites run at once

async function appt({ fee, ref = null, status = 'unpaid', business = uid() } = {}) {
  const a = (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada','carefind',$2,$3,$4) returning id`, [business, fee, status, ref])).rows[0]
  return { id: a.id, business }
}
const settle = async (id, ref) => (await db.query('select settle_card_booking($1,$2) r', [id, ref])).rows[0].r
const held = async (b) => Number((await db.query('select held_balance h from business_wallets where business_id = $1', [b])).rows[0]?.h ?? NaN)
const commission = async (ref) => Number((await db.query(`select amount a from platform_transactions where reference = $1`, [ref])).rows[0]?.a ?? NaN)

describe('settle_card_booking settles the actual amount', () => {
  it('N1,500.50 (150050 kobo): business 120040, platform 30010 - NOT 80%/20% of a rounded N1,600', async () => {
    const { id, business } = await appt({ fee: 150050, ref: 'bk_ref_1' })
    expect(await settle(id, 'bk_ref_1')).toBe('ok')
    expect(await held(business)).toBe(120040)
    expect(await commission('bk_ref_1')).toBe(30010)
    expect((await db.query('select payment_status, payment_channel from appointments where id = $1', [id])).rows[0]).toMatchObject({ payment_status: 'paid', payment_channel: 'card' })
  })

  it('an exact coin multiple is unchanged (N1,000 -> 80,000 / 20,000)', async () => {
    const { id, business } = await appt({ fee: 100000, ref: 'bk_ref_2' })
    await settle(id, 'bk_ref_2')
    expect(await held(business)).toBe(80000)
    expect(await commission('bk_ref_2')).toBe(20000)
  })

  it('the business and platform shares always add up to exactly what was paid', async () => {
    for (const fee of [1, 99, 150050, 199999, 200001, 7777777]) {
      const ref = `bk_sum_${fee}`
      const { id, business } = await appt({ fee, ref })
      await settle(id, ref)
      expect((await held(business)) + (await commission(ref))).toBe(fee)
    }
  })

  it('is idempotent: a second settle returns already_paid and credits nothing more', async () => {
    const { id, business } = await appt({ fee: 100000, ref: 'bk_ref_3' })
    expect(await settle(id, 'bk_ref_3')).toBe('ok')
    expect(await settle(id, 'bk_ref_3')).toBe('already_paid')
    expect(await held(business)).toBe(80000)
  })

  it('keeps its refusals: wrong reference, no fee, unknown appointment, refunded', async () => {
    const wrong = await appt({ fee: 100000, ref: 'bk_issued' })
    expect(await settle(wrong.id, 'bk_other')).toBe('reference_mismatch')
    expect(await settle((await appt({ fee: 0 })).id, 'x')).toBe('no_fee')
    expect(await settle(uid(), 'x')).toBe('not_found')
    expect(await settle((await appt({ fee: 100000, status: 'refunded' })).id, 'x')).toBe('already_paid')
    expect(await held(wrong.business)).toBeNaN()
  })

  it('takes the platform share from financial_config', async () => {
    await db.query(`update financial_config set value = 0.10 where key = 'booking_platform_rate'`)
    try {
      const { id, business } = await appt({ fee: 100000, ref: 'bk_ref_cfg' })
      await settle(id, 'bk_ref_cfg')
      expect(await commission('bk_ref_cfg')).toBe(10000)
      expect(await held(business)).toBe(90000)
    } finally {
      await db.query(`update financial_config set value = 0.20 where key = 'booking_platform_rate'`)
    }
  })

  it('stays one function, not callable by client roles', async () => {
    const r = await db.query(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u, has_function_privilege('service_role', p.oid, 'execute') s
                                from pg_proc p where p.proname = 'settle_card_booking'`)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ a: false, u: false, s: true })
  })
})
