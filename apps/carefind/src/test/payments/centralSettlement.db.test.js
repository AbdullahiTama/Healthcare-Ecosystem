// @vitest-environment node
// Phase 10 (database): ONE settlement engine. The shop joins settle_payment_intent; the second definitions
// (verify_shop_payment, claim_payment_event, settle_card_booking) are gone; the per-purpose money primitives are
// engine internals that no API role can call. Real Postgres (PGlite), every migration in production order.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 150000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_abcdefgh`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(read('./fixtures/liveSchemaSubset.sql'))
  // production start state: the legacy shop settlement functions exist and are callable by service_role / signed-in users
  await db.exec(`
    create function public.verify_shop_payment(p_order_id uuid, p_paystack_reference text) returns text language sql as $$ select 'ok'::text $$;
    create function public.claim_payment_event(p_order_id uuid, p_payment_reference text, p_event_type text default 'charge.success', p_amount_kobo integer default null, p_metadata jsonb default '{}'::jsonb) returns text language sql as $$ select 'ok'::text $$;
    create function public.settle_card_booking(p_appointment_id uuid, p_reference text) returns text language sql as $$ select 'old'::text $$;
    revoke all on function public.verify_shop_payment(uuid, text) from public, anon, authenticated;
    grant execute on function public.verify_shop_payment(uuid, text) to service_role;
    revoke all on function public.claim_payment_event(uuid, text, text, integer, jsonb) from public, anon;
    grant execute on function public.claim_payment_event(uuid, text, text, integer, jsonb) to authenticated, service_role;
  `)
  await db.exec(M('carefind_20261003_payment_intents_foundation'))
  await db.exec(M('carefind_20261004_settle_payment_intent'))
  await db.exec(M('carefind_20261005_coin_ledger'))
  await createLegacyStubs(db)
  await db.exec(M('carefind_20261005_coin_writers_use_ledger'))
  await db.exec(M('carefind_20261005_lock_wallets_to_ledger'))
  await db.exec(M('carefind_20261006_settle_plan_and_carehub_appointments'))
  await db.exec(M('carefind_20261007_commission_engine'))
  await db.exec(M('carefind_20261009_refund_engine'))
  await db.exec(M('carefind_20261010_central_settlement'))
}, 180_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }

const FEE = 2_500_000 // N25,000 order
const shopOrder = async (over = {}) => {
  const o = { customer: uid(), vendor: uid(), total: FEE, status: 'pending_payment', ...over }
  const row = (await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, total_kobo, subtotal_kobo) values ($1,$2,$3,$4,$5,$5) returning id`, [ref('CF'), o.customer, o.vendor, o.status, o.total])).rows[0]
  return { id: row.id, customer: o.customer, vendor: o.vendor, total: o.total }
}
// the intent as initiate-shop-payment records it BEFORE checkout, plus the pending attempt in the ledger
const shopIntent = async (o, over = {}) => {
  const reference = over.reference || ref('cf_shop')
  const i = (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, metadata)
    values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,$5,'{}'::jsonb) returning *`, [reference, over.customer ?? o.customer, over.vendor ?? o.vendor, o.id, over.expected ?? o.total])).rows[0]
  await db.query(`insert into shop_payments (order_id, payment_reference, amount_kobo, status) values ($1,$2,$3,'pending')`, [o.id, reference, o.total])
  return i
}
const settle = async (i, over = {}) => {
  const a = { txn: `T${i.reference}`, amount: i.expected_amount, ...over }
  return (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [i.reference, 'paystack', a.txn, a.amount, 'NGN'])).r
}
const order = (id) => one('select status, payment_status, paystack_reference from shop_orders where id = $1', [id])

describe('shop orders settle through the engine', () => {
  it('a valid payment: the order is paid, the attempt ledger, history and customer notice are written in one step', async () => {
    const o = await shopOrder(); const i = await shopIntent(o)
    const r = await settle(i)
    expect(r).toMatchObject({ outcome: 'settled', purpose: 'shop_order', order_id: o.id, vendor_business_id: o.vendor, total_kobo: FEE })
    expect(await order(o.id)).toMatchObject({ status: 'paid', payment_status: 'paid', paystack_reference: i.reference })
    expect(await one('select status from shop_payments where payment_reference = $1', [i.reference])).toMatchObject({ status: 'success' })
    expect(await one('select from_status, to_status, note from shop_order_status_history where order_id = $1', [o.id])).toMatchObject({ from_status: 'pending_payment', to_status: 'paid' })
    expect(await one('select recipient_id, type from notifications where recipient_id = $1', [o.customer])).toMatchObject({ type: 'shop_payment' })
    expect((await one('select status from payment_intents where id = $1', [i.id])).status).toBe('settled')
  })

  it('replays are harmless: one history row, one notice, the second call is already_settled', async () => {
    const o = await shopOrder(); const i = await shopIntent(o)
    await settle(i)
    expect((await settle(i)).outcome).toBe('already_settled')
    expect(await all('select 1 from shop_order_status_history where order_id = $1', [o.id])).toHaveLength(1)
    expect(await all('select 1 from notifications where recipient_id = $1', [o.customer])).toHaveLength(1)
  })

  it('a payment for a different amount than the intent is parked as needs_refund and the order is untouched', async () => {
    const o = await shopOrder(); const i = await shopIntent(o)
    const r = await settle(i, { amount: FEE - 1000 })
    expect(r).toMatchObject({ outcome: 'needs_refund', reason: 'amount_mismatch' })
    expect(await order(o.id)).toMatchObject({ status: 'pending_payment', payment_status: 'pending' })
    expect(await all('select 1 from shop_order_status_history where order_id = $1', [o.id])).toHaveLength(0)
  })

  it('refuses an intent whose customer or vendor is not the order\'s (a payer cannot settle someone else\'s order)', async () => {
    const o = await shopOrder()
    expect((await settle(await shopIntent(o, { customer: uid() }))).reason).toBe('customer_mismatch')
    expect((await settle(await shopIntent(o, { vendor: uid() }))).reason).toBe('business_mismatch')
    expect(await order(o.id)).toMatchObject({ status: 'pending_payment' })
  })

  it('an order that was repriced after the intent (delivery quote) is not settled for the old amount', async () => {
    const o = await shopOrder(); const i = await shopIntent(o)
    await db.query('update shop_orders set total_kobo = $2 where id = $1', [o.id, FEE + 50_000])
    expect(await settle(i)).toMatchObject({ outcome: 'needs_refund', reason: 'amount_changed' })
    expect(await order(o.id)).toMatchObject({ status: 'pending_payment' })
  })

  it('an order that is no longer payable (cancelled, already progressed) is not paid', async () => {
    for (const status of ['cancelled', 'accepted', 'delivered']) {
      const o = await shopOrder({ status }); const i = await shopIntent(o)
      expect(await settle(i)).toMatchObject({ outcome: 'needs_refund', reason: 'order_not_payable' })
      expect((await order(o.id)).status).toBe(status)
    }
  })

  it('a delivery-quote order can be paid once quoted', async () => {
    const o = await shopOrder({ status: 'delivery_quote_pending' }); const i = await shopIntent(o)
    expect((await settle(i)).outcome).toBe('settled')
    expect(await one('select from_status from shop_order_status_history where order_id = $1', [o.id])).toMatchObject({ from_status: 'delivery_quote_pending' })
  })

  it('a retried payment: a late success on the earlier attempt settles the order and closes the other attempt; paying the newer one then needs a refund', async () => {
    const o = await shopOrder()
    const first = await shopIntent(o)
    await db.query("update shop_payments set status = 'failed' where payment_reference = $1", [first.reference])   // closed by the retry
    const second = await shopIntent(o)
    expect((await settle(first)).outcome).toBe('settled')                                                       // the first one was paid after all
    expect(await one('select status from shop_payments where payment_reference = $1', [second.reference])).toMatchObject({ status: 'failed' })
    expect(await settle(second)).toMatchObject({ outcome: 'needs_refund', reason: 'already_paid' })              // double payment: parked, never dropped
    const intent = await one('select id from payment_intents where reference = $1', [second.reference])
    expect((await one(`select request_refund('needs_refund_intent','payment_intent',$1) r`, [intent.id])).r).toMatchObject({ outcome: 'requested', amount_kobo: FEE })
  })

  it('an intent with no entity or the wrong entity type is declined, never half-applied', async () => {
    const o = await shopOrder()
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, expected_amount) values ($1,'carefind','shop_order',$2,$3,$4) returning *`, [ref('cf_shop'), o.customer, o.vendor, FEE])).rows[0]
    expect(await settle(i)).toMatchObject({ outcome: 'needs_refund', reason: 'invalid_shop_intent' })
  })
})

describe('there is one definition of settlement', () => {
  it('the legacy settlement functions are gone', async () => {
    expect(await all("select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('verify_shop_payment','claim_payment_event','settle_card_booking','settle_shop_payment')")).toEqual([])
  })

  it('claim_payment_event is no longer reachable by a signed-in user (F-28)', async () => {
    await asRole('authenticated', async () => {
      await expect(db.query(`select claim_payment_event(gen_random_uuid(), 'x')`)).rejects.toThrow(/does not exist|permission denied/)
    })
  })

  it('the per-purpose money primitives are engine internals: no API role can call them', async () => {
    const calls = [
      `select credit_wallet_topup(gen_random_uuid(), 5, 1000, 'r1')`,
      `select * from settle_subscription_payment(gen_random_uuid(), gen_random_uuid(), 5, 1000, 'r2')`,
      `select * from settle_consultation_payment(gen_random_uuid(), gen_random_uuid(), 10, 'r3')`,
      `select * from renew_business_plan(gen_random_uuid(), 1, 5000, 'r4')`,
      `select fn_credit_business_booking(gen_random_uuid(), gen_random_uuid(), 100000, 20000, 'r5')`,
    ]
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const sql of calls) await asRole(role, async () => { await expect(db.query(sql)).rejects.toThrow(/permission denied/) })
    }
  })

  it('the engine itself is still service_role only, there is exactly one, and every purpose still settles through it (the handlers keep working without the revoked grants)', async () => {
    expect((await all("select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'settle_payment_intent'")).length).toBe(1)
    for (const role of ['anon', 'authenticated']) {
      await asRole(role, async () => { await expect(db.query(`select settle_payment_intent('x','paystack','t',1,'NGN')`)).rejects.toThrow(/permission denied/) })
    }
    // wallet top-up, a CareHub plan renewal and a card booking, each settled as service_role through the engine
    const u = uid()
    await db.query('insert into auth.users (id) values ($1)', [u])
    const topup = (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, expected_amount, metadata) values ($1,'carefind','wallet_topup',$2,500000,'{"coins":25}'::jsonb) returning *`, [ref('cf_topup'), u])).rows[0]
    const b = uid()
    await db.query('insert into businesses (id, name) values ($1,$2)', [b, 'Clinic'])
    const plan = (await db.query(`insert into payment_intents (reference, application, purpose, business_id, expected_amount, metadata) values ($1,'carehub','plan_renewal',$2,500000,'{"months":1}'::jsonb) returning *`, [ref('ch_plan'), b])).rows[0]
    const appt = (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada','carehub',1000000,'unpaid',$2) returning id`, [b, ref('x')])).rows[0]
    const book = (await db.query(`insert into payment_intents (reference, application, purpose, business_id, entity_type, entity_id, expected_amount) values ($1,'carehub','appointment',$2,'appointment',$3,1000000) returning *`, [ref('ch_appt'), b, appt.id])).rows[0]
    for (const i of [topup, plan, book]) {
      const r = await asRole('service_role', () => settle(i))
      expect(r.outcome, i.purpose).toBe('settled')
    }
  })
})
