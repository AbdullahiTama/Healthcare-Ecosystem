// @vitest-environment node
// Vendor payout model for shop sales (database). Real Postgres (PGlite), every migration in production order.
// A paid order credits the vendor (subtotal - commission) as HELD; delivery + the return window releases it; a refund takes it
// back (never below zero, shortfall recorded) and a failed refund restores it exactly. Cancellation and return approval now
// start a real card refund.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 170000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_abcdefgh`

const SUBTOTAL = 2_000_000
const COMMISSION = 400_000      // 20%
const FULFILMENT = 50_000
const TOTAL = SUBTOTAL + FULFILMENT
const VENDOR = SUBTOTAL - COMMISSION // 1,600,000

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(read('./fixtures/liveSchemaSubset.sql'))
  await db.exec(M('carefind_20261003_payment_intents_foundation'))
  await db.exec(M('carefind_20261004_settle_payment_intent'))
  await db.exec(M('carefind_20261005_coin_ledger'))
  await createLegacyStubs(db)
  await db.exec(M('carefind_20261005_coin_writers_use_ledger'))
  await db.exec(M('carefind_20261005_lock_wallets_to_ledger'))
  await db.exec(M('carefind_20261006_settle_plan_and_carehub_appointments'))
  await db.exec(M('carefind_20261007_commission_engine'))
  await db.exec(M('carefind_20261008_commission_reconcile_first_payment'))
  await db.exec(M('carefind_20261008_withdrawal_engine'))
  await db.exec(M('carefind_20261009_refund_engine'))
  // production start state of the shop functions this migration replaces (their bodies are overwritten; the ACLs are the live ones)
  await db.exec(M('carefind_20261010_central_settlement'))
  await db.exec(`
    create function public.cancel_shop_order(p_order_id uuid, p_reason text default null) returns text language sql as $$ select 'old'::text $$;
    create function public.process_shop_return(p_return_id uuid, p_action text, p_notes text default null) returns text language sql as $$ select 'old'::text $$;
    grant execute on function public.cancel_shop_order(uuid, text), public.process_shop_return(uuid, text, text) to anon, authenticated, service_role;
  `)
  await db.exec(M('carefind_20261012_shop_vendor_payouts'))
  await db.exec(`
    create function public.request_shop_return(p_order_id uuid, p_reason text, p_description text default null, p_refund_amount_kobo integer default null) returns uuid language sql as $$ select null::uuid $$;
    grant execute on function public.request_shop_return(uuid, text, text, integer) to anon, authenticated, service_role;
  `)
  await db.exec(M('carefind_20261013_shop_return_hardening'))
  await db.exec(M('carefind_20261014_reconciliation'))
  await db.exec(M('carefind_20261015_reconciliation_ops'))
  await db.exec(M('carefind_20261016_reconciliation_scale'))
  await db.exec(M('carefind_20261017_engine_timeouts_and_hot_paths'))
  await db.exec(M('carefind_20261019_red_team_fixes'))   // reorders _settle_shop_order and re-times the engines: every test below runs on the final code
  await db.exec(M('carefind_20261018_shop_return_service_caller'))   // the endpoint calls with the service-role key and names the customer
}, 180_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const asRole = async (role, fn, { sub = null, email = null } = {}) => {
  await db.exec(`set role ${role}`)
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false), set_config('request.jwt.claim.email', $3, false)", [sub || '', role, email || ''])
  try { return await fn() } finally {
    await db.exec('reset role')
    await db.exec("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.email', '', false)")
  }
}
const wallet = (b) => one('select held_balance::int held, available_balance::int avail from business_wallets where business_id = $1', [b])
const credit = (id) => one('select status, amount_kobo, reversed_kobo, released_kobo, release_shortfall_kobo from shop_vendor_credits where order_id = $1', [id])
const ledger = (b, type) => all('select amount::int amount, reference from business_wallet_transactions where business_id = $1 and type = $2 order by created_at', [b, type])

async function business({ held = 0, available = 0, email = null } = {}) {
  const b = (await db.query('insert into businesses (name, email) values ($1,$2) returning id', ['Vendor', email])).rows[0].id
  await db.query('insert into business_wallets (business_id, held_balance, available_balance) values ($1,$2,$3)', [b, held, available])
  return b
}
// an unpaid order plus the intent, settled through the REAL engine
async function paidOrder({ vendor, customer = uid(), subtotal = SUBTOTAL, commission = COMMISSION, total = TOTAL } = {}) {
  vendor ||= await business()
  const o = (await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,'pending_payment',$4,$5,$6) returning id`, [ref('CF'), customer, vendor, total, subtotal, commission])).rows[0]
  const reference = ref('cf_shop')
  await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, metadata) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,$5,'{}'::jsonb)`, [reference, customer, vendor, o.id, total])
  await db.query(`insert into shop_payments (order_id, payment_reference, amount_kobo, status) values ($1,$2,$3,'pending')`, [o.id, reference, total])
  const r = (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', `T${reference}`, total, 'NGN'])).r
  expect(r.outcome).toBe('settled')
  return { id: o.id, vendor, customer, reference }
}
// the order was delivered `daysAgo` days ago
async function deliver(id, daysAgo) {
  await db.query(`update shop_orders set status = 'delivered' where id = $1`, [id])
  await db.query(`insert into shop_order_status_history (order_id, from_status, to_status, created_at) values ($1,'in_transit','delivered', now() - make_interval(days => $2))`, [id, daysAgo])
}
const release = async () => (await asRole('service_role', () => one('select release_shop_vendor_credits(200) r'))).r
const requestRefund = (cause, id, { amount = null, platformFunded = false } = {}) =>
  one('select request_refund($1,$2,$3,null,null,$4,$5) r', [cause, 'shop_order', id, platformFunded, amount]).then((x) => x.r)
const settleRefund = (outcome, id, extra = {}) =>
  one('select settle_refund($1,$2,null,$3,null,$4) r', [outcome, id, extra.providerRefundId ?? null, extra.amount ?? null]).then((x) => x.r)
const orderRow = (id) => one('select status, payment_status from shop_orders where id = $1', [id])

describe('a paid order credits the vendor', () => {
  it('credits subtotal - commission to HELD, with one ledger row and one credit row; the platform keeps commission and fulfilment fee', async () => {
    const o = await paidOrder()
    expect(await wallet(o.vendor)).toEqual({ held: VENDOR, avail: 0 })
    expect(await credit(o.id)).toMatchObject({ status: 'held', amount_kobo: VENDOR, reversed_kobo: 0 })
    expect(await ledger(o.vendor, 'shop_credit')).toEqual([{ amount: VENDOR, reference: `shopcr_${o.id}` }])
  })

  it('a replay of the same payment cannot credit twice', async () => {
    const o = await paidOrder()
    const r = (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [o.reference, 'paystack', `T${o.reference}`, TOTAL, 'NGN'])).r
    expect(r.outcome).toBe('already_settled')
    expect(await wallet(o.vendor)).toEqual({ held: VENDOR, avail: 0 })
    expect((await ledger(o.vendor, 'shop_credit')).length).toBe(1)
  })

  it('a payment that cannot be applied (amount changed) credits nobody', async () => {
    const vendor = await business()
    const o = (await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,$4,$5,$6) returning id`, [ref('CF'), uid(), vendor, TOTAL + 1, SUBTOTAL, COMMISSION])).rows[0]
    const reference = ref('cf_shop')
    await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, metadata) select $1,'carefind','shop_order',customer_id,vendor_business_id,'shop_order',id,$3,'{}'::jsonb from shop_orders where id = $2`, [reference, o.id, TOTAL])
    const r = (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', 'T1', TOTAL, 'NGN'])).r
    expect(r.outcome).toBe('needs_refund')
    expect(await wallet(vendor)).toEqual({ held: 0, avail: 0 })
    expect(await one('select count(*)::int c from shop_vendor_credits where order_id = $1', [o.id])).toEqual({ c: 0 })
  })

  it('the engine result carries the credit', async () => {
    const vendor = await business()
    const o = (await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,$4,$5,$6) returning id, customer_id`, [ref('CF'), uid(), vendor, TOTAL, SUBTOTAL, COMMISSION])).rows[0]
    const reference = ref('cf_shop')
    await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, metadata) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,$5,'{}'::jsonb)`, [reference, o.customer_id, vendor, o.id, TOTAL])
    const r = (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', 'T2', TOTAL, 'NGN'])).r
    expect(r).toMatchObject({ outcome: 'settled', vendor_credit_kobo: VENDOR })
  })
})

describe('release after delivery and the return window', () => {
  it('does not release before the window, an undelivered order, or an order with an open return', async () => {
    const early = await paidOrder(); await deliver(early.id, 2)
    const undelivered = await paidOrder()
    const returning = await paidOrder(); await deliver(returning.id, 30)
    await db.query(`insert into shop_order_returns (order_id, customer_id, vendor_business_id, reason, refund_amount_kobo) values ($1,$2,$3,'damaged',$4)`, [returning.id, returning.customer, returning.vendor, TOTAL])
    await release()
    for (const o of [early, undelivered, returning]) expect(await credit(o.id)).toMatchObject({ status: 'held' })
    expect(await wallet(early.vendor)).toEqual({ held: VENDOR, avail: 0 })
  })

  it('releases held -> available once, with one ledger row; a second sweep does nothing', async () => {
    const o = await paidOrder(); await deliver(o.id, 8)
    const r1 = await release()
    expect(r1.released).toBeGreaterThanOrEqual(1)
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: VENDOR })
    expect(await credit(o.id)).toMatchObject({ status: 'released', released_kobo: VENDOR, release_shortfall_kobo: 0 })
    expect(await ledger(o.vendor, 'shop_release')).toEqual([{ amount: VENDOR, reference: `shoprl_${o.id}` }])
    const r2 = await release()
    expect(r2.released).toBe(0)
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: VENDOR })
  })

  it('does not release while a refund is live', async () => {
    const o = await paidOrder(); await deliver(o.id, 30)
    await requestRefund('shop_return', o.id, { amount: TOTAL / 2 })
    await release()
    expect((await credit(o.id)).status).toBe('held')
  })

  it('is callable only by service_role', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(asRole(role, () => db.query('select release_shop_vendor_credits(10)'))).rejects.toThrow(/permission denied/)
    }
  })

  it('releases only what the wallet still holds when other debits already took from held, and records the shortfall', async () => {
    const o = await paidOrder(); await deliver(o.id, 30)
    await db.query('update business_wallets set held_balance = 1000 where business_id = $1', [o.vendor])
    const r = await release()
    expect(r.partial).toBe(1)
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: 1000 })
    expect(await credit(o.id)).toMatchObject({ status: 'released', released_kobo: 1000, release_shortfall_kobo: VENDOR - 1000 })
    expect((await all("select kind from reconcile_shop_vendor_credits() where order_id = $1", [o.id])).map((x) => x.kind)).toContain('release_shortfall')
  })
})

describe('refunds take the vendor share back', () => {
  it('a full refund of a held credit: wallet debited, credit reversed; completion refunds the order, intent and payment', async () => {
    const o = await paidOrder()
    const r = await requestRefund('order_cancelled', o.id)
    expect(r).toMatchObject({ outcome: 'requested', kind: 'card', amount_kobo: TOTAL, business_shortfall_kobo: 0 })
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: 0 })
    expect(await credit(o.id)).toMatchObject({ status: 'reversed', reversed_kobo: VENDOR })
    expect(await ledger(o.vendor, 'refund_debit')).toEqual([{ amount: -VENDOR, reference: r.reference }])

    expect((await settleRefund('processed', r.id)).result).toBe('completed')
    expect(await orderRow(o.id)).toEqual({ status: 'refunded', payment_status: 'refunded' })
    expect((await one("select status from payment_intents where reference = $1", [o.reference])).status).toBe('refunded')
    expect((await one("select status from shop_payments where payment_reference = $1", [o.reference])).status).toBe('refunded')
    expect((await settleRefund('processed', r.id)).result).toBe('already_completed')
    await release()
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: 0 })
  })

  it('a refund of a RELEASED credit takes from available first and leaves other held money alone', async () => {
    const vendor = await business()
    const a = await paidOrder({ vendor }); await deliver(a.id, 30)
    await release()                                    // a: 1,600,000 available
    const b = await paidOrder({ vendor })              // b: 1,600,000 held
    const r = await requestRefund('shop_return', a.id)
    expect(await wallet(vendor)).toEqual({ held: VENDOR, avail: 0 })
    expect(r.business_shortfall_kobo).toBe(0)
    expect((await credit(b.id)).status).toBe('held')
  })

  it('records a shortfall instead of a negative balance when the vendor already withdrew', async () => {
    const o = await paidOrder(); await deliver(o.id, 30)
    await release()
    await db.query('update business_wallets set available_balance = 100000 where business_id = $1', [o.vendor])   // withdrew most of it
    const r = await requestRefund('shop_return', o.id)
    expect(r.business_shortfall_kobo).toBe(VENDOR - 100000)
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: 0 })
    expect((await all('select kind from reconcile_shop_vendor_credits() where order_id = $1', [o.id])).map((x) => x.kind)).toContain('refund_shortfall')
  })

  it('a failed provider refund restores the vendor exactly and the order is delivered again', async () => {
    const o = await paidOrder(); await deliver(o.id, 1)
    await db.query("update shop_orders set status = 'refund_requested' where id = $1", [o.id])
    const before = await wallet(o.vendor)
    const r = await requestRefund('shop_return', o.id)
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: 0 })
    expect((await settleRefund('failed', r.id)).result).toBe('failed')
    expect(await wallet(o.vendor)).toEqual(before)
    expect(await credit(o.id)).toMatchObject({ status: 'held', reversed_kobo: 0 })
    expect(await orderRow(o.id)).toEqual({ status: 'delivered', payment_status: 'paid' })
    expect((await ledger(o.vendor, 'refund_restore')).length).toBe(1)
    // the order can be refunded again after a failure
    expect((await requestRefund('shop_return', o.id)).outcome).toBe('requested')
  })

  it('a failed refund of a released credit restores it as released (the sweep does not release it twice)', async () => {
    const o = await paidOrder(); await deliver(o.id, 30)
    await release()
    const r = await requestRefund('shop_return', o.id)
    await settleRefund('failed', r.id)
    expect(await credit(o.id)).toMatchObject({ status: 'released', reversed_kobo: 0 })
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: VENDOR })
    await release()
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: VENDOR })
  })

  it('a partial refund recovers a pro rata share; the rest of the sale stands and is released later', async () => {
    const o = await paidOrder(); await deliver(o.id, 30)
    await db.query("update shop_orders set status = 'refund_requested' where id = $1", [o.id])
    const half = TOTAL / 2
    const r = await requestRefund('shop_return', o.id, { amount: half })
    const due = Math.round(VENDOR * half / TOTAL)
    expect(r.amount_kobo).toBe(half)
    expect(await wallet(o.vendor)).toEqual({ held: VENDOR - due, avail: 0 })
    expect(await credit(o.id)).toMatchObject({ status: 'held', reversed_kobo: due })
    expect((await settleRefund('processed', r.id)).result).toBe('completed')
    expect(await orderRow(o.id)).toEqual({ status: 'delivered', payment_status: 'paid' })
    await release()
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: VENDOR - due })
  })

  it('a platform-funded refund does not touch the vendor', async () => {
    const o = await paidOrder()
    const r = await requestRefund('shop_return', o.id, { platformFunded: true })
    expect(r.kind).toBe('platform_funded')
    expect(await wallet(o.vendor)).toEqual({ held: VENDOR, avail: 0 })
    expect((await credit(o.id)).reversed_kobo).toBe(0)
  })

  it('one live refund per order; a larger amount than paid is refused; an unpaid order has nothing to refund', async () => {
    const o = await paidOrder()
    const r = await requestRefund('order_cancelled', o.id)
    expect((await requestRefund('order_cancelled', o.id)).outcome).toBe('already_requested')
    const o2 = await paidOrder()
    await expect(requestRefund('shop_return', o2.id, { amount: TOTAL + 1 })).rejects.toThrow(/outside/)
    await expect(requestRefund('shop_return', o2.id, { amount: 0 })).rejects.toThrow(/outside/)
    const vendor = await business()
    const unpaid = (await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,$4,$5,$6) returning id`, [ref('CF'), uid(), vendor, TOTAL, SUBTOTAL, COMMISSION])).rows[0]
    expect((await requestRefund('shop_return', unpaid.id)).outcome).toBe('not_paid')
    expect(r.outcome).toBe('requested')
  })

  it('a partial amount is refused for non-shop causes', async () => {
    await expect(one("select request_refund('booking_cancelled','appointment',$1,null,null,false,100)", [uid()])).rejects.toThrow(/only for shop/)
  })
})

describe('cancel_shop_order and process_shop_return', () => {
  it('a customer cancelling a PAID order before dispatch starts a refund and the vendor share is recovered', async () => {
    const o = await paidOrder()
    const out = await asRole('authenticated', () => one('select cancel_shop_order($1, $2) r', [o.id, 'changed my mind']), { sub: o.customer })
    expect(out.r).toBe('ok')
    expect((await orderRow(o.id))).toEqual({ status: 'cancelled', payment_status: 'paid' })
    const f = await one("select kind, status, amount_kobo::int amount, entity_type from refunds where entity_id = $1", [o.id])
    expect(f).toEqual({ kind: 'card', status: 'requested', amount: TOTAL, entity_type: 'shop_order' })
    expect(await wallet(o.vendor)).toEqual({ held: 0, avail: 0 })
    // completion keeps the order cancelled but marks it refunded
    const r = (await one('select id from refunds where entity_id = $1', [o.id]))
    await settleRefund('processed', r.id)
    expect(await orderRow(o.id)).toEqual({ status: 'cancelled', payment_status: 'refunded' })
  })

  it('a customer cannot cancel a dispatched paid order; the vendor can, and the customer is refunded', async () => {
    const vendorEmail = 'v@example.com'
    const vendor = await business({ email: vendorEmail })
    const o = await paidOrder({ vendor })
    await db.query("update shop_orders set status = 'in_transit' where id = $1", [o.id])
    await expect(asRole('authenticated', () => one('select cancel_shop_order($1, null)', [o.id]), { sub: o.customer })).rejects.toThrow(/already been dispatched/)
    expect((await orderRow(o.id)).status).toBe('in_transit')
    const out = await asRole('authenticated', () => one('select cancel_shop_order($1, $2) r', [o.id, 'out of stock']), { sub: uid(), email: vendorEmail })
    expect(out.r).toBe('ok')
    expect(await one('select count(*)::int c from refunds where entity_id = $1', [o.id])).toEqual({ c: 1 })
  })

  it('cancelling an unpaid order starts no refund; a stranger cannot cancel; anon cannot execute it', async () => {
    const vendor = await business()
    const unpaid = (await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,$4,$5,$6) returning id, customer_id`, [ref('CF'), uid(), vendor, TOTAL, SUBTOTAL, COMMISSION])).rows[0]
    await expect(asRole('authenticated', () => one('select cancel_shop_order($1, null)', [unpaid.id]), { sub: uid() })).rejects.toThrow(/Not authorized/)
    await expect(asRole('anon', () => one('select cancel_shop_order($1, null)', [unpaid.id]))).rejects.toThrow(/permission denied/)
    expect((await asRole('authenticated', () => one('select cancel_shop_order($1, null) r', [unpaid.id]), { sub: unpaid.customer_id })).r).toBe('ok')
    expect(await one('select count(*)::int c from refunds where entity_id = $1', [unpaid.id])).toEqual({ c: 0 })
  })

  it('a paid order with a return in progress cannot be cancelled', async () => {
    const o = await paidOrder()
    await db.query("update shop_orders set status = 'refund_requested' where id = $1", [o.id])
    await expect(asRole('authenticated', () => one('select cancel_shop_order($1, null)', [o.id]), { sub: o.customer })).rejects.toThrow(/in progress/)
  })

  it('approving a return starts a card refund for the requested amount (never more than paid); the order waits for the provider', async () => {
    const email = 'seller@example.com'
    const vendor = await business({ email })
    const o = await paidOrder({ vendor }); await deliver(o.id, 1)
    await db.query("update shop_orders set status = 'refund_requested' where id = $1", [o.id])
    const ret = (await db.query(`insert into shop_order_returns (order_id, customer_id, vendor_business_id, reason, refund_amount_kobo) values ($1,$2,$3,'damaged',$4) returning id`, [o.id, o.customer, vendor, TOTAL * 10])).rows[0]
    await expect(asRole('authenticated', () => one("select process_shop_return($1,'approve',null)", [ret.id]), { sub: uid(), email: 'other@example.com' })).rejects.toThrow(/Not authorized/)
    const out = await asRole('authenticated', () => one("select process_shop_return($1,'approve','ok') r", [ret.id]), { sub: uid(), email })
    expect(out.r).toBe('approved')
    expect(await one("select status, refund_method from shop_order_returns where id = $1", [ret.id])).toEqual({ status: 'approved', refund_method: 'original_payment' })
    expect(await orderRow(o.id)).toEqual({ status: 'refund_requested', payment_status: 'paid' })
    expect(await one('select kind, amount_kobo::int amount from refunds where entity_id = $1', [o.id])).toEqual({ kind: 'card', amount: TOTAL })
    expect((await all("select kind from reconcile_shop_vendor_credits() where order_id = $1", [o.id])).map((x) => x.kind)).not.toContain('approved_return_without_refund')
    expect(await wallet(vendor)).toEqual({ held: 0, avail: 0 })
  })

  it('rejecting a return puts the order back to delivered and moves no money', async () => {
    const email = 'seller2@example.com'
    const vendor = await business({ email })
    const o = await paidOrder({ vendor }); await deliver(o.id, 1)
    await db.query("update shop_orders set status = 'refund_requested' where id = $1", [o.id])
    const ret = (await db.query(`insert into shop_order_returns (order_id, customer_id, vendor_business_id, reason, refund_amount_kobo) values ($1,$2,$3,'changed mind',$4) returning id`, [o.id, o.customer, vendor, TOTAL])).rows[0]
    const out = await asRole('authenticated', () => one("select process_shop_return($1,'reject','no') r", [ret.id]), { sub: uid(), email })
    expect(out.r).toBe('rejected')
    expect(await orderRow(o.id)).toEqual({ status: 'delivered', payment_status: 'paid' })
    expect(await one('select count(*)::int c from refunds where entity_id = $1', [o.id])).toEqual({ c: 0 })
    expect(await wallet(vendor)).toEqual({ held: VENDOR, avail: 0 })
  })

  it('a return whose refund cannot start is not approved (the whole approval rolls back)', async () => {
    const email = 'seller3@example.com'
    const vendor = await business({ email })
    const unpaid = (await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,'refund_requested',$4,$5,$6) returning id, customer_id`, [ref('CF'), uid(), vendor, TOTAL, SUBTOTAL, COMMISSION])).rows[0]
    const ret = (await db.query(`insert into shop_order_returns (order_id, customer_id, vendor_business_id, reason, refund_amount_kobo) values ($1,$2,$3,'x',$4) returning id`, [unpaid.id, unpaid.customer_id, vendor, TOTAL])).rows[0]
    await expect(asRole('authenticated', () => one("select process_shop_return($1,'approve',null)", [ret.id]), { sub: uid(), email })).rejects.toThrow(/could not be started/)
    expect((await one('select status from shop_order_returns where id = $1', [ret.id])).status).toBe('requested')
  })
})

describe('reconciliation and permissions', () => {
  it('lists a paid order that predates credits for a human decision, and nothing for clean orders', async () => {
    const vendor = await business()
    const legacy = (await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status, total_kobo, subtotal_kobo, commission_kobo, updated_at) values ($1,$2,$3,'paid','paid',$4,$5,$6, now() - interval '30 days') returning id`, [ref('CF'), uid(), vendor, TOTAL, SUBTOTAL, COMMISSION])).rows[0]
    const clean = await paidOrder()
    const rows = await all('select kind, order_id from reconcile_shop_vendor_credits()')
    expect(rows).toContainEqual({ kind: 'legacy_paid_order_without_credit', order_id: legacy.id })
    expect(rows.filter((r) => r.order_id === clean.id)).toEqual([])
  })

  it('detects a credit whose ledger row is missing and a wallet that holds less than the open credits', async () => {
    const o = await paidOrder()
    await db.query("delete from business_wallet_transactions where reference = $1", [`shopcr_${o.id}`])
    await db.query('update business_wallets set held_balance = 0 where business_id = $1', [o.vendor])
    const kinds = (await all('select kind, order_id from reconcile_shop_vendor_credits()')).filter((r) => r.order_id === o.id || r.order_id === o.vendor).map((r) => r.kind)
    expect(kinds).toEqual(expect.arrayContaining(['credit_without_ledger_row', 'held_below_open_credits']))
  })

  it('the credit table is server-only and cannot be edited into a different amount or deleted', async () => {
    const o = await paidOrder()
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expect(asRole(role, () => db.query('select * from shop_vendor_credits'))).rejects.toThrow(/permission denied/)
    }
    await expect(db.query('update shop_vendor_credits set amount_kobo = 1 where order_id = $1', [o.id])).rejects.toThrow(/immutable/)
    await expect(db.query('delete from shop_vendor_credits where order_id = $1', [o.id])).rejects.toThrow(/never deleted/)
    await expect(db.query('truncate shop_vendor_credits')).rejects.toThrow()
  })

  it('no API role can call the engine functions; anon cannot call the return functions', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(asRole(role, () => db.query('select reconcile_shop_vendor_credits()'))).rejects.toThrow(/permission denied/)
      await expect(asRole(role, () => db.query("select request_refund('shop_return','shop_order',$1)", [uid()]))).rejects.toThrow(/permission denied/)
      await expect(asRole(role, () => db.query("select settle_refund('failed', $1)", [uid()]))).rejects.toThrow(/permission denied/)
    }
    await expect(asRole('anon', () => db.query("select process_shop_return($1,'approve')", [uid()]))).rejects.toThrow(/permission denied/)
    expect((await one("select count(*)::int c from pg_proc where proname = 'request_refund'")).c).toBe(1)
  })

  it('detects a vendor credit that is not subtotal minus commission (a tampered or mis-written amount)', async () => {
    const o = await paidOrder()
    await db.exec('set session_replication_role = replica')
    await db.query('update shop_vendor_credits set amount_kobo = amount_kobo + 1 where order_id = $1', [o.id])
    await db.exec('set session_replication_role = origin')
    const rows = await all('select kind, detail from reconcile_shop_vendor_credits() where order_id = $1', [o.id])
    expect(rows.map((r) => r.kind)).toContain('credit_amount_mismatch')
    expect(rows.find((r) => r.kind === 'credit_amount_mismatch').detail).toMatch(new RegExp(`credit ${VENDOR + 1} <> subtotal - commission ${VENDOR}`))
  })

  it('the config rows exist', async () => {
    expect(Number((await one("select value from financial_config where key = 'shop_vendor_return_window_days'")).value)).toBe(7)
  })
})

describe('request_shop_return hardening', () => {
  const request = (o, amount, who = o.customer) => asRole('authenticated', () => one('select request_shop_return($1, $2, null, $3) r', [o.id, 'damaged', amount]), { sub: who })

  it('anon cannot call it; a stranger is refused; an unpaid or undelivered order cannot be returned', async () => {
    const o = await paidOrder(); await deliver(o.id, 1)
    await expect(asRole('anon', () => db.query('select request_shop_return($1, $2)', [o.id, 'x']))).rejects.toThrow(/permission denied/)
    await expect(request(o, null, uid())).rejects.toThrow(/Not authorized/)
    const fresh = await paidOrder()
    await expect(request(fresh, null)).rejects.toThrow(/delivered orders/)
  })

  it('a return asks for at most what was paid (default: the whole order)', async () => {
    const o = await paidOrder(); await deliver(o.id, 1)
    await expect(request(o, TOTAL + 1)).rejects.toThrow(/between 1 and the order total/)
    await expect(request(o, 0)).rejects.toThrow(/between 1 and the order total/)
    const id = (await request(o, null)).r
    expect((await one('select refund_amount_kobo::int a, status from shop_order_returns where id = $1', [id]))).toEqual({ a: TOTAL, status: 'requested' })
    expect((await orderRow(o.id)).status).toBe('refund_requested')
    await expect(request(o, null)).rejects.toThrow(/delivered orders/)
  })

  it('the window runs from the FIRST delivery, not from the last time the row was touched', async () => {
    const o = await paidOrder(); await deliver(o.id, 10)
    await db.query('update shop_orders set updated_at = now() where id = $1', [o.id])      // any later touch used to restart the window
    await expect(request(o, null)).rejects.toThrow(/Return window \(7 days\) has expired/)
    const ok = await paidOrder(); await deliver(ok.id, 6)
    expect((await request(ok, null)).r).toBeTruthy()
  })

  it('the customer can return exactly as long as the vendor money is held', async () => {
    const o = await paidOrder(); await deliver(o.id, 6)
    await release()
    expect((await credit(o.id)).status).toBe('held')           // still inside the window: not released
    const old = await paidOrder(); await deliver(old.id, 8)
    await release()
    expect((await credit(old.id)).status).toBe('released')     // outside the window: released, and no longer returnable
    await expect(request(old, null)).rejects.toThrow(/expired/)
  })
})

describe('the booking credit primitive (carefind_20261017)', () => {
  const credit = (b, appt, ref) => db.query('select fn_credit_business_booking($1,$2,$3,$4,$5)', [b, appt, 1000000, 200000, ref])
  const newAppt = async (b) => (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'x','carehub',1000000,'paid',$2) returning id`, [b, ref('appt')])).rows[0].id

  it('credits a business with no wallet yet (creates it) and an existing one (adds to it)', async () => {
    const b = uid()
    await credit(b, await newAppt(b), ref('bk'))
    expect(await wallet(b)).toEqual({ held: 800000, avail: 0 })
    await credit(b, await newAppt(b), ref('bk'))
    expect(await wallet(b)).toEqual({ held: 1600000, avail: 0 })
  })

  it('is replay-safe on its own: the same reference twice credits the wallet ONCE (ledger first, wallet only for a new ledger row)', async () => {
    const b = uid(); const appt = await newAppt(b); const r = ref('bk')
    await credit(b, appt, r)
    await credit(b, appt, r)
    expect(await wallet(b)).toEqual({ held: 800000, avail: 0 })
    expect((await ledger(b, 'booking_credit')).length).toBe(1)
    expect((await one("select count(*)::int c from platform_transactions where reference = $1 and type = 'commission'", [r])).c).toBe(1)
  })

  it('no API role can call it', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expect(asRole(role, () => credit(uid(), uid(), ref('bk')))).rejects.toThrow(/permission denied/)
    }
  })
})

describe('request_shop_return called by the server endpoint (service role) - carefind_20261018', () => {
  const asServer = (o, customer, amount = null) => asRole('service_role', () => one('select request_shop_return($1, $2, null, $3, $4) r', [o.id, 'damaged', amount, customer]))
  const asUser = (o, sub, claimed) => asRole('authenticated', () => one('select request_shop_return($1, $2, null, null, $3) r', [o.id, 'damaged', claimed]), { sub })

  it('works for the customer it is told to act for (this is the production path: auth.uid() is null for the service role)', async () => {
    const o = await paidOrder(); await deliver(o.id, 1)
    const r = await asServer(o, o.customer)
    expect(r.r).toBeTruthy()
    expect((await orderRow(o.id)).status).toBe('refund_requested')
    expect(await one('select refund_amount_kobo::int a, customer_id from shop_order_returns where id = $1', [r.r])).toEqual({ a: TOTAL, customer_id: o.customer })
  })

  it('refuses a service-role call that names nobody, and one that names somebody who does not own the order', async () => {
    const o = await paidOrder(); await deliver(o.id, 1)
    await expect(asServer(o, null)).rejects.toThrow(/Not authorized/)
    await expect(asServer(o, uid())).rejects.toThrow(/Not authorized/)
    expect((await orderRow(o.id)).status).toBe('delivered')
  })

  it('keeps every other rule: the amount cap and the window apply to the server path too', async () => {
    const o = await paidOrder(); await deliver(o.id, 1)
    await expect(asServer(o, o.customer, TOTAL + 1)).rejects.toThrow(/between 1 and the order total/)
    const old = await paidOrder(); await deliver(old.id, 8)
    await expect(asServer(old, old.customer)).rejects.toThrow(/expired/)
  })

  it('a SIGNED-IN caller cannot act for anyone else by passing a customer id (it is ignored); anon cannot call it', async () => {
    const o = await paidOrder(); await deliver(o.id, 1)
    await expect(asUser(o, uid(), o.customer)).rejects.toThrow(/Not authorized/)            // a stranger claiming to be the owner
    expect((await asUser(o, o.customer, uid())).r).toBeTruthy()                             // the owner, passing garbage: acts as themselves
    await expect(asRole('anon', () => db.query('select request_shop_return($1, $2, null, null, $3)', [o.id, 'x', o.customer]))).rejects.toThrow(/permission denied/)
  })

  it('exactly one function of that name exists (no stale overload that skips the checks)', async () => {
    expect((await one("select count(*)::int c from pg_proc where proname = 'request_shop_return'")).c).toBe(1)
  })
})
