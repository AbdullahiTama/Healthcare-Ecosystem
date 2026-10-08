// @vitest-environment node
// Phase 13: properties of the WHOLE money system, not of one function. A seeded random sequence of real operations (top-ups,
// subscriptions, shop orders, card bookings, deliveries, the vendor release, refunds that complete or fail, coin withdrawals that
// complete or fail) is run through the real engines on a real Postgres (PGlite, every migration), and after every step and at the
// end these must hold:
//
//   I1  every coin wallet equals the sum of its ledger, and the ledger chain is intact
//   I2  no balance is ever negative (coin wallets, business held/available)
//   I3  a business wallet (held + available) equals the sum of its wallet ledger, ignoring the internal held->available moves
//   I4  a card payment is split completely: shop total = vendor share + commission + fulfilment/delivery; booking = business share + platform commission
//   I5  every settled payment has a provider transaction id, and its entity is paid (or refunded)
//   I6  a refund never exceeds what was paid; what was recovered from the vendor plus the shortfall never exceeds the vendor's share
//   I7  the database reconciliation finds nothing critical
//
// and one property of idempotency that no single-function test can state:
//
//   I8  REPLAY EQUIVALENCE: running the same sequence with EVERY engine call made twice ends in exactly the same books as running it
//       once. (Webhooks, redirects, retries and sweeps really do call these functions more than once.)
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const COIN = 20000

const MIGRATIONS_A = ['carefind_20261003_payment_intents_foundation', 'carefind_20261004_settle_payment_intent', 'carefind_20261005_coin_ledger']
const MIGRATIONS_B = ['carefind_20261005_coin_writers_use_ledger', 'carefind_20261005_lock_wallets_to_ledger', 'carefind_20261006_settle_plan_and_carehub_appointments',
  'carefind_20261007_commission_engine', 'carefind_20261008_commission_reconcile_first_payment', 'carefind_20261008_withdrawal_engine', 'carefind_20261009_refund_engine', 'carefind_20261010_central_settlement']
const MIGRATIONS_C = ['carefind_20261012_shop_vendor_payouts', 'carefind_20261014_reconciliation', 'carefind_20261015_reconciliation_ops', 'carefind_20261016_reconciliation_scale', 'carefind_20261017_engine_timeouts_and_hot_paths', 'carefind_20261019_red_team_fixes']

async function newDb() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(read('./fixtures/liveSchemaSubset.sql'))
  await db.exec(`
    alter table public.transactions add constraint transactions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
    alter table public.wallets add constraint wallets_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  `)
  for (const m of MIGRATIONS_A) await db.exec(M(m))
  await createLegacyStubs(db)
  for (const m of MIGRATIONS_B) await db.exec(M(m))
  await db.exec(`
    create function public.cancel_shop_order(p_order_id uuid, p_reason text default null) returns text language sql as $$ select 'old'::text $$;
    create function public.process_shop_return(p_return_id uuid, p_action text, p_notes text default null) returns text language sql as $$ select 'old'::text $$;
  `)
  for (const m of MIGRATIONS_C) await db.exec(M(m))
  return db
}

// ---- a tiny seeded PRNG, so a failing seed can be replayed exactly -----------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)]
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1))

const USERS = 6
const VENDORS = 3
const userId = (i) => `00000000-0000-4000-8000-${(0x1000 + i).toString(16).padStart(12, '0')}`
const vendorId = (i) => `00000000-0000-4000-9000-${(0x2000 + i).toString(16).padStart(12, '0')}`

/** The random program: a list of operations, generated BEFORE anything runs, so both runs execute exactly the same one. */
function makeProgram(seed, length) {
  const r = rng(seed)
  const ops = []
  const orders = []; const appts = []
  for (let k = 0; k < length; k++) {
    const roll = r()
    if (roll < 0.17) ops.push({ t: 'topup', u: int(r, 0, USERS - 1), coins: int(r, 5, 40) })
    else if (roll < 0.25) ops.push({ t: 'sub', s: int(r, 0, USERS - 1), c: int(r, 0, USERS - 1), coins: int(r, 4, 12) })
    else if (roll < 0.45) { orders.push(k); ops.push({ t: 'shop', k, c: int(r, 0, USERS - 1), v: int(r, 0, VENDORS - 1), subtotal: pick(r, [500000, 1000000, 2500000]), fulfil: pick(r, [0, 50000]) }) }
    else if (roll < 0.58) { appts.push(k); ops.push({ t: 'appt', k, v: int(r, 0, VENDORS - 1), fee: pick(r, [500000, 1000000, 2000000]) }) }
    else if (roll < 0.66 && orders.length) ops.push({ t: 'deliver', k: pick(r, orders), days: pick(r, [1, 10]) })
    else if (roll < 0.72) ops.push({ t: 'release' })
    else if (roll < 0.84 && (orders.length || appts.length)) {
      const shop = orders.length && (!appts.length || r() < 0.6)
      ops.push({ t: 'refund', shop, k: pick(r, shop ? orders : appts), outcome: pick(r, ['processed', 'processed', 'failed']), frac: shop ? pick(r, [1, 1, 0.5]) : 1 })
    } else if (roll < 0.97) ops.push({ t: 'withdraw', u: int(r, 0, USERS - 1), coins: int(r, 5, 12), outcome: pick(r, ['success', 'failed']) })
    else ops.push({ t: 'release' })
  }
  return ops
}

/** Executes a program against a database. `twice` calls every idempotent engine entry point two times. */
async function run(db, program, { twice, afterEach }) {
  const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
  const twiceOr = async (fn) => { const a = await fn(); if (twice) await fn(); return a }
  const nameOf = (k) => `s${k}`
  const state = { orders: new Map(), appts: new Map(), intents: new Map() }
  let txn = 0

  for (let i = 0; i < USERS; i++) await db.query('insert into auth.users (id) values ($1)', [userId(i)])
  for (let i = 0; i < USERS; i++) await db.query('insert into profiles (id, subscription_price) values ($1, 6) on conflict do nothing', [userId(i)])

  const settleIntent = (reference, amount) => twiceOr(async () => (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', `TX_${reference}`, amount, 'NGN'])).r)

  for (let step = 0; step < program.length; step++) {
    const op = program[step]
    if (op.t === 'topup') {
      const reference = `bench_topup_${step}`
      await db.query(`insert into payment_intents (reference, application, purpose, customer_id, expected_amount, metadata) values ($1,'carefind','wallet_topup',$2,$3,$4::jsonb)`, [reference, userId(op.u), op.coins * COIN, JSON.stringify({ coins: op.coins })])
      await settleIntent(reference, op.coins * COIN)
    } else if (op.t === 'sub') {
      if (op.s === op.c) continue
      const reference = `bench_sub_${step}`
      await db.query(`insert into payment_intents (reference, application, purpose, customer_id, entity_type, entity_id, expected_amount, metadata) values ($1,'carefind','creator_subscription',$2,'creator',$3,$4,$5::jsonb)`, [reference, userId(op.s), userId(op.c), op.coins * COIN, JSON.stringify({ coins: op.coins })])
      await db.query('update profiles set subscription_price = $2 where id = $1', [userId(op.c), op.coins])
      await settleIntent(reference, op.coins * COIN)
    } else if (op.t === 'shop') {
      const total = op.subtotal + op.fulfil
      const o = await one(`insert into shop_orders (order_ref, customer_id, vendor_business_id, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,$4,$5,$6) returning id`,
        [`ORD-${step}`, userId(op.c), vendorId(op.v), total, op.subtotal, Math.round(op.subtotal * 0.2)])
      const reference = `bench_shop_${step}`
      await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,$5)`, [reference, userId(op.c), vendorId(op.v), o.id, total])
      await db.query(`insert into shop_payments (order_id, payment_reference, amount_kobo, status) values ($1,$2,$3,'pending')`, [o.id, reference, total])
      state.orders.set(op.k, { id: o.id, total })
      await settleIntent(reference, total)
    } else if (op.t === 'appt') {
      const a = await one(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Bench','carehub',$2,'unpaid',$3) returning id`, [vendorId(op.v), op.fee, `appt_${step}`])
      const reference = `bench_chapp_${step}`
      await db.query(`insert into payment_intents (reference, application, purpose, business_id, entity_type, entity_id, expected_amount, metadata) values ($1,'carehub','appointment',$2,'appointment',$3,$4,'{}'::jsonb)`, [reference, vendorId(op.v), a.id, op.fee])
      state.appts.set(op.k, { id: a.id, fee: op.fee })
      await settleIntent(reference, op.fee)
    } else if (op.t === 'deliver') {
      const o = state.orders.get(op.k)
      if (!o) continue
      const cur = await one('select status, payment_status from shop_orders where id = $1', [o.id])
      if (cur.payment_status !== 'paid' || cur.status !== 'paid') continue
      await db.query(`update shop_orders set status = 'delivered' where id = $1`, [o.id])
      await db.query(`insert into shop_order_status_history (order_id, from_status, to_status, created_at) values ($1,'in_transit','delivered', now() - make_interval(days => $2))`, [o.id, op.days])
    } else if (op.t === 'release') {
      await twiceOr(() => one('select release_shop_vendor_credits(200) r'))
    } else if (op.t === 'refund') {
      const target = op.shop ? state.orders.get(op.k) : state.appts.get(op.k)
      if (!target) continue
      const amount = op.shop ? Math.max(1, Math.floor(target.total * op.frac)) : null
      const req = await twiceOr(async () => op.shop
        ? (await one(`select request_refund('shop_return','shop_order',$1,null,'test',false,$2) r`, [target.id, amount])).r
        : (await one(`select request_refund('booking_cancelled','appointment',$1,null,'test',false,null) r`, [target.id])).r)
      if (req && req.id && ['requested', 'already_requested'].includes(req.outcome)) {
        await twiceOr(() => one('select settle_refund($1,$2) r', [op.outcome, req.id]))
      }
    } else if (op.t === 'withdraw') {
      const bal = Number((await one('select balance from wallets where user_id = $1', [userId(op.u)]))?.balance ?? 0)
      if (bal < op.coins) continue
      const w = (await one(`select create_withdrawal($1,$2,'GTBank','058','0123456789','Ada Obi',null) r`, [userId(op.u), op.coins])).r
      if (w.outcome === 'ok') await twiceOr(() => one('select settle_withdrawal($1,$2,null,null,null) r', [op.outcome, w.reference]))
    }
    if (afterEach) await afterEach(step)
  }
}

/** Everything that matters about the books, keyed by NAMES (never by generated ids), so two runs can be compared. */
async function digest(db) {
  const rows = async (sql) => (await db.query(sql)).rows
  const d = {}
  d.coinWallets = await rows(`select user_id, balance::float b from wallets order by user_id`)
  d.coinLedger = await rows(`select user_id, kind, count(*)::int n, sum(delta)::int s from coin_ledger group by 1,2 order by 1,2`)
  d.businessWallets = await rows(`select business_id, held_balance::int h, available_balance::int a from business_wallets order by 1`)
  d.businessLedger = await rows(`select business_id, type, count(*)::int n, sum(amount)::bigint::text s from business_wallet_transactions group by 1,2 order by 1,2`)
  d.platform = await rows(`select type, count(*)::int n, sum(amount)::bigint::text s from platform_transactions group by 1 order by 1`)
  d.orders = await rows(`select o.order_ref, o.status, o.payment_status, c.status cstatus, c.amount_kobo::int camt, c.reversed_kobo::int crev, c.released_kobo::int crel, c.release_shortfall_kobo::int cshort
                           from shop_orders o left join shop_vendor_credits c on c.order_id = o.id order by o.order_ref`)
  d.appointments = await rows(`select payment_reference, payment_status, payment_channel from appointments order by 1`)
  d.intents = await rows(`select reference, status, provider_transaction_id from payment_intents order by 1`)
  d.refunds = await rows(`select coalesce(o.order_ref, a.payment_reference) entity, r.kind, r.status, r.amount_kobo::int amt, r.business_recovered_held_kobo held, r.business_recovered_available_kobo avail, r.business_shortfall_kobo short
                            from refunds r left join shop_orders o on r.entity_type = 'shop_order' and o.id = r.entity_id left join appointments a on r.entity_type = 'appointment' and a.id = r.entity_id order by 1, 3`)
  d.withdrawals = await rows(`select user_id, amount, status from withdrawal_requests order by user_id, amount, status`)
  d.subscriptions = await rows(`select subscriber_id, creator_id, price from creator_subscriptions order by 1,2`)
  return JSON.stringify(d)
}

/** Invariants that must hold at every point. `deep` adds the ones that need a full scan. */
async function assertInvariants(db, label, { deep = false } = {}) {
  const rows = async (sql, p = []) => (await db.query(sql, p)).rows
  // I1
  expect(await rows('select * from reconcile_coin_wallets()'), `${label}: I1 wallet vs ledger`).toEqual([])
  expect(await rows('select * from verify_coin_ledger_chain()'), `${label}: I1 ledger chain`).toEqual([])
  // I2
  expect(await rows('select user_id from wallets where balance < 0'), `${label}: I2 coin wallet negative`).toEqual([])
  expect(await rows('select business_id from business_wallets where held_balance < 0 or available_balance < 0'), `${label}: I2 business wallet negative`).toEqual([])
  // I3 (the internal held -> available moves are not income or outflow)
  expect(await rows(`select w.business_id, (w.held_balance + w.available_balance)::bigint::text wallet, coalesce(l.s, 0)::bigint::text ledger
                       from business_wallets w left join (select business_id, sum(amount) s from business_wallet_transactions where type not in ('shop_release', 'release') group by 1) l on l.business_id = w.business_id
                      where (w.held_balance + w.available_balance) <> coalesce(l.s, 0)`), `${label}: I3 business wallet vs ledger`).toEqual([])
  if (!deep) return
  // I4 shop: total paid = vendor share + commission + fulfilment/delivery (the rest of the total)
  expect(await rows(`select o.order_ref, o.total_kobo, c.amount_kobo, c.commission_kobo, o.subtotal_kobo
                       from shop_orders o join shop_vendor_credits c on c.order_id = o.id
                      where c.amount_kobo + c.commission_kobo <> o.subtotal_kobo or o.total_kobo < o.subtotal_kobo`), `${label}: I4 shop split`).toEqual([])
  // I4 booking: business share + platform commission = what was paid
  expect(await rows(`select a.payment_reference, a.fee_amount, b.amount::int business, p.amount::int platform
                       from appointments a join business_wallet_transactions b on b.appointment_id = a.id and b.type = 'booking_credit'
                       join platform_transactions p on p.appointment_id = a.id and p.type = 'commission'
                      where b.amount + p.amount <> a.fee_amount`), `${label}: I4 booking split`).toEqual([])
  // I5
  expect(await rows(`select reference from payment_intents where status = 'settled' and provider_transaction_id is null`), `${label}: I5 settled without txn id`).toEqual([])
  expect(await rows(`select i.reference from payment_intents i join shop_orders o on o.id = i.entity_id where i.status = 'settled' and i.purpose = 'shop_order' and o.payment_status not in ('paid', 'refunded')`), `${label}: I5 shop`).toEqual([])
  expect(await rows(`select i.reference from payment_intents i join appointments a on a.id = i.entity_id where i.status = 'settled' and i.purpose = 'appointment' and a.payment_status not in ('paid', 'refunded')`), `${label}: I5 appointment`).toEqual([])
  // I6
  expect(await rows(`select r.reference from refunds r join payment_intents i on i.id = r.payment_intent_id where r.amount_kobo > i.expected_amount`), `${label}: I6 refund over paid`).toEqual([])
  expect(await rows(`select r.reference from refunds r join shop_vendor_credits c on c.order_id = r.entity_id
                      where r.entity_type = 'shop_order' and r.business_recovered_held_kobo + r.business_recovered_available_kobo + r.business_shortfall_kobo > c.amount_kobo`), `${label}: I6 recovery over share`).toEqual([])
  expect(await rows(`select reference from refunds where status = 'completed' and kind = 'card' and amount_kobo is null`), `${label}: I6 completed refund without amount`).toEqual([])
  // I7
  const totals = (await rows('select run_db_reconciliation(true) r'))[0].r.totals
  expect(totals.open_critical, `${label}: I7 critical findings`).toBe(0)
}

const SEEDS = [11, 2026, 90210, 424242]
const LENGTH = 60
// what the programs together actually exercised (asserted at the end, so the properties cannot pass vacuously)
const seen = { refundCompleted: 0, refundFailed: 0, partialRefund: 0, withdrawalCompleted: 0, withdrawalRefunded: 0, creditReleased: 0, creditReversed: 0, subscriptions: 0 }

describe('financial invariants over random programs (real engines, real Postgres)', () => {
  let dbs = {}
  beforeAll(async () => { /* each seed builds its own two databases inside its test */ }, 10)

  for (const seed of SEEDS) {
    it(`seed ${seed}: the books balance after every step, and replaying every call twice ends in exactly the same books`, async () => {
      const program = makeProgram(seed, LENGTH)
      const kinds = program.reduce((m, o) => ({ ...m, [o.t]: (m[o.t] || 0) + 1 }), {})
      // the program must actually exercise the system, or the properties are vacuous
      expect(kinds.shop).toBeGreaterThan(2)
      expect(kinds.appt).toBeGreaterThan(1)
      expect(kinds.topup).toBeGreaterThan(1)

      const once = await newDb()
      await run(once, program, { twice: false, afterEach: (s) => assertInvariants(once, `seed ${seed} step ${s} (once)`) })
      await assertInvariants(once, `seed ${seed} final (once)`, { deep: true })
      const digestOnce = await digest(once)
      await once.close()

      const twice = await newDb()
      await run(twice, program, { twice: true, afterEach: (s) => assertInvariants(twice, `seed ${seed} step ${s} (twice)`) })
      await assertInvariants(twice, `seed ${seed} final (twice)`, { deep: true })
      const digestTwice = await digest(twice)
      await twice.close()

      expect(JSON.parse(digestTwice)).toEqual(JSON.parse(digestOnce))      // I8
      // and the run did something: money moved and at least one refund was attempted
      const d = JSON.parse(digestOnce)
      expect(d.intents.filter((x) => x.status === 'settled' || x.status === 'refunded').length).toBeGreaterThan(5)
      seen.refundCompleted += d.refunds.filter((x) => x.status === 'completed').length
      seen.refundFailed += d.refunds.filter((x) => x.status === 'failed').length
      seen.partialRefund += d.orders.filter((x) => x.crev > 0 && x.cstatus !== 'reversed').length
      seen.withdrawalCompleted += d.withdrawals.filter((x) => x.status === 'completed').length
      seen.withdrawalRefunded += d.withdrawals.filter((x) => x.status === 'refunded').length
      seen.creditReleased += d.orders.filter((x) => x.cstatus === 'released').length
      seen.creditReversed += d.orders.filter((x) => x.cstatus === 'reversed').length
      seen.subscriptions += d.subscriptions.length
    }, 600_000)
  }

  it('across the seeds every interesting behaviour really happened (the properties above are not vacuous)', () => {
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0)
  })

  it('the generator is deterministic (a failing seed can be replayed exactly)', () => {
    expect(makeProgram(7, 30)).toEqual(makeProgram(7, 30))
    expect(makeProgram(7, 30)).not.toEqual(makeProgram(8, 30))
  })
})
