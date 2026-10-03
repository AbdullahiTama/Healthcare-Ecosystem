// @vitest-environment node
// Financial program, Phase 04: settle_payment_intent() against a REAL Postgres (PGlite) with the real
// migrations and a replica of the live tables it touches. PGlite is a single connection, so the
// "webhook + redirect" cases prove IDEMPOTENCY under replay (the second call finds the intent settled
// and moves nothing); true parallel interleaving needs a multi-connection Postgres - see Phase 13.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const FIXTURE = read('./fixtures/liveSchemaSubset.sql')
const M_INTENTS = read('../../../../../supabase/migrations/carefind_20261003_payment_intents_foundation.sql')
const M_ENGINE = read('../../../../../supabase/migrations/carefind_20261004_settle_payment_intent.sql')

let db
let n = 0
const uid = () => {
  const h = (++n).toString(16).padStart(12, '0')
  return `00000000-0000-4000-8000-${h}`
}
const ref = (p) => `${p}_${++n}_${Math.random().toString(36).slice(2, 8)}`
const COIN = 20000

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(FIXTURE)
  await db.exec(M_INTENTS)
  await db.exec(M_ENGINE)
}, 120_000) // PGlite start-up + migrations is slow when many suites run at once

// ---- helpers ------------------------------------------------------------------------------
async function intent(over = {}) {
  const r = {
    reference: ref('ref'), application: 'carefind', purpose: 'wallet_topup', customer_id: uid(), business_id: null,
    entity_type: null, entity_id: null, expected_amount: 5 * COIN, metadata: { coins: 5 }, ...over,
  }
  const q = await db.query(
    `insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) returning *`,
    [r.reference, r.application, r.purpose, r.customer_id, r.business_id, r.entity_type, r.entity_id, r.expected_amount, JSON.stringify(r.metadata)]
  )
  return q.rows[0]
}
async function settle(i, over = {}) {
  const a = { provider: 'paystack', txn: `T${++n}`, amount: i.expected_amount, currency: 'NGN', ...over }
  const q = await db.query('select settle_payment_intent($1,$2,$3,$4,$5) r', [i.reference, a.provider, a.txn, a.amount, a.currency])
  return q.rows[0].r
}
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const bal = async (u) => Number((await one('select balance from wallets where user_id = $1', [u]))?.balance ?? NaN)
const status = async (id) => (await one('select status, provider_transaction_id, metadata from payment_intents where id = $1', [id]))
const count = async (sql, p) => Number((await one(sql, p)).c)
const wallet = (u, b) => db.query('insert into wallets (user_id, balance) values ($1,$2)', [u, b])

// ---- engine-level behaviour ----------------------------------------------------------------
describe('settle_payment_intent: identity, amount and idempotency', () => {
  it('reports an unknown reference without touching anything', async () => {
    const r = (await db.query(`select settle_payment_intent('no_such_reference_1','paystack','T1',100,'NGN') r`)).rows[0].r
    expect(r.outcome).toBe('unknown_reference')
  })

  it('settles once; a replay (webhook after redirect) is already_settled and moves nothing', async () => {
    const i = await intent({ metadata: { coins: 5 } })
    const first = await settle(i, { txn: 'TX_SAME' })
    expect(first.outcome).toBe('settled')
    const again = await settle(i, { txn: 'TX_SAME' })
    expect(again.outcome).toBe('already_settled')
    expect(await bal(i.customer_id)).toBe(5)
    expect(await count(`select count(*) c from transactions where reference = $1`, [i.reference])).toBe(1)
  })

  it('a replay carrying a different txn id still cannot settle twice', async () => {
    const i = await intent()
    await settle(i, { txn: 'A1' })
    expect((await settle(i, { txn: 'A2' })).outcome).toBe('already_settled')
    expect(await bal(i.customer_id)).toBe(5)
    expect((await status(i.id)).provider_transaction_id).toBe('A1')
  })

  it.each([
    ['lower amount', { amount: 5 * COIN - 1 }, 'amount_mismatch'],
    ['higher amount', { amount: 5 * COIN + 1 }, 'amount_mismatch'],
    ['different currency', { currency: 'USD' }, 'currency_mismatch'],
    ['different provider', { provider: 'flutterwave' }, 'provider_mismatch'],
  ])('%s: nothing is credited, the intent becomes needs_refund with the reason', async (_l, over, reason) => {
    const i = await intent()
    const r = await settle(i, over)
    expect(r).toMatchObject({ outcome: 'needs_refund', reason })
    expect(await one('select 1 x from wallets where user_id = $1', [i.customer_id])).toBeUndefined()
    expect(await count('select count(*) c from transactions where reference = $1', [i.reference])).toBe(0)
    const s = await status(i.id)
    expect(s.status).toBe('needs_refund')
    expect(s.metadata.refund_reason).toBe(reason)
    expect(s.provider_transaction_id).not.toBeNull()
    // and it stays that way
    expect((await settle(i)).outcome).toBe('needs_refund')
    expect(await one('select 1 x from wallets where user_id = $1', [i.customer_id])).toBeUndefined()
  })

  it('rejects a missing provider transaction id and a conflicting one, without changing the intent', async () => {
    const i = await intent()
    expect((await settle(i, { txn: '  ' })).outcome).toBe('rejected')
    expect((await status(i.id)).status).toBe('created')
    await db.query(`update payment_intents set provider_transaction_id = 'KNOWN' where id = $1`, [i.id])
    const r = await settle(i, { txn: 'DIFFERENT' })
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'transaction_id_conflict' })
    expect((await status(i.id)).status).toBe('created')
  })

  it('accepts a late success on an expired or failed attempt', async () => {
    const e = await intent()
    await db.query(`update payment_intents set status = 'expired' where id = $1`, [e.id])
    expect((await settle(e)).outcome).toBe('settled')
    const f = await intent()
    await db.query(`update payment_intents set status = 'pending' where id = $1`, [f.id])
    await db.query(`update payment_intents set status = 'failed' where id = $1`, [f.id])
    expect((await settle(f)).outcome).toBe('settled')
  })

  it('refuses a purpose the engine does not settle yet, and rolls back (never looks handled)', async () => {
    const i = await intent({ purpose: 'plan_renewal', application: 'carehub', business_id: uid(), metadata: {} })
    await expect(settle(i)).rejects.toThrow(/not settled by the engine yet/)
    expect((await status(i.id)).status).toBe('created')
  })
})

// ---- top-up --------------------------------------------------------------------------------
describe('wallet top-up', () => {
  it('credits the coins on the intent and writes the ledger row with the reference', async () => {
    const u = uid()
    await wallet(u, 3)
    const i = await intent({ customer_id: u, expected_amount: 15 * COIN * 0.9, metadata: { coins: 15 } })
    const r = await settle(i)
    expect(r).toMatchObject({ outcome: 'settled', coins: 15, new_balance: 18 })
    expect(await bal(u)).toBe(18)
    const t = await one(`select type, amount, naira_amount from transactions where reference = $1`, [i.reference])
    expect(t).toMatchObject({ type: 'topup', naira_amount: 2700 })
  })

  it('creates the wallet when the customer has none', async () => {
    const i = await intent({ metadata: { coins: 1 }, expected_amount: COIN })
    await settle(i)
    expect(await bal(i.customer_id)).toBe(1)
  })

  it.each([
    ['no coins', {}], ['negative coins', { coins: -5 }], ['zero coins', { coins: 0 }], ['non-numeric coins', { coins: 'lots' }],
  ])('a top-up intent with %s is never credited', async (_l, metadata) => {
    const i = await intent({ metadata })
    expect((await settle(i)).outcome).toBe('needs_refund')
    expect(await one('select 1 x from wallets where user_id = $1', [i.customer_id])).toBeUndefined()
  })

  it('refuses a top-up with no customer', async () => {
    const i = await intent({ customer_id: null })
    expect((await settle(i)).reason).toBe('invalid_topup_intent')
  })

  it('a reference already claimed in the ledger is not credited again', async () => {
    const i = await intent()
    await db.query(`insert into transactions (user_id, type, amount, reference, status) values ($1,'topup',5,$2,'success')`, [i.customer_id, i.reference])
    expect((await settle(i)).reason).toBe('reference_already_used')
    expect(await one('select 1 x from wallets where user_id = $1', [i.customer_id])).toBeUndefined()
  })
})

// ---- subscription --------------------------------------------------------------------------
describe('creator subscription (card)', () => {
  async function subIntent({ coins = 10, creator = uid(), subscriber = uid(), profile = true, expected } = {}) {
    if (profile) await db.query('insert into profiles (id, subscription_price) values ($1,$2) on conflict do nothing', [creator, coins])
    const i = await intent({ purpose: 'creator_subscription', customer_id: subscriber, entity_type: 'creator', entity_id: creator, expected_amount: expected ?? coins * COIN, metadata: { coins } })
    return { i, creator, subscriber }
  }

  it('credits the creator 80% (rounded down), books the 20% remainder to the platform, grants 30 days, and does NOT debit the subscriber', async () => {
    const { i, creator, subscriber } = await subIntent({ coins: 12 })
    await wallet(subscriber, 50)
    const r = await settle(i)
    expect(r).toMatchObject({ outcome: 'settled', coins: 12, creator_coins: 9, platform_coins: 3 })
    expect(await bal(creator)).toBe(9)
    expect(await bal(subscriber)).toBe(50)
    const fee = await one(`select amount, user_id from transactions where type = 'platform_fee_subscription' and reference = $1`, [i.reference])
    expect(Number(fee.amount)).toBe(3)
    expect(fee.user_id).toBeNull()
    const sub = await one('select price, expires_at from creator_subscriptions where subscriber_id = $1 and creator_id = $2', [subscriber, creator])
    expect(sub.price).toBe(12)
    expect(new Date(sub.expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86400e3)
  })

  it('a 1-coin subscription pays the creator nothing and does not create an empty wallet; the platform keeps it', async () => {
    const { i, creator } = await subIntent({ coins: 1 })
    expect(await settle(i)).toMatchObject({ outcome: 'settled', creator_coins: 0, platform_coins: 1 })
    expect(await one('select 1 x from wallets where user_id = $1', [creator])).toBeUndefined()
  })

  it('a renewal extends from the current expiry, not from today', async () => {
    const { i, creator, subscriber } = await subIntent({ coins: 4 })
    await db.query(`insert into creator_subscriptions (subscriber_id, creator_id, price, expires_at) values ($1,$2,4, now() + interval '20 days')`, [subscriber, creator])
    await settle(i)
    const sub = await one('select expires_at from creator_subscriptions where subscriber_id = $1 and creator_id = $2', [subscriber, creator])
    expect(new Date(sub.expires_at).getTime()).toBeGreaterThan(Date.now() + 49 * 86400e3)
  })

  it('replay (redirect after webhook) pays the creator once', async () => {
    const { i, creator } = await subIntent({ coins: 10 })
    await settle(i)
    await settle(i)
    expect(await bal(creator)).toBe(8)
    expect(await count(`select count(*) c from transactions where reference = $1 and type = 'subscription_earning'`, [i.reference])).toBe(1)
  })

  it.each([
    ['price does not match the coins', { coins: 10, expected: 9 * COIN }, 'price_mismatch'],
    ['creator has no profile', { coins: 10, profile: false }, 'creator_missing'],
  ])('%s: needs_refund, nothing credited', async (_l, o, reason) => {
    const { i, creator } = await subIntent(o)
    expect(await settle(i)).toMatchObject({ outcome: 'needs_refund', reason })
    expect(await one('select 1 x from wallets where user_id = $1', [creator])).toBeUndefined()
    expect(await count('select count(*) c from creator_subscriptions where creator_id = $1', [creator])).toBe(0)
  })

  it('refuses subscribing to yourself', async () => {
    const me = uid()
    const { i } = await subIntent({ creator: me, subscriber: me })
    expect((await settle(i)).reason).toBe('self_subscription')
  })

  it('uses the platform rate from financial_config, not a constant in the function', async () => {
    await db.query(`update financial_config set value = 0.5 where key = 'subscription_platform_rate'`)
    try {
      const { i, creator } = await subIntent({ coins: 10 })
      expect(await settle(i)).toMatchObject({ creator_coins: 5, platform_coins: 5 })
      expect(await bal(creator)).toBe(5)
    } finally {
      await db.query(`update financial_config set value = 0.20 where key = 'subscription_platform_rate'`)
    }
  })
})

// ---- consultation --------------------------------------------------------------------------
describe('professional consultation (card)', () => {
  async function cIntent({ feeNaira = 5000, professional = uid(), patient = uid(), profile = true } = {}) {
    if (profile) await db.query('insert into profiles (id) values ($1) on conflict do nothing', [professional])
    await db.query(`insert into professional_consultations (professional_id, patient_id, type, fee, status) values ($1,$1,'video',$2,'setup') on conflict do nothing`, [professional, feeNaira])
    const i = await intent({ purpose: 'consultation', customer_id: patient, entity_type: 'professional', entity_id: professional, expected_amount: feeNaira * 100, metadata: {} })
    return { i, professional, patient }
  }

  it('books the patient, credits the professional 80% in coins, and NEVER debits the patient\'s CareCoin wallet', async () => {
    const { i, professional, patient } = await cIntent({ feeNaira: 5000 })
    await wallet(patient, 7)
    const r = await settle(i)
    expect(r).toMatchObject({ outcome: 'settled', professional_coins: 20 }) // 500000 kobo * 0.8 / 20000
    expect(await bal(professional)).toBe(20)
    expect(await bal(patient)).toBe(7)
    const booked = await one(`select type, fee, status from professional_consultations where professional_id = $1 and patient_id = $2 and status = 'paid'`, [professional, patient])
    expect(booked).toMatchObject({ type: 'video', status: 'paid' })
    expect(Number(booked.fee)).toBe(5000)
  })

  it('works for a patient with no wallet at all (no wallet is created or debited)', async () => {
    const { i, patient } = await cIntent({ feeNaira: 2000 })
    expect((await settle(i)).outcome).toBe('settled')
    expect(await one('select 1 x from wallets where user_id = $1', [patient])).toBeUndefined()
  })

  it('rounds the professional share down to whole coins (N1,050 -> 4 coins)', async () => {
    const { i, professional } = await cIntent({ feeNaira: 1050 })
    expect((await settle(i)).professional_coins).toBe(4)
    expect(await bal(professional)).toBe(4)
  })

  it('a patient who already booked: the second card payment is needs_refund, with NO credit and NO ledger row', async () => {
    const first = await cIntent({ feeNaira: 5000 })
    await settle(first.i)
    const second = await intent({ purpose: 'consultation', customer_id: first.patient, entity_type: 'professional', entity_id: first.professional, expected_amount: 500000, metadata: {} })
    expect(await settle(second)).toMatchObject({ outcome: 'needs_refund', reason: 'already_booked' })
    expect(await bal(first.professional)).toBe(20)
    expect(await count('select count(*) c from transactions where reference = $1', [second.reference])).toBe(0)
  })

  it('replay (webhook + redirect) books and pays once', async () => {
    const { i, professional } = await cIntent()
    await settle(i); await settle(i); await settle(i)
    expect(await bal(professional)).toBe(20)
    expect(await count(`select count(*) c from professional_consultations where professional_id = $1 and status = 'paid'`, [professional])).toBe(1)
  })

  it('declines self-booking and a professional with no profile, writing nothing', async () => {
    const me = uid()
    const s = await cIntent({ professional: me, patient: me })
    expect((await settle(s.i)).reason).toBe('self_consultation')
    const m = await cIntent({ profile: false })
    expect((await settle(m.i)).reason).toBe('professional_missing')
    expect(await count(`select count(*) c from professional_consultations where status = 'paid' and professional_id = $1`, [m.professional])).toBe(0)
  })
})

// ---- booking -------------------------------------------------------------------------------
describe('CareFind booking (card)', () => {
  async function bIntent({ fee = 150000, business = uid(), status = 'unpaid' } = {}) {
    const a = (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status) values ($1,'Ada','carefind',$2,$3) returning id`, [business, fee, status])).rows[0]
    const i = await intent({ purpose: 'booking', customer_id: null, business_id: business, entity_type: 'appointment', entity_id: a.id, expected_amount: fee, metadata: {} })
    return { i, business, appt: a.id }
  }
  const held = async (b) => Number((await one('select held_balance h from business_wallets where business_id = $1', [b])).h)

  it('credits the business from the ACTUAL amount paid: a fee that is not a coin multiple is not rounded up (F-06)', async () => {
    const { i, business, appt } = await bIntent({ fee: 150050 }) // not a multiple of 20000
    const r = await settle(i)
    expect(r).toMatchObject({ outcome: 'settled', platform_kobo: 30010, business_kobo: 120040 })
    expect(await held(business)).toBe(120040)
    expect(Number((await one(`select amount a from platform_transactions where reference = $1`, [i.reference])).a)).toBe(30010)
    expect(await one('select payment_status, payment_channel from appointments where id = $1', [appt])).toMatchObject({ payment_status: 'paid', payment_channel: 'card' })
  })

  it('replay settles once: held balance and commission are not doubled', async () => {
    const { i, business } = await bIntent({ fee: 100000 })
    await settle(i); await settle(i)
    expect(await held(business)).toBe(80000)
    expect(await count('select count(*) c from platform_transactions where reference = $1', [i.reference])).toBe(1)
  })

  it('a second payment for an appointment already paid is needs_refund and credits nothing', async () => {
    const { i, business, appt } = await bIntent({ fee: 100000 })
    await settle(i)
    const second = await intent({ purpose: 'booking', customer_id: null, business_id: business, entity_type: 'appointment', entity_id: appt, expected_amount: 100000, metadata: {} })
    expect(await settle(second)).toMatchObject({ outcome: 'needs_refund', reason: 'already_paid' })
    expect(await held(business)).toBe(80000)
  })

  it.each([
    ['appointment already paid', { status: 'paid' }, 'already_paid'],
  ])('%s', async (_l, o, reason) => {
    const { i, business } = await bIntent(o)
    expect((await settle(i)).reason).toBe(reason)
    expect(await one('select 1 x from business_wallets where business_id = $1', [business])).toBeUndefined()
  })

  it('declines when the appointment fee was changed after the intent, or the business differs', async () => {
    const a = await bIntent({ fee: 100000 })
    await db.query('update appointments set fee_amount = 1 where id = $1', [a.appt])
    expect((await settle(a.i)).reason).toBe('fee_changed')
    const b = await bIntent({ fee: 100000 })
    await db.query('update appointments set business_id = $2 where id = $1', [b.appt, uid()])
    expect((await settle(b.i)).reason).toBe('business_mismatch')
  })

  it('declines an intent whose appointment does not exist', async () => {
    const i = await intent({ purpose: 'booking', customer_id: null, business_id: uid(), entity_type: 'appointment', entity_id: uid(), expected_amount: 100000, metadata: {} })
    expect((await settle(i)).reason).toBe('appointment_missing')
  })

  it('takes the platform share from financial_config', async () => {
    await db.query(`update financial_config set value = 0.25 where key = 'booking_platform_rate'`)
    try {
      const { i, business } = await bIntent({ fee: 100000 })
      expect(await settle(i)).toMatchObject({ platform_kobo: 25000, business_kobo: 75000 })
      expect(await held(business)).toBe(75000)
    } finally {
      await db.query(`update financial_config set value = 0.20 where key = 'booking_platform_rate'`)
    }
  })
})

// ---- access --------------------------------------------------------------------------------
describe('engine access', () => {
  it('is executable by service_role only; handlers and config helper by nobody but the owner', async () => {
    const r = await db.query(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'execute') a,
             has_function_privilege('authenticated', p.oid, 'execute') u,
             has_function_privilege('service_role', p.oid, 'execute') s
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('settle_payment_intent','_fin_cfg','_settle_wallet_topup','_settle_creator_subscription','_settle_consultation','_settle_booking')`)
    const by = Object.fromEntries(r.rows.map((x) => [x.proname, x]))
    expect(r.rows).toHaveLength(6)
    expect(by.settle_payment_intent).toMatchObject({ a: false, u: false, s: true })
    for (const h of ['_fin_cfg', '_settle_wallet_topup', '_settle_creator_subscription', '_settle_consultation', '_settle_booking']) {
      expect(by[h]).toMatchObject({ a: false, u: false, s: false })
    }
  })

  it('a client role cannot call the engine', async () => {
    const i = await intent()
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      try {
        await expect(db.query('select settle_payment_intent($1,$2,$3,$4,$5)', [i.reference, 'paystack', 'T', i.expected_amount, 'NGN'])).rejects.toThrow(/permission denied/)
      } finally {
        await db.exec('reset role')
      }
    }
    expect((await status(i.id)).status).toBe('created')
  })
})
