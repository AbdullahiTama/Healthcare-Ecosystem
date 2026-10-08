// @vitest-environment node
// Phase 16 (database): wallet spend through the settlement engine.
// New purposes business_wallet_topup / booking_wallet / subscription_wallet /
// consultation_wallet / shop_order_wallet / plan_renewal_wallet / appointment_fee_wallet
// settle via the ONE engine. Real Postgres (PGlite), production-order migrations.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 190000).toString(16).padStart(12, '0')}`
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
  await db.exec(`
    create function public.verify_shop_payment(p_order_id uuid, p_paystack_reference text) returns text language sql as $$ select 'ok'::text $$;
    create function public.claim_payment_event(p_order_id uuid, p_payment_reference text, p_event_type text default 'charge.success', p_amount_kobo integer default null, p_metadata jsonb default '{}'::jsonb) returns text language sql as $$ select 'ok'::text $$;
    create function public.settle_card_booking(p_appointment_id uuid, p_reference text) returns text language sql as $$ select 'old'::text $$;
    revoke all on function public.verify_shop_payment(uuid, text) from public, anon, authenticated;
    revoke all on function public.claim_payment_event(uuid, text, text, integer, jsonb) from public, anon;
    revoke all on function public.settle_card_booking(uuid, text) from public, anon, authenticated;
    grant execute on function public.verify_shop_payment(uuid, text) to service_role;
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
  await db.exec(M('carefind_20261020_wallet_spend_and_topup'))
}, 180_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const settle = async (i, over = {}) => {
  const a = { txn: `T${i.reference}`, amount: i.expected_amount, ...over }
  return (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [i.reference, i.provider, a.txn, a.amount, 'NGN'])).r
}

describe('business_wallet_topup', () => {
  it('credits the business wallet once; a replay settles again without double-credit', async () => {
    const b = uid()
    await db.query('insert into businesses (id) values ($1)', [b])
    await db.query('insert into business_wallets (business_id, available_balance) values ($1, 0)', [b])
    const reference = ref('ch_topup')
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, business_id, expected_amount, provider)
      values ($1,'carehub','business_wallet_topup',$2,$3,'paystack') returning *`, [reference, b, 500000])).rows[0]

    const first = await settle(i)
    expect(first.outcome).toBe('settled')
    let w = await one('select available_balance from business_wallets where business_id = $1', [b])
    expect(w.available_balance).toBe(500000)

    const second = await settle(i, { txn: `T${i.reference}` })
    expect(second.outcome).toBe('already_settled')
    w = await one('select available_balance from business_wallets where business_id = $1', [b])
    expect(w.available_balance).toBe(500000)
    const tx = (await db.query(`select count(*)::int c from business_wallet_transactions where reference = $1`, [reference])).rows[0]
    expect(tx.c).toBe(1)
  })

  it('wrong amount becomes needs_refund and does not credit', async () => {
    const b = uid()
    const reference = ref('ch_topup')
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, business_id, expected_amount, provider)
      values ($1,'carehub','business_wallet_topup',$2,$3,'paystack') returning *`, [reference, b, 100000])).rows[0]
    const r = await settle(i, { amount: 50000 })
    expect(r.outcome).toBe('needs_refund')
    const w = await db.query('select * from business_wallets where business_id = $1', [b])
    expect(w.rows.length).toBe(0)
  })
})

describe('booking_wallet', () => {
  it('pays a booking from CareCoins and credits the business', async () => {
    const b = uid(); const u = uid()
    await db.query('insert into businesses (id) values ($1)', [b])
    await one('select _post_coin_entry($1, $2, $3, $4) b', [u, 20, 'opening_balance', ref('op1')])
    const appt = (await db.query(`insert into appointments (business_id, fee_amount, payment_status, payment_reference, source)
      values ($1, 60000, 'unpaid', $2, 'carefind') returning id`, [b, ref('bk')])).rows[0]
    const reference = ref('cf_bkwallet')
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, provider, metadata)
      values ($1,'carefind','booking_wallet',$2,$3,'appointment',$4,60000,'carecoin','{}'::jsonb) returning *`, [reference, u, b, appt.id])).rows[0]
    const r = await settle(i)
    expect(r.outcome).toBe('settled')
    const a = await one('select payment_status from appointments where id = $1', [appt.id])
    expect(a.payment_status).toBe('paid')
    const w = await one('select balance from wallets where user_id = $1', [u])
    expect(w.balance).toBe(17) // 20 - ceil(60000/20000)=3
  })
})

describe('subscription_wallet', () => {
  it('moves CareCoins from subscriber to creator through the engine', async () => {
    const u = uid(); const c = uid()
    await db.query('insert into profiles (id, subscription_price) values ($1, $2)', [c, 100])
    await one('select _post_coin_entry($1, $2, $3, $4) b', [u, 100, 'opening_balance', ref('op2')])
    const reference = ref('cf_subwallet')
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, expected_amount, provider, metadata)
      values ($1,'carefind','subscription_wallet',$2,2000000,'carecoin',$3::jsonb) returning *`, [reference, u, JSON.stringify({ creator_id: c, price: 100 })])).rows[0]
    const r = await settle(i)
    expect(r.outcome).toBe('settled')
    expect((await one('select balance from wallets where user_id = $1', [u])).balance).toBe(0) // 100 - 100
    expect((await one('select balance from wallets where user_id = $1', [c])).balance).toBe(100)
  })
})

describe('plan_renewal_wallet', () => {
  it('debits the business wallet and extends the plan', async () => {
    const b = uid()
    await db.query('insert into businesses (id) values ($1)', [b])
    await db.query('insert into business_wallets (business_id, available_balance) values ($1, 1000000)', [b])
    const reference = ref('ch_planwallet')
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, business_id, expected_amount, provider, metadata)
      values ($1,'carehub','plan_renewal_wallet',$2,500000,'business_wallet',$3::jsonb) returning *`, [reference, b, JSON.stringify({ months: 1 })])).rows[0]
    const r = await settle(i)
    expect(r.outcome).toBe('settled')
    expect((await one('select available_balance from business_wallets where business_id = $1', [b])).available_balance).toBe(500000)
    const biz = await one('select plan_expires_at from businesses where id = $1', [b])
    expect(biz.plan_expires_at).not.toBeNull()
  })
})

describe('appointment_fee_wallet', () => {
  it('debits the business wallet for the per-appointment fee', async () => {
    const b = uid()
    await db.query('insert into businesses (id) values ($1)', [b])
    await db.query('insert into business_wallets (business_id, available_balance) values ($1, 300000)', [b])
    const appt = (await db.query(`insert into appointments (business_id, fee_amount, source) values ($1, 100000, 'carehub') returning id`, [b])).rows[0]
    const reference = ref('ch_apptfee')
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, business_id, entity_type, entity_id, expected_amount, provider)
      values ($1,'carehub','appointment_fee_wallet',$2,'appointment',$3,5000,'business_wallet') returning *`, [reference, b, appt.id])).rows[0]
    const r = await settle(i)
    expect(r.outcome).toBe('settled')
    expect((await one('select available_balance from business_wallets where business_id = $1', [b])).available_balance).toBe(295000)
  })
})

describe('consultation_wallet', () => {
  it('moves CareCoins from patient to professional through the engine', async () => {
    const professional = uid(); const patient = uid()
    await one('select _post_coin_entry($1, $2, $3, $4) b', [patient, 10, 'opening_balance', ref('op4')])
    const setup = (await db.query(`insert into professional_consultations (professional_id, patient_id, type, fee, status)
      values ($1, $2, 'text', 500, 'setup') returning id`, [professional, patient])).rows[0]
    const reference = ref('cf_conswallet')
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, entity_type, entity_id, expected_amount, provider, metadata)
      values ($1,'carefind','consultation_wallet',$2,'consultation',$3,50000,'carecoin',$4::jsonb) returning *`,
      [reference, patient, setup.id, JSON.stringify({ professional_id: professional })])).rows[0]
    const r = await settle(i)
    expect(r.outcome).toBe('settled')
    expect((await one('select balance from wallets where user_id = $1', [patient])).balance).toBe(7) // 10 - ceil(500/200)=3
    expect((await one('select balance from wallets where user_id = $1', [professional])).balance).toBe(3)
    const paid = await one(`select id from professional_consultations where professional_id = $1 and patient_id = $2 and status = 'paid'`, [professional, patient])
    expect(paid).toBeTruthy()
    // the pay function mints its own consult_ reference, so match by the two parties
    const tx = (await db.query(`select type, amount::int a from transactions where user_id in ($1, $2) order by type`, [patient, professional])).rows
    expect(tx).toEqual([
      { type: 'consultation_earnings', a: 3 },
      { type: 'consultation_payment', a: 3 },
    ])
  })

  it('a patient without enough coins is refused and nothing moves', async () => {
    const professional = uid(); const patient = uid()
    await one('select _post_coin_entry($1, $2, $3, $4) b', [patient, 1, 'opening_balance', ref('op5')])
    const setup = (await db.query(`insert into professional_consultations (professional_id, patient_id, type, fee, status)
      values ($1, $2, 'text', 500, 'setup') returning id`, [professional, patient])).rows[0]
    const reference = ref('cf_conspoor')
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, entity_type, entity_id, expected_amount, provider, metadata)
      values ($1,'carefind','consultation_wallet',$2,'consultation',$3,50000,'carecoin',$4::jsonb) returning *`,
      [reference, patient, setup.id, JSON.stringify({ professional_id: professional })])).rows[0]
    const r = await settle(i)
    expect(r.outcome).toBe('needs_refund')
    expect(r.reason).toBe('insufficient')
    expect((await one('select balance from wallets where user_id = $1', [patient])).balance).toBe(1)
    expect((await one('select balance from wallets where user_id = $1', [professional])).balance).toBe(0)
    expect(await one(`select id from professional_consultations where professional_id = $1 and status = 'paid'`, [professional])).toBeUndefined()
  })
})

describe('shop_order_wallet', () => {
  const newOrder = async (buyer, vendor, totalKobo) => (await db.query(
    `insert into shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status, subtotal_kobo, total_kobo)
     values ($1, $2, $3, 'pending_payment', 'pending', $4, $4) returning *`,
    [ref('CF-W'), buyer, vendor, totalKobo])).rows[0]

  it('debits the buyer CareCoins and pays the order', async () => {
    const vendor = uid(); const buyer = uid()
    await db.query('insert into businesses (id) values ($1)', [vendor])
    await one('select _post_coin_entry($1, $2, $3, $4) b', [buyer, 10, 'opening_balance', ref('op6')])
    const order = await newOrder(buyer, vendor, 50000)
    const reference = ref('cf_swallet')
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, provider)
      values ($1,'carefind','shop_order_wallet',$2,$3,'shop_order',$4,$5,'carecoin') returning *`,
      [reference, buyer, vendor, order.id, 50000])).rows[0]
    const r = await settle(i)
    expect(r.outcome).toBe('settled')
    expect((await one('select balance from wallets where user_id = $1', [buyer])).balance).toBe(7) // 10 - ceil(50000/20000)=3
    expect((await one('select payment_status, status from shop_orders where id = $1', [order.id]))).toMatchObject({ payment_status: 'paid', status: 'paid' })
    const debit = await one(`select delta from coin_ledger where user_id = $1 and reference = $2 and kind = 'shop_payment'`, [buyer, reference])
    expect(debit.delta).toBe(-3)
  })

  it('an amount the vendor no longer agrees with refunds the debit', async () => {
    const vendor = uid(); const buyer = uid()
    await db.query('insert into businesses (id) values ($1)', [vendor])
    await one('select _post_coin_entry($1, $2, $3, $4) b', [buyer, 10, 'opening_balance', ref('op7')])
    const order = await newOrder(buyer, vendor, 50000)
    const reference = ref('cf_swamt')
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, provider)
      values ($1,'carefind','shop_order_wallet',$2,$3,'shop_order',$4,$5,'carecoin') returning *`,
      [reference, buyer, vendor, order.id, 40000])).rows[0]
    const r = await settle(i)
    expect(r.outcome).toBe('needs_refund')
    expect(r.reason).toBe('amount_changed')
    expect((await one('select balance from wallets where user_id = $1', [buyer])).balance).toBe(10) // debited 2, refunded 2
    expect((await one('select payment_status from shop_orders where id = $1', [order.id])).payment_status).toBe('pending')
    const refund = await one(`select delta from coin_ledger where user_id = $1 and reference = $2 and kind = 'shop_payment_refund'`, [buyer, `sref_${reference}`])
    expect(refund.delta).toBe(2)
  })

  it('a buyer without enough coins is refused and the order stays unpaid', async () => {
    const vendor = uid(); const buyer = uid()
    await db.query('insert into businesses (id) values ($1)', [vendor])
    await one('select _post_coin_entry($1, $2, $3, $4) b', [buyer, 1, 'opening_balance', ref('op8')])
    const order = await newOrder(buyer, vendor, 50000)
    const reference = ref('cf_swpoor')
    const i = (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, provider)
      values ($1,'carefind','shop_order_wallet',$2,$3,'shop_order',$4,$5,'carecoin') returning *`,
      [reference, buyer, vendor, order.id, 50000])).rows[0]
    const r = await settle(i)
    expect(r.outcome).toBe('needs_refund')
    expect(r.reason).toBe('insufficient_coins')
    expect((await one('select balance from wallets where user_id = $1', [buyer])).balance).toBe(1)
    expect((await one('select payment_status from shop_orders where id = $1', [order.id])).payment_status).toBe('pending')
    expect(await one(`select id from coin_ledger where user_id = $1 and kind = 'shop_payment'`, [buyer])).toBeUndefined()
  })
})
