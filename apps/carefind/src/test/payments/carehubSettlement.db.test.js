// @vitest-environment node
// Phase 06 (database): CareHub plan payments and CareHub appointments settle through the same engine as
// CareFind. Real Postgres (PGlite), the real migrations, a replica of the live tables, and the production
// renew_business_plan(). Card money stays in kobo; nothing here touches CareCoins.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 70000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_abcdefgh`
const DAY = 86400e3

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
  await db.exec(read('../../../../../supabase/migrations/carefind_20261006_settle_plan_and_carehub_appointments.sql'))
}, 120_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const business = async (planExpiresInDays = null) => {
  const id = uid()
  await db.query('insert into businesses (id, name, plan_expires_at) values ($1,$2,$3)', [id, 'Clinic', planExpiresInDays == null ? null : new Date(Date.now() + planExpiresInDays * DAY).toISOString()])
  return id
}
const intent = async (over = {}) => {
  const r = { reference: ref('ch'), purpose: 'plan_renewal', business_id: null, entity_type: null, entity_id: null, expected_amount: 500000, metadata: { months: 1 }, ...over }
  return (await db.query(
    `insert into payment_intents (reference, application, purpose, business_id, entity_type, entity_id, expected_amount, metadata)
     values ($1,'carehub',$2,$3,$4,$5,$6,$7::jsonb) returning *`,
    [r.reference, r.purpose, r.business_id, r.entity_type, r.entity_id, r.expected_amount, JSON.stringify(r.metadata)])).rows[0]
}
const settle = async (i, over = {}) => {
  const a = { txn: `T${i.reference}`, amount: i.expected_amount, ...over }
  return (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [i.reference, 'paystack', a.txn, a.amount, 'NGN'])).r
}
const expiry = async (b) => new Date((await one('select plan_expires_at e from businesses where id = $1', [b])).e).getTime()
const payments = async (b) => (await db.query('select * from plan_payments where business_id = $1 order by created_at, id', [b])).rows

describe('plan renewal (CareHub card payment)', () => {
  it('settles a one-month plan: payment row in NAIRA from the kobo paid, expiry extended, first payment flagged', async () => {
    const b = await business()
    const r = await settle(await intent({ business_id: b, expected_amount: 500000, metadata: { months: 1 } }))
    expect(r).toMatchObject({ outcome: 'settled', purpose: 'plan_renewal', months: 1, is_first_payment: true })
    const rows = await payments(b)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ months: 1, naira_amount: 5000, status: 'success', is_first_payment: true })
    const e = await expiry(b)
    expect(e).toBeGreaterThan(Date.now() + 27 * DAY)
    expect(e).toBeLessThan(Date.now() + 32 * DAY)
    expect(new Date(r.new_expiry).getTime()).toBe(e)
  })

  it('the annual option extends twelve months', async () => {
    const b = await business()
    await settle(await intent({ business_id: b, expected_amount: 6000000, metadata: { months: 12 } }))
    expect(await expiry(b)).toBeGreaterThan(Date.now() + 360 * DAY)
    expect((await payments(b))[0].naira_amount).toBe(60000)
  })

  it('a renewal extends from the current expiry (not from today); an expired plan restarts from today', async () => {
    const live = await business(20)
    await settle(await intent({ business_id: live, metadata: { months: 1 } }))
    expect(await expiry(live)).toBeGreaterThan(Date.now() + 49 * DAY)
    const lapsed = await business(-40)
    await settle(await intent({ business_id: lapsed, metadata: { months: 1 } }))
    const e = await expiry(lapsed)
    expect(e).toBeGreaterThan(Date.now() + 27 * DAY)
    expect(e).toBeLessThan(Date.now() + 32 * DAY)
  })

  it('only the FIRST payment of a business is flagged as the first', async () => {
    const b = await business()
    expect((await settle(await intent({ business_id: b }))).is_first_payment).toBe(true)
    expect((await settle(await intent({ business_id: b }))).is_first_payment).toBe(false)
    expect((await payments(b)).map((p) => p.is_first_payment)).toEqual([true, false])
  })

  it('a replay (webhook after redirect) renews once: one payment row, expiry unchanged', async () => {
    const b = await business()
    const i = await intent({ business_id: b })
    expect((await settle(i)).outcome).toBe('settled')
    const after = await expiry(b)
    expect((await settle(i)).outcome).toBe('already_settled')
    expect((await settle(i, { txn: 'OTHER' })).outcome).toBe('already_settled')
    expect(await payments(b)).toHaveLength(1)
    expect(await expiry(b)).toBe(after)
  })

  it.each([
    ['less than the plan price', { amount: 499999 }, 'amount_mismatch'],
    ['more than the plan price', { amount: 500001 }, 'amount_mismatch'],
    ['another currency', { currency: 'USD' }, 'currency_mismatch'],
  ])('a payment of %s is parked as needs_refund and renews nothing', async (_l, over, reason) => {
    const b = await business()
    const i = await intent({ business_id: b })
    const a = { txn: `T${i.reference}`, amount: i.expected_amount, currency: 'NGN', ...over }
    const r = (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [i.reference, 'paystack', a.txn, a.amount, a.currency])).r
    expect(r).toMatchObject({ outcome: 'needs_refund', reason })
    expect(await payments(b)).toHaveLength(0)
    expect((await one('select plan_expires_at e from businesses where id = $1', [b])).e).toBeNull()
  })

  it.each([
    ['3 months (no such option)', { metadata: { months: 3 } }],
    ['no months', { metadata: {} }],
    ['non-numeric months', { metadata: { months: 'lots' } }],
    ['an amount that is not whole naira', { expected_amount: 500050 }],
  ])('refuses an intent with %s: needs_refund(invalid_plan_intent), nothing renewed', async (_l, over) => {
    const b = await business()
    const r = await settle(await intent({ business_id: b, ...over }))
    expect(r).toMatchObject({ outcome: 'needs_refund', reason: 'invalid_plan_intent' })
    expect(await payments(b)).toHaveLength(0)
  })

  it('refuses an intent with no business and one for a business that does not exist', async () => {
    expect((await settle(await intent({ business_id: null }))).reason).toBe('invalid_plan_intent')
    expect((await settle(await intent({ business_id: uid() }))).reason).toBe('business_missing')
  })

  it('a reference already claimed by the legacy webhook path is not renewed twice', async () => {
    const b = await business()
    const i = await intent({ business_id: b })
    await db.query(`select * from renew_business_plan($1, 1, 5000, $2)`, [b, i.reference]) // the old path got there first
    const after = await expiry(b)
    expect(await settle(i)).toMatchObject({ outcome: 'needs_refund', reason: 'reference_already_used' })
    expect(await payments(b)).toHaveLength(1)
    expect(await expiry(b)).toBe(after)
  })

  it('two different plan payments for one business stack: two months, two payment rows', async () => {
    const b = await business()
    await settle(await intent({ business_id: b }))
    await settle(await intent({ business_id: b }))
    expect(await payments(b)).toHaveLength(2)
    expect(await expiry(b)).toBeGreaterThan(Date.now() + 57 * DAY)
  })
})

describe('CareHub appointment (card)', () => {
  const appt = async ({ fee = 150050, business = uid(), status = 'unpaid', source = 'carehub' } = {}) => {
    const a = (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada',$2,$3,$4,$5) returning id`, [business, source, fee, status, ref('appt')])).rows[0]
    return { id: a.id, business }
  }
  const held = async (b) => Number((await one('select held_balance h from business_wallets where business_id = $1', [b])).h)
  const aIntent = async (a, over = {}) => intent({ purpose: 'appointment', business_id: a.business, entity_type: 'appointment', entity_id: a.id, expected_amount: 150050, metadata: {}, ...over })

  it('credits the business from the ACTUAL kobo paid (a fee that is not a coin multiple is not rounded): 120,040 held, 30,010 platform', async () => {
    const a = await appt()
    const r = await settle(await aIntent(a))
    expect(r).toMatchObject({ outcome: 'settled', purpose: 'appointment', business_kobo: 120040, platform_kobo: 30010 })
    expect(await held(a.business)).toBe(120040)
    expect(await one('select payment_status, payment_channel from appointments where id = $1', [a.id])).toMatchObject({ payment_status: 'paid', payment_channel: 'card' })
    expect((await db.query('select 1 from wallets')).rows).toHaveLength(0) // no CareCoin wallet involved at all
  })

  it('a replay settles once', async () => {
    const a = await appt({ fee: 100000 })
    const i = await aIntent(a, { expected_amount: 100000 })
    await settle(i); await settle(i)
    expect(await held(a.business)).toBe(80000)
  })

  it('an appointment already paid (e.g. at the POS) keeps its state; the card payment is needs_refund', async () => {
    const a = await appt({ fee: 100000, status: 'paid' })
    expect(await settle(await aIntent(a, { expected_amount: 100000 }))).toMatchObject({ outcome: 'needs_refund', reason: 'already_paid' })
    expect((await db.query('select 1 from business_wallets where business_id = $1', [a.business])).rows).toHaveLength(0)
  })

  it('refuses an intent whose business is not the appointment\'s, and a fee changed after the intent', async () => {
    const a = await appt({ fee: 100000 })
    expect((await settle(await aIntent(a, { business_id: uid(), expected_amount: 100000 }))).reason).toBe('business_mismatch')
    const b = await appt({ fee: 100000 })
    await db.query('update appointments set fee_amount = 1 where id = $1', [b.id])
    expect((await settle(await aIntent(b, { expected_amount: 100000 }))).reason).toBe('fee_changed')
  })
})

describe('what the engine still refuses, and who may call it', () => {
  it('shop orders still raise (not settled by the engine yet) and roll back', async () => {
    const i = await intent({ purpose: 'shop_order', metadata: {} })
    await expect(settle(i)).rejects.toThrow(/not settled by the engine yet/)
    expect((await one('select status from payment_intents where id = $1', [i.id])).status).toBe('created')
  })

  it('the plan handler is private; the engine is service_role only; there is one engine function', async () => {
    const r = await db.query(`select p.proname, has_function_privilege('anon', p.oid,'execute') a, has_function_privilege('authenticated', p.oid,'execute') u, has_function_privilege('service_role', p.oid,'execute') s from pg_proc p where p.proname in ('_settle_plan_renewal','settle_payment_intent')`)
    const by = Object.fromEntries(r.rows.map((x) => [x.proname, x]))
    expect(r.rows).toHaveLength(2)
    expect(by._settle_plan_renewal).toMatchObject({ a: false, u: false, s: false })
    expect(by.settle_payment_intent).toMatchObject({ a: false, u: false, s: true })
  })
})
