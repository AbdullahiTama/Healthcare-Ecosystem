// @vitest-environment node
// Phase 05 (2/3): every CareCoin writer posts through the ledger. Real Postgres (PGlite), the real
// migrations in production order, and the legacy functions pre-created with production's grants so
// CREATE OR REPLACE behaves as it will live. After every scenario the books must balance:
// wallet = sum(ledger), and the running-balance chain is intact.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 40000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}`

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
  await db.exec(read('../../../../../supabase/migrations/carefind_20261005_coin_ledger.sql'))
  await createLegacyStubs(db)
  await db.exec(read('../../../../../supabase/migrations/carefind_20261005_coin_writers_use_ledger.sql'))
  // ...and with the lock ON: every writer below must work while hand-written balance changes are refused.
  await db.exec(read('../../../../../supabase/migrations/carefind_20261005_lock_wallets_to_ledger.sql'))
  // Owner decision Q1: the 20% platform fee on the coin-paid and legacy settlement paths
  await db.exec(read('../../../../../supabase/migrations/carefind_20261006_coin_paths_platform_fee.sql'))
}, 180_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const bal = async (u) => (await one('select balance from wallets where user_id = $1', [u]))?.balance ?? 0
const ledger = async (u) => (await db.query('select kind, delta, balance_after, reference, counterparty_id from coin_ledger where user_id = $1 order by id', [u])).rows
const user = async (coins = 0) => {
  const u = uid()
  await db.query('insert into auth.users (id) values ($1)', [u])
  await db.query('insert into profiles (id) values ($1) on conflict do nothing', [u])
  if (coins) await db.query(`select _post_coin_entry($1,$2,'topup',$3)`, [u, coins, ref('seed')])
  return u
}
const as = (u) => db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role','authenticated', false)`, [u || ''])
const call = async (sql, p = []) => Object.values((await one(`select ${sql} r`, p)).r === undefined ? {} : { r: (await one(`select ${sql} r`, p)).r }).at(0)
const booksBalance = async () => {
  expect((await db.query('select * from reconcile_coin_wallets()')).rows).toEqual([])
  expect((await db.query('select * from verify_coin_ledger_chain()')).rows).toEqual([])
}

describe('card-settlement handlers (engine) credit through the ledger', () => {
  const settle = async (i, txn) => (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [i.reference, 'paystack', txn, i.expected_amount, 'NGN'])).r
  const intent = async (over = {}) => {
    const r = { reference: `${ref('cf')}_abcdefgh`, purpose: 'wallet_topup', customer_id: null, entity_type: null, entity_id: null, expected_amount: 100000, metadata: { coins: 5 }, ...over }
    return (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, entity_type, entity_id, expected_amount, metadata) values ($1,'carefind',$2,$3,$4,$5,$6,$7::jsonb) returning *`,
      [r.reference, r.purpose, r.customer_id, r.entity_type, r.entity_id, r.expected_amount, JSON.stringify(r.metadata)])).rows[0]
  }

  it('top-up: a ledger entry with the payment reference; replay credits nothing more', async () => {
    const u = await user()
    const i = await intent({ customer_id: u })
    expect((await settle(i, 'T1')).outcome).toBe('settled')
    expect((await settle(i, 'T1')).outcome).toBe('already_settled')
    expect(await bal(u)).toBe(5)
    expect(await ledger(u)).toEqual([{ kind: 'topup', delta: 5, balance_after: 5, reference: i.reference, counterparty_id: null }])
    await booksBalance()
  })

  it('card subscription: creator credited 80% via the ledger with the subscriber as counterparty; subscriber untouched', async () => {
    const creator = await user(), sub = await user(7)
    await db.query('update profiles set subscription_price = 10 where id = $1', [creator])
    const i = await intent({ purpose: 'creator_subscription', customer_id: sub, entity_type: 'creator', entity_id: creator, expected_amount: 200000, metadata: { coins: 10 } })
    expect((await settle(i, 'T2')).creator_coins).toBe(8)
    expect(await ledger(creator)).toEqual([{ kind: 'subscription_earning', delta: 8, balance_after: 8, reference: i.reference, counterparty_id: sub }])
    expect(await bal(sub)).toBe(7)
    await booksBalance()
  })

  it('card consultation: professional credited through the ledger; the patient\'s wallet is never debited', async () => {
    const pro = await user(), patient = await user(3)
    await db.query(`insert into professional_consultations (professional_id, patient_id, fee, status) values ($1,$1,5000,'setup')`, [pro])
    const i = await intent({ purpose: 'consultation', customer_id: patient, entity_type: 'professional', entity_id: pro, expected_amount: 500000, metadata: {} })
    await settle(i, 'T3')
    expect((await ledger(pro))[0]).toMatchObject({ kind: 'consultation_earning', delta: 20, counterparty_id: patient })
    expect(await bal(patient)).toBe(3)
    await booksBalance()
  })
})

describe('legacy card-settlement RPCs', () => {
  it('credit_wallet_topup credits once and reports a replay with the current balance', async () => {
    const u = await user()
    const r1 = (await one('select * from credit_wallet_topup($1,$2,$3,$4)', [u, 5, 950, 'leg-topup-1']))
    expect(r1).toMatchObject({ already_processed: false, new_balance: 5 })
    const r2 = (await one('select * from credit_wallet_topup($1,$2,$3,$4)', [u, 5, 950, 'leg-topup-1']))
    expect(r2).toMatchObject({ already_processed: true, new_balance: 5 })
    expect(await bal(u)).toBe(5)
    await booksBalance()
  })

  it.each([[0], [-3]])('credit_wallet_topup refuses %p coins', async (coins) => {
    await expect(db.query('select * from credit_wallet_topup($1,$2,$3,$4)', [await user(), coins, 100, ref('x')])).rejects.toThrow(/positive whole number/)
  })

  it('settle_subscription_payment credits the creator 80% through the ledger, once, without debiting the subscriber', async () => {
    const creator = await user(), sub = await user(4)
    await db.query('select * from settle_subscription_payment($1,$2,$3,$4,$5)', [sub, creator, 3, 600, 'leg-sub-1'])
    const again = await one('select * from settle_subscription_payment($1,$2,$3,$4,$5)', [sub, creator, 3, 600, 'leg-sub-1'])
    expect(again.already_processed).toBe(true)
    expect(await bal(creator)).toBe(2) // 3 coins less the 20% platform fee, rounded down
    expect(await bal(sub)).toBe(4)
    await booksBalance()
  })

  it('settle_consultation_payment books once, credits the professional through the ledger, and a second payment for the same pair credits nothing', async () => {
    const pro = await user(), patient = await user()
    await db.query('select * from settle_consultation_payment($1,$2,$3,$4)', [patient, pro, 1000, 'leg-con-1'])
    const second = await one('select * from settle_consultation_payment($1,$2,$3,$4)', [patient, pro, 1000, 'leg-con-2'])
    expect(second).toMatchObject({ already_processed: false, already_booked: true })
    expect(await bal(pro)).toBe(4) // N1,000 = 5 coins, less the 20% platform fee, rounded down
    await booksBalance()
  })
})

describe('pay_booking_with_credits', () => {
  const appt = async (fee = 100000, over = {}) => {
    const business = uid()
    const a = (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada','carefind',$2,$3,$4) returning id`, [business, fee, over.status || 'unpaid', ('ref' in over ? over.ref : ref('bk'))])).rows[0]
    return { id: a.id, business }
  }
  const pay = async (u, a) => (await one('select pay_booking_with_credits($1,$2) r', [u, a])).r

  it('debits the patient\'s wallet through the ledger (fee rounded up to whole coins) and credits the business', async () => {
    const u = await user(20), a = await appt(100000)
    expect(await pay(u, a.id)).toBe('ok')
    expect(await bal(u)).toBe(15) // N1,000 = 5 coins
    expect((await ledger(u)).at(-1)).toMatchObject({ kind: 'booking_payment', delta: -5 })
    expect(Number((await one('select held_balance h from business_wallets where business_id = $1', [a.business])).h)).toBe(80000)
    await booksBalance()
  })

  it('a second payment returns already_paid and debits nothing more', async () => {
    const u = await user(20), a = await appt(100000)
    await pay(u, a.id)
    expect(await pay(u, a.id)).toBe('already_paid')
    expect(await bal(u)).toBe(15)
  })

  it.each([
    ['insufficient coins', async () => ({ u: await user(2), a: await appt(100000) }), 'insufficient'],
    ['no wallet', async () => ({ u: uid(), a: await appt(100000) }), 'no_wallet'],
    ['no reference', async () => ({ u: await user(20), a: await appt(100000, { ref: null }) }), 'no_reference'],
    ['no fee', async () => ({ u: await user(20), a: await appt(0) }), 'no_fee'],
  ])('%s -> %s, nothing moves', async (_l, setup, expected) => {
    const { u, a } = await setup()
    const before = await bal(u)
    expect(await pay(u, a.id)).toBe(expected)
    expect(await bal(u)).toBe(before)
    expect((await db.query('select 1 from business_wallets where business_id = $1', [a.business])).rows).toHaveLength(0)
  })
})

describe('pay_creator_subscription (coins)', () => {
  const pay = async (me, creator, price) => { await as(me); return (await one('select pay_creator_subscription($1,$2) r', [creator, price])).r }
  const creatorWith = async (price) => { const c = await user(); await db.query('update profiles set subscription_price = $2 where id = $1', [c, price]); return c }

  it('subscriber pays the full price, the creator receives 80%: two legs, one reference, subscription granted', async () => {
    const creator = await creatorWith(6), me = await user(10)
    expect(await pay(me, creator, 6)).toBe('ok')
    expect(await bal(me)).toBe(4)       // pays the full price
    expect(await bal(creator)).toBe(4)  // receives 80% (floor 4.8); the platform keeps 2
    const a = (await ledger(me)).at(-1), b = (await ledger(creator))[0]
    expect(a).toMatchObject({ kind: 'subscription_payment', delta: -6, counterparty_id: creator })
    expect(b).toMatchObject({ kind: 'subscription_earning', delta: 4, counterparty_id: me })
    expect(a.reference).toBe(b.reference)
    expect((await db.query('select 1 from creator_subscriptions where subscriber_id = $1 and creator_id = $2', [me, creator])).rows).toHaveLength(1)
    await booksBalance()
  })

  it('insufficient coins (including no wallet at all) moves nothing and grants nothing', async () => {
    const creator = await creatorWith(6), poor = await user(2), none = uid()
    expect(await pay(poor, creator, 6)).toBe('insufficient')
    expect(await pay(none, creator, 6)).toBe('insufficient')
    expect(await bal(poor)).toBe(2)
    expect(await bal(creator)).toBe(0)
    expect((await db.query('select 1 from creator_subscriptions where creator_id = $1', [creator])).rows).toHaveLength(0)
  })
})

describe('pay_professional_consultation (coins)', () => {
  const pay = async (me, pro) => { await as(me); return (await one('select pay_professional_consultation($1) r', [pro])).r }
  const proWithOffer = async (fee) => { const p = await user(); await db.query(`insert into professional_consultations (professional_id, patient_id, type, fee, status) values ($1,$1,'video',$2,'setup')`, [p, fee]); return p }

  it('the patient pays in full, the professional receives 80%, and the consultation is booked', async () => {
    const pro = await proWithOffer(1000), me = await user(10)
    expect(await pay(me, pro)).toBe('ok')
    expect(await bal(me)).toBe(5)   // pays all 5 coins (N1,000)
    expect(await bal(pro)).toBe(4)  // receives 80%; the platform keeps 1
    expect((await ledger(me)).at(-1)).toMatchObject({ kind: 'consultation_payment', delta: -5, counterparty_id: pro })
    await booksBalance()
  })

  it('an already-booked patient is refused and NO coins move (the ledger rolls back with the booking)', async () => {
    const pro = await proWithOffer(1000), me = await user(20)
    await pay(me, pro)
    expect(await pay(me, pro)).toBe('already_booked')
    expect(await bal(me)).toBe(15)
    expect(await bal(pro)).toBe(4)
    expect((await ledger(me)).filter((e) => e.kind === 'consultation_payment')).toHaveLength(1)
    await booksBalance()
  })

  it('insufficient coins, no offer, signed out and self-booking are all refused without moving anything', async () => {
    const pro = await proWithOffer(1000)
    expect(await pay(await user(2), pro)).toBe('insufficient')
    expect(await pay(await user(20), await user())).toBe('no_setup')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
    expect((await one('select pay_professional_consultation($1) r', [pro])).r).toBe('not_signed_in')
    expect(await pay(pro, pro)).toBe('self_consultation')
  })
})

describe('20% platform fee on the CareCoin paths (owner decision Q1)', () => {
  const sub = async (me, creator, price) => { await as(me); return (await one('select pay_creator_subscription($1,$2) r', [creator, price])).r }
  const consult = async (me, pro) => { await as(me); return (await one('select pay_professional_consultation($1) r', [pro])).r }
  const creatorWith = async (price) => { const c = await user(); await db.query('update profiles set subscription_price = $2 where id = $1', [c, price]); return c }
  const platformRows = async (type, reference) => (await db.query('select user_id, amount from transactions where type = $1 and reference = $2', [type, reference])).rows

  it.each([[1, 0, 1], [2, 1, 1], [5, 4, 1], [10, 8, 2], [12, 9, 3]])('a %i-coin subscription pays the creator %i and the platform keeps %i', async (price, creatorGets, platformGets) => {
    const creator = await creatorWith(price), me = await user(price + 3)
    expect(await sub(me, creator, price)).toBe('ok')
    expect(await bal(me)).toBe(3)
    expect(await bal(creator)).toBe(creatorGets)
    const debit = (await ledger(me)).at(-1)
    expect(debit.delta).toBe(-price)
    const fee = await platformRows('platform_fee_subscription', debit.reference)
    expect(fee).toHaveLength(1)
    expect(fee[0].user_id).toBeNull()
    expect(Number(fee[0].amount)).toBe(platformGets)
    // conservation: what the payer lost = what the creator gained + what the platform kept
    expect(price).toBe(creatorGets + platformGets)
    await booksBalance()
  })

  it('a 1-coin subscription writes no creator ledger entry at all (nothing to credit) but still debits the subscriber', async () => {
    const creator = await creatorWith(1), me = await user(4)
    await sub(me, creator, 1)
    expect(await ledger(creator)).toEqual([])
    expect(await bal(me)).toBe(3)
  })

  it("records the platform share in the debit entry's meta", async () => {
    const creator = await creatorWith(10), me = await user(10)
    await sub(me, creator, 10)
    const e = (await db.query(`select meta from coin_ledger where user_id = $1 and kind = 'subscription_payment' order by id desc limit 1`, [me])).rows[0]
    expect(e.meta.platform_coins).toBe(2)
  })

  it('a consultation: N1,050 = 6 coins, the professional receives floor(6 x 0.8) = 4, the platform keeps 2', async () => {
    const pro = await user()
    await db.query(`insert into professional_consultations (professional_id, patient_id, type, fee, status) values ($1,$1,'video',1050,'setup')`, [pro])
    const me = await user(10)
    expect(await consult(me, pro)).toBe('ok')
    expect(await bal(me)).toBe(4)
    expect(await bal(pro)).toBe(4)
    const debit = (await ledger(me)).at(-1)
    expect(Number((await platformRows('platform_fee_consultation', debit.reference))[0].amount)).toBe(2)
    await booksBalance()
  })

  it('takes both rates from financial_config, not from the function', async () => {
    await db.query(`update financial_config set value = 0.5 where key in ('subscription_platform_rate', 'consultation_platform_rate')`)
    try {
      const creator = await creatorWith(10), me = await user(30)
      await sub(me, creator, 10)
      expect(await bal(creator)).toBe(5)
      const pro = await user()
      await db.query(`insert into professional_consultations (professional_id, patient_id, type, fee, status) values ($1,$1,'video',2000,'setup')`, [pro]) // 10 coins
      await consult(me, pro)
      expect(await bal(pro)).toBe(5)
    } finally {
      await db.query(`update financial_config set value = 0.20 where key in ('subscription_platform_rate', 'consultation_platform_rate')`)
    }
  })

  it('insufficient funds still moves nothing and records no fee', async () => {
    const creator = await creatorWith(10), poor = await user(9)
    const feesBefore = Number((await one(`select count(*) c from transactions where type = 'platform_fee_subscription'`)).c)
    expect(await sub(poor, creator, 10)).toBe('insufficient')
    expect(await bal(poor)).toBe(9)
    expect(await bal(creator)).toBe(0)
    expect(Number((await one(`select count(*) c from transactions where type = 'platform_fee_subscription'`)).c)).toBe(feesBefore)
  })

  it('_post_coin_split is private, refuses a share above the total, and refuses an unaffordable total without writing', async () => {
    const r = await one(`select has_function_privilege('anon', p.oid,'execute') a, has_function_privilege('authenticated', p.oid,'execute') u, has_function_privilege('service_role', p.oid,'execute') s from pg_proc p where p.proname = '_post_coin_split'`)
    expect(r).toEqual({ a: false, u: false, s: false })
    const a = await user(5), b = await user()
    await expect(db.query(`select _post_coin_split($1,$2,5,6,'subscription_payment','subscription_earning','x')`, [a, b])).rejects.toThrow(/share must be between/)
    expect((await one(`select _post_coin_split($1,$2,9,7,'subscription_payment','subscription_earning',$3) ok`, [a, b, ref('sp')])).ok).toBe(false)
    expect(await bal(a)).toBe(5)
    expect(await bal(b)).toBe(0)
  })
})

describe('send_gift', () => {
  const gift = async (me, to, coins) => { await as(me); return (await one(`select send_gift($1,$2,'rose','R',null,null) r`, [to, coins])).r }

  it('moves coins sender -> recipient as one transfer; the sender is whoever is signed in', async () => {
    const a = await user(10), b = await user()
    expect(await gift(a, b, 4)).toBe('ok')
    expect(await bal(a)).toBe(6)
    expect(await bal(b)).toBe(4)
    expect((await ledger(a)).at(-1)).toMatchObject({ kind: 'gift_sent', delta: -4, counterparty_id: b })
    expect((await ledger(b))[0]).toMatchObject({ kind: 'gift_received', delta: 4, counterparty_id: a })
    expect(Number((await one('select coins c from gifts where sender_id = $1', [a])).c)).toBe(4)
    await booksBalance()
  })

  it.each([[0], [-5], [null]])('refuses a gift of %p coins explicitly (F-13) and moves nothing', async (coins) => {
    const a = await user(10), b = await user(10)
    expect(await gift(a, b, coins)).toBe('invalid_coins')
    expect(await bal(a)).toBe(10)
    expect(await bal(b)).toBe(10)
  })

  it('refuses self-gifts, unknown recipients, insufficient funds and a signed-out caller', async () => {
    const a = await user(3)
    expect(await gift(a, a, 1)).toBe('self')
    expect(await gift(a, uid(), 1)).toBe('recipient_not_found')
    expect(await gift(a, await user(), 4)).toBe('insufficient')
    expect(await bal(a)).toBe(3)
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
    expect((await one(`select send_gift($1,1,'x','x',null,null) r`, [a])).r).toBe('unauthorized')
  })

  it('there is no sender argument at all: one function, signature fixed', async () => {
    const r = await db.query(`select pg_get_function_identity_arguments(p.oid) a from pg_proc p where p.proname = 'send_gift'`)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].a).not.toMatch(/sender/i)
  })
})

describe('withdrawals', () => {
  const request = async (u, amount, extra = {}) => (await one('select request_withdrawal($1,$2,$3,$4,$5,$6,$7) r', [u, amount, 'GTB', extra.account ?? '0123456789', 'Ada Obi', extra.reference ?? null, extra.cap ?? null])).r

  it('debits the wallet through the ledger and records the request', async () => {
    const u = await user(30)
    expect(await request(u, 10, { reference: 'wd-ref-1' })).toBe('ok')
    expect(await bal(u)).toBe(20)
    expect((await ledger(u)).at(-1)).toMatchObject({ kind: 'withdrawal', delta: -10 })
    expect((await one(`select status, amount from withdrawal_requests where paystack_reference = 'wd-ref-1'`))).toMatchObject({ status: 'pending', amount: 10 })
    await booksBalance()
  })

  it('takes the minimum from financial_config (5), refuses missing bank details and insufficient coins', async () => {
    const u = await user(30)
    expect(await request(u, 4)).toBe('below_minimum')
    expect((await one('select request_withdrawal($1,$2,$3,$4,$5) r', [u, 10, '', '0123456789', 'x'])).r).toBe('missing_bank_details')
    expect(await request(await user(3), 5)).toBe('insufficient')
    expect(await bal(u)).toBe(30)
  })

  it('enforces the daily cap across requests', async () => {
    const u = await user(100)
    expect(await request(u, 30, { cap: 50 })).toBe('ok')
    expect(await request(u, 30, { cap: 50 })).toBe('daily_limit')
    expect(await bal(u)).toBe(70)
  })

  it('an exact replay of a request is ok and debits NOTHING more', async () => {
    const u = await user(30)
    await request(u, 10, { reference: 'wd-ref-2' })
    expect(await request(u, 10, { reference: 'wd-ref-2' })).toBe('ok')
    expect(await bal(u)).toBe(20)
    expect((await ledger(u)).filter((e) => e.kind === 'withdrawal')).toHaveLength(1)
  })

  it('F-01: a known reference carrying a DIFFERENT amount or account is a conflict, never a free ok', async () => {
    const u = await user(100)
    await request(u, 5, { reference: 'wd-ref-3' })
    expect(await request(u, 50, { reference: 'wd-ref-3' })).toBe('reference_conflict')
    expect(await request(u, 5, { reference: 'wd-ref-3', account: '9999999999' })).toBe('reference_conflict')
    expect(await bal(u)).toBe(95)
    // and someone else cannot ride on a user's reference
    expect(await request(await user(100), 5, { reference: 'wd-ref-3' })).toBe('reference_conflict')
  })

  it('rejecting refunds exactly once, however many times it is asked', async () => {
    const u = await user(30)
    await request(u, 10, { reference: 'wd-ref-4' })
    const id = (await one(`select id from withdrawal_requests where paystack_reference = 'wd-ref-4'`)).id
    expect((await one('select reject_withdrawal_request($1) r', [id])).r).toBe('ok')
    expect((await one('select reject_withdrawal_request($1) r', [id])).r).toBe('already_rejected')
    expect(await bal(u)).toBe(30)
    expect((await ledger(u)).filter((e) => e.kind === 'withdrawal_refund')).toHaveLength(1)
    expect((await one('select reject_withdrawal_request($1) r', [uid()])).r).toBe('not_found')
    await booksBalance()
  })
})

describe('refund_appointment_payment (CareCoin leg)', () => {
  it('returns the coins the patient paid, once; a second refund is refused', async () => {
    const u = await user(20)
    const business = uid()
    const a = (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada','carefind',100000,'unpaid',$2) returning id`, [business, ref('bk')])).rows[0]
    await one('select pay_booking_with_credits($1,$2) r', [u, a.id])
    expect(await bal(u)).toBe(15)
    expect((await one('select refund_appointment_payment($1) r', [a.id])).r).toBe('ok')
    expect(await bal(u)).toBe(20) // ceil((80000/0.8)/20000) = 5 coins back
    expect((await ledger(u)).at(-1)).toMatchObject({ kind: 'booking_refund', delta: 5 })
    expect((await one('select refund_appointment_payment($1) r', [a.id])).r).toBe('already_refunded')
    expect(await bal(u)).toBe(20)
    await booksBalance()
  })
})

describe('access is unchanged and no function writes a balance by hand', () => {
  it('keeps the production grants (client-callable only where it already was)', async () => {
    const r = await db.query(`
      select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u, has_function_privilege('service_role', p.oid, 'execute') s
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('credit_wallet_topup','settle_subscription_payment','settle_consultation_payment','pay_booking_with_credits','pay_creator_subscription','pay_professional_consultation','send_gift','request_withdrawal','reject_withdrawal_request','refund_appointment_payment')`)
    const by = Object.fromEntries(r.rows.map((x) => [x.proname, x]))
    expect(r.rows).toHaveLength(10)
    expect(r.rows.filter((p) => p.a).map((p) => p.proname)).toEqual([]) // which function leaks to anon, if any
    for (const p of r.rows) expect(p.a).toBe(false)
    for (const name of ['pay_creator_subscription', 'pay_professional_consultation', 'send_gift']) expect(by[name].u).toBe(true)
    for (const name of ['credit_wallet_topup', 'settle_subscription_payment', 'settle_consultation_payment', 'pay_booking_with_credits', 'request_withdrawal', 'reject_withdrawal_request', 'refund_appointment_payment']) expect(by[name].u).toBe(false)
  })

  it('the books balance across everything this file did', async () => {
    await booksBalance()
  })
})
