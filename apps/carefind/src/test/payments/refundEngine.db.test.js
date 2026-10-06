// @vitest-environment node
// Phase 09 (database): the refund engine. Real Postgres (PGlite), every migration in production order, a replica of the live
// tables. Card refunds complete only when the provider confirms; CareCoin refunds go through the ledger; the business's share
// is taken back at request (held first, then available, never below zero) and restored exactly if the provider fails.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 130000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_abcdefgh`

const newDb = async () => {
  const d = new PGlite()
  await d.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await d.exec(read('./fixtures/liveSchemaSubset.sql'))
  await d.exec(M('carefind_20261003_payment_intents_foundation'))
  await d.exec(M('carefind_20261004_settle_payment_intent'))
  await d.exec(M('carefind_20261005_coin_ledger'))
  await createLegacyStubs(d)
  await d.exec(M('carefind_20261005_coin_writers_use_ledger'))
  await d.exec(M('carefind_20261005_lock_wallets_to_ledger'))
  await d.exec(M('carefind_20261006_settle_plan_and_carehub_appointments'))
  await d.exec(M('carefind_20261007_commission_engine'))
  await d.exec(M('carefind_20261008_commission_reconcile_first_payment'))
  await d.exec(M('carefind_20261008_withdrawal_engine'))
  await d.exec(M('carefind_20261009_refund_engine'))
  // The refund engine as PRODUCTION runs it: later migrations replaced request_refund and settle_refund (shop orders, vendor
  // recovery) and the engine entry points' timeouts. Testing only the 09 definitions would test code that is no longer live.
  await d.exec(M('carefind_20261010_central_settlement'))
  await d.exec(`
    create function public.cancel_shop_order(p_order_id uuid, p_reason text default null) returns text language sql as $$ select 'old'::text $$;
    create function public.process_shop_return(p_return_id uuid, p_action text, p_notes text default null) returns text language sql as $$ select 'old'::text $$;
  `)
  await d.exec(M('carefind_20261012_shop_vendor_payouts'))
  await d.exec(M('carefind_20261014_reconciliation'))
  await d.exec(M('carefind_20261015_reconciliation_ops'))
  await d.exec(M('carefind_20261016_reconciliation_scale'))
  await d.exec(M('carefind_20261017_engine_timeouts_and_hot_paths'))
  await d.exec(M('carefind_20261019_red_team_fixes'))
  return d
}
beforeAll(async () => { db = await newDb() }, 180_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }

const FEE = 1_000_000 // N10,000 booking: business 800,000 (held), platform commission 200,000

const business = async ({ held = 0, available = 0 } = {}) => {
  const b = uid()
  await db.query('insert into business_wallets (business_id, held_balance, available_balance) values ($1,$2,$3)', [b, held, available])
  return b
}
const walletOf = async (b) => one('select held_balance::int held, available_balance::int avail from business_wallets where business_id = $1', [b])

// A card-paid appointment, settled through the REAL engine (so the wallet credit, commission and intent are production-shaped).
async function paidCardAppointment(fee = FEE) {
  const b = uid()
  const a = (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada','carehub',$2,'unpaid',$3) returning id`, [b, fee, ref('appt')])).rows[0]
  const reference = ref('chapp')
  await db.query(`insert into payment_intents (reference, application, purpose, business_id, entity_type, entity_id, expected_amount, metadata) values ($1,'carehub','appointment',$2,'appointment',$3,$4,'{}'::jsonb)`, [reference, b, a.id, fee])
  const r = (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', `T${reference}`, fee, 'NGN'])).r
  expect(r.outcome).toBe('settled')
  return { b, id: a.id, reference }
}
const request = async (cause, type, id, extra = {}) =>
  (await one('select request_refund($1,$2,$3,$4,$5,$6) r', [cause, type, id, extra.by ?? null, extra.reason ?? null, extra.platform ?? false])).r
const settle = async (outcome, key, extra = {}) =>
  (await one('select settle_refund($1,$2,$3,$4,$5,$6,$7) r', [outcome, extra.byId ? key : null, extra.byId ? null : key ?? null, extra.providerId ?? null, extra.txn ?? null, extra.amount ?? null, extra.detail ?? null])).r
const refundRow = (id) => one('select * from refunds where id = $1', [id])
const cleanFor = async (entityId) => expect((await all('select * from reconcile_refunds(60)')).filter((x) => x.entity_id === entityId)).toEqual([])

describe('card refund of a booking', () => {
  it('request takes the business share back (held first), records everything, and moves NOTHING for the customer yet', async () => {
    const p = await paidCardAppointment()
    expect(await walletOf(p.b)).toEqual({ held: 800_000, avail: 0 })
    const r = await request('booking_cancelled', 'appointment', p.id, { reason: 'owner cancelled' })
    expect(r).toMatchObject({ outcome: 'requested', kind: 'card', amount_kobo: FEE, provider_transaction_reference: p.reference, business_shortfall_kobo: 0 })
    expect(r.reference).toBe('rf_' + r.id.replaceAll('-', ''))
    expect(await walletOf(p.b)).toEqual({ held: 0, avail: 0 })
    const row = await refundRow(r.id)
    expect(row).toMatchObject({ status: 'requested', kind: 'card', business_recovered_held_kobo: 800_000, business_recovered_available_kobo: 0, commission_kobo: 200_000, reason: 'owner cancelled' })
    expect(await one(`select amount, reference from business_wallet_transactions where business_id = $1 and type = 'refund_debit'`, [p.b])).toMatchObject({ amount: -800_000, reference: r.reference })
    // the customer's payment still stands until the provider confirms
    expect(await one('select payment_status from appointments where id = $1', [p.id])).toMatchObject({ payment_status: 'paid' })
    expect((await one('select status from payment_intents where reference = $1', [p.reference])).status).toBe('settled')
  })

  it('completes ONLY when the provider confirms: appointment and intent become refunded, the commission is reversed, replays change nothing', async () => {
    const p = await paidCardAppointment()
    const r = await request('booking_cancelled', 'appointment', p.id)
    expect(await one('select mark_refund_processing($1,$2,$3) r', [r.id, 'PRF_1', 'pending'])).toMatchObject({ r: 'ok' })
    expect(await refundRow(r.id)).toMatchObject({ status: 'processing', provider_refund_id: 'PRF_1' })
    expect((await settle('processed', r.reference, { amount: FEE })).result).toBe('completed')
    expect(await one('select payment_status, refunded_at from appointments where id = $1', [p.id])).toMatchObject({ payment_status: 'refunded' })
    expect((await one('select status from payment_intents where reference = $1', [p.reference])).status).toBe('refunded')
    expect(await one(`select amount from platform_transactions where appointment_id = $1 and type = 'commission_reversal'`, [p.id])).toMatchObject({ amount: -200_000 })
    expect((await settle('processed', r.reference)).result).toBe('already_completed')
    expect((await settle('processed', r.id, { byId: true })).result).toBe('already_completed')
    expect(await all(`select 1 from platform_transactions where appointment_id = $1 and type = 'commission_reversal'`, [p.id])).toHaveLength(1)
    await cleanFor(p.id)
  })

  it('provider failure: the customer stays paid, the business gets its share back EXACTLY, a new refund can be requested', async () => {
    const p = await paidCardAppointment()
    const r = await request('booking_cancelled', 'appointment', p.id)
    expect((await settle('failed', r.reference, { detail: 'insufficient provider balance' })).result).toBe('failed')
    expect(await walletOf(p.b)).toEqual({ held: 800_000, avail: 0 })
    expect(await refundRow(r.id)).toMatchObject({ status: 'failed', failure_reason: 'insufficient provider balance' })
    expect(await one('select payment_status from appointments where id = $1', [p.id])).toMatchObject({ payment_status: 'paid' })
    expect((await settle('failed', r.reference)).result).toBe('already_failed')
    expect(await walletOf(p.b)).toEqual({ held: 800_000, avail: 0 })        // not restored twice
    const again = await request('booking_cancelled', 'appointment', p.id)
    expect(again.outcome).toBe('requested')
    expect(again.id).not.toBe(r.id)
    expect((await settle('processed', again.reference)).result).toBe('completed')
    await cleanFor(p.id)
  })

  it('takes held first, then available; never below zero; the uncovered part is a recorded shortfall (the platform bears it)', async () => {
    const p = await paidCardAppointment()
    await db.query('update business_wallets set held_balance = 500000, available_balance = 100000 where business_id = $1', [p.b]) // 800k credited, 200k already withdrawn
    const r = await request('booking_cancelled', 'appointment', p.id)
    expect(r.business_shortfall_kobo).toBe(200_000)
    expect(await walletOf(p.b)).toEqual({ held: 0, avail: 0 })
    expect(await refundRow(r.id)).toMatchObject({ business_recovered_held_kobo: 500_000, business_recovered_available_kobo: 100_000, business_shortfall_kobo: 200_000 })
    expect((await all('select kind from reconcile_refunds(60) where refund_id = $1', [r.id])).map((x) => x.kind)).toContain('business_shortfall')
    // a provider failure restores exactly what was taken, into the same buckets
    await settle('failed', r.reference)
    expect(await walletOf(p.b)).toEqual({ held: 500_000, avail: 100_000 })
  })

  it('a split recovery across held and available restores to the right buckets; the wallet never goes negative', async () => {
    const p = await paidCardAppointment()
    await db.query('update business_wallets set held_balance = 300000, available_balance = 900000 where business_id = $1', [p.b])
    const r = await request('booking_cancelled', 'appointment', p.id)
    expect(await walletOf(p.b)).toEqual({ held: 0, avail: 400_000 })
    expect(r.business_shortfall_kobo).toBe(0)
    await settle('failed', r.reference)
    expect(await walletOf(p.b)).toEqual({ held: 300_000, avail: 900_000 })
  })

  it('platform-funded: the business keeps its money and the commission is NOT reversed', async () => {
    const p = await paidCardAppointment()
    const r = await request('admin_refund', 'appointment', p.id, { platform: true })
    expect(r).toMatchObject({ outcome: 'requested', kind: 'platform_funded' })
    expect(await walletOf(p.b)).toEqual({ held: 800_000, avail: 0 })
    expect(await refundRow(r.id)).toMatchObject({ business_recovered_held_kobo: 0, business_recovered_available_kobo: 0, commission_kobo: 0 })
    await settle('processed', r.reference, { amount: FEE })
    expect(await all(`select 1 from platform_transactions where appointment_id = $1 and type = 'commission_reversal'`, [p.id])).toHaveLength(0)
    expect(await one('select payment_status from appointments where id = $1', [p.id])).toMatchObject({ payment_status: 'refunded' })
  })

  it('one live refund per payment: a second request (cancel + admin, double click) returns the first; none after completion', async () => {
    const p = await paidCardAppointment()
    const a = await request('booking_cancelled', 'appointment', p.id)
    const b = await request('admin_refund', 'appointment', p.id)
    expect(b).toMatchObject({ outcome: 'already_requested', id: a.id, reference: a.reference })
    expect(await walletOf(p.b)).toEqual({ held: 0, avail: 0 })              // the business was debited once
    expect(await all(`select 1 from business_wallet_transactions where business_id = $1 and type = 'refund_debit'`, [p.b])).toHaveLength(1)
    await settle('processed', a.reference)
    expect((await request('booking_cancelled', 'appointment', p.id)).outcome).toBe('already_refunded')
  })

  it('refuses what cannot be refunded: unpaid, unknown, POS/transfer/cash, an unsettled credit; nothing is written', async () => {
    const b = uid()
    const mk = async (status, channel) => (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_channel, payment_reference) values ($1,'x','carehub',100000,$2,$3,$4) returning id`, [b, status, channel, ref('x')])).rows[0].id
    expect((await request('booking_cancelled', 'appointment', await mk('unpaid', null))).outcome).toBe('not_paid')
    expect((await request('booking_cancelled', 'appointment', uid())).outcome).toBe('not_found')
    expect(await request('booking_cancelled', 'appointment', await mk('paid', 'pos'))).toMatchObject({ outcome: 'not_refundable_by_platform', channel: 'pos' })
    expect(await request('booking_cancelled', 'appointment', await mk('paid', 'transfer'))).toMatchObject({ outcome: 'not_refundable_by_platform' })
    expect((await request('booking_cancelled', 'appointment', await mk('paid', 'card'))).outcome).toBe('no_payment_to_refund')
    expect((await all('select 1 from refunds where business_id = $1', [b]))).toHaveLength(0)
  })

  it('provider signals are matched by exact id, by provider refund id, or by the payment reference, and contradictions are reported', async () => {
    const p = await paidCardAppointment()
    const r = await request('booking_cancelled', 'appointment', p.id)
    expect((await settle('processing', null, { txn: p.reference, providerId: 'PRF_9' })).result).toBe('processing')
    expect(await refundRow(r.id)).toMatchObject({ status: 'processing', provider_refund_id: 'PRF_9' })
    expect((await settle('processed', null, { providerId: 'PRF_9', amount: 1 })).result).toBe('amount_mismatch')
    expect((await refundRow(r.id)).status).toBe('processing')
    expect((await settle('processed', null, { providerId: 'PRF_9', txn: p.reference, amount: FEE })).result).toBe('completed')
    expect((await settle('failed', null, { providerId: 'PRF_9' })).result).toBe('conflict_failed_after_completed')
    // processed AFTER we released the business: money went back to the customer AND the business was restored
    const q = await paidCardAppointment()
    const r2 = await request('booking_cancelled', 'appointment', q.id)
    await settle('failed', r2.reference)
    expect((await settle('processed', r2.reference)).result).toBe('conflict_processed_after_failed')
    expect((await refundRow(r2.id)).status).toBe('failed')
    expect((await settle('processed', 'rf_nope')).result).toBe('not_found')
  })
})

describe('CareCoin refund of a booking', () => {
  const coinBooking = async (coins = 5) => {
    const b = uid(); const u = uid()
    await db.query('insert into auth.users (id) values ($1)', [u])
    await db.query(`select _post_coin_entry($1,20,'topup',$2)`, [u, ref('seed')])
    const a = (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada','carefind',$2,'unpaid',$3) returning id`, [b, coins * 20000, ref('cfappt')])).rows[0]
    expect((await one('select pay_booking_with_credits($1,$2) r', [u, a.id])).r).toBe('ok')
    return { b, u, id: a.id }
  }
  const bal = async (u) => Number((await one('select balance from wallets where user_id = $1', [u])).balance)

  it('refunds exactly the coins paid, through the ledger, in one step; the business share is recovered; books balance', async () => {
    const p = await coinBooking(5)
    expect(await bal(p.u)).toBe(15)
    expect(await walletOf(p.b)).toEqual({ held: 80_000, avail: 0 })       // 100,000 less 20% platform
    const r = await request('booking_cancelled', 'appointment', p.id)
    expect(r).toMatchObject({ outcome: 'completed', kind: 'carecoin', coins: 5 })
    expect(await bal(p.u)).toBe(20)
    expect(await walletOf(p.b)).toEqual({ held: 0, avail: 0 })
    expect(await one('select payment_status from appointments where id = $1', [p.id])).toMatchObject({ payment_status: 'refunded' })
    expect(await one(`select delta from coin_ledger where user_id = $1 and kind = 'booking_refund'`, [p.u])).toMatchObject({ delta: 5 })
    expect(await refundRow(r.id)).toMatchObject({ status: 'completed', kind: 'carecoin', coins: 5, amount_kobo: null })
    expect((await request('booking_cancelled', 'appointment', p.id)).outcome).toBe('already_refunded')
    expect(await bal(p.u)).toBe(20)
    expect(await all('select * from reconcile_coin_wallets()')).toEqual([])
    expect(await all('select * from verify_coin_ledger_chain()')).toEqual([])
    await cleanFor(p.id)
  })

  it('the business had already withdrawn part of it: shortfall recorded, wallet never negative, coins still returned in full', async () => {
    const p = await coinBooking(5)
    await db.query('update business_wallets set held_balance = 0, available_balance = 30000 where business_id = $1', [p.b])
    const r = await request('booking_cancelled', 'appointment', p.id)
    expect(r.business_shortfall_kobo).toBe(50_000)
    expect(await walletOf(p.b)).toEqual({ held: 0, avail: 0 })
    expect(await bal(p.u)).toBe(20)
  })
})

describe('a payment that could not be applied (needs_refund)', () => {
  const needsRefund = async () => {
    const b = uid()
    const a = (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada','carehub',$2,'unpaid',$3) returning id`, [b, FEE, ref('appt')])).rows[0]
    const reference = ref('chapp')
    const intent = (await db.query(`insert into payment_intents (reference, application, purpose, business_id, entity_type, entity_id, expected_amount, metadata) values ($1,'carehub','appointment',$2,'appointment',$3,$4,'{}'::jsonb) returning id`, [reference, b, a.id, FEE])).rows[0]
    const r = (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', `T${reference}`, FEE - 5000, 'NGN'])).r   // paid LESS than the fee
    expect(r.outcome).toBe('needs_refund')
    return { b, intentId: intent.id, reference }
  }

  it('is refunded in full (what was actually paid); nothing was credited so nothing is recovered; the intent becomes refunded', async () => {
    const p = await needsRefund()
    const r = await request('needs_refund_intent', 'payment_intent', p.intentId, { reason: 'amount_mismatch' })
    expect(r).toMatchObject({ outcome: 'requested', kind: 'card', amount_kobo: FEE - 5000, provider_transaction_reference: p.reference })
    expect(await refundRow(r.id)).toMatchObject({ business_recovered_held_kobo: 0, commission_kobo: 0, entity_type: 'payment_intent', payment_intent_id: p.intentId })
    expect((await request('needs_refund_intent', 'payment_intent', p.intentId)).outcome).toBe('already_requested')
    expect((await all('select kind from reconcile_refunds(0) where entity_id = $1', [p.intentId])).map((x) => x.kind)).toContain('stuck')
    expect((await settle('processed', r.reference, { amount: FEE - 5000 })).result).toBe('completed')
    expect((await one('select status from payment_intents where id = $1', [p.intentId])).status).toBe('refunded')
    expect((await request('needs_refund_intent', 'payment_intent', p.intentId)).outcome).toBe('already_refunded')
    await cleanFor(p.intentId)
  })

  it('a failed refund leaves the intent in needs_refund so it can be retried; a settled intent is not refundable this way', async () => {
    const p = await needsRefund()
    const r = await request('needs_refund_intent', 'payment_intent', p.intentId)
    await settle('failed', r.reference)
    expect((await one('select status from payment_intents where id = $1', [p.intentId])).status).toBe('needs_refund')
    expect((await request('needs_refund_intent', 'payment_intent', p.intentId)).outcome).toBe('requested')
    const settled = await paidCardAppointment()
    const id = (await one('select id from payment_intents where reference = $1', [settled.reference])).id
    expect(await request('needs_refund_intent', 'payment_intent', id)).toMatchObject({ outcome: 'not_refundable', status: 'settled' })
  })

  it('reconciliation reports a needs_refund payment nobody has refunded', async () => {
    const p = await needsRefund()
    await db.query("alter table payment_intents disable trigger all")
    await db.query("update payment_intents set updated_at = now() - interval '3 hours' where id = $1", [p.intentId])
    await db.query("alter table payment_intents enable trigger all")
    expect((await all('select kind from reconcile_refunds(60) where entity_id = $1', [p.intentId])).map((x) => x.kind)).toEqual(['needs_refund_without_refund'])
  })
})

describe('the table cannot be changed around the engine', () => {
  it('state machine and immutability are enforced by the database', async () => {
    const p = await paidCardAppointment()
    const r = await request('booking_cancelled', 'appointment', p.id)
    const upd = (sql) => db.query(sql, [r.id])
    await expect(upd("update refunds set status = 'requested' where id = $1")).resolves.toBeTruthy()      // no-op is fine
    await expect(upd('update refunds set amount_kobo = 1 where id = $1')).rejects.toThrow(/immutable/)
    await expect(upd('update refunds set business_recovered_held_kobo = 0 where id = $1')).rejects.toThrow(/immutable/)
    await expect(upd("update refunds set reference = 'x' where id = $1")).rejects.toThrow(/immutable/)
    await expect(upd('delete from refunds where id = $1')).rejects.toThrow(/never deleted/)
    await expect(db.query('truncate refunds')).rejects.toThrow()
    await db.query("update refunds set status = 'completed' where id = $1", [r.id])
    await expect(upd("update refunds set status = 'failed' where id = $1")).rejects.toThrow(/illegal refund status/)
    await expect(upd("update refunds set status = 'processing' where id = $1")).rejects.toThrow(/illegal refund status/)
  })

  it('no role can read or write the table; the functions are service_role only; the legacy function is gone', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await asRole(role, async () => {
        await expect(db.query('select * from refunds')).rejects.toThrow(/permission denied/)
        await expect(db.query("insert into refunds (reference, kind, cause, entity_type, entity_id) values ('x','card','admin_refund','appointment',gen_random_uuid())")).rejects.toThrow(/permission denied/)
      })
    }
    for (const role of ['anon', 'authenticated']) {
      await asRole(role, async () => {
        await expect(db.query(`select request_refund('admin_refund','appointment',gen_random_uuid())`)).rejects.toThrow(/permission denied/)
        await expect(db.query(`select settle_refund('failed', null, 'x')`)).rejects.toThrow(/permission denied/)
        await expect(db.query('select * from reconcile_refunds(60)')).rejects.toThrow(/permission denied/)
      })
    }
    expect(await all("select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'refund_appointment_payment'")).toHaveLength(0)
    expect((await all("select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('request_refund','settle_refund','mark_refund_processing','reconcile_refunds') group by 1")).length).toBe(4)
  })

  it('rejects unknown causes and outcomes loudly', async () => {
    await expect(request('whatever', 'appointment', uid())).rejects.toThrow(/unknown refund cause/)
    await expect(settle('weird', 'rf_x')).rejects.toThrow(/unknown refund outcome/)
    await expect(db.query('select settle_refund($1)', ['failed'])).rejects.toThrow(/required/)
  })
})

describe('reconciliation', () => {
  it('reports a paid appointment that was cancelled and never refunded (the cron retries it)', async () => {
    const b = uid()
    const a = (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_channel, payment_reference, status, cancelled_at) values ($1,'x','carehub',1000,'paid','card',$2,'cancelled', now() - interval '3 hours') returning id`, [b, ref('z')])).rows[0]
    expect((await all('select kind from reconcile_refunds(60) where entity_id = $1', [a.id])).map((x) => x.kind)).toEqual(['cancelled_appointment_not_refunded'])
    await db.query("update appointments set payment_channel = 'pos' where id = $1", [a.id])     // offline money: not the platform's to refund
    expect(await all('select kind from reconcile_refunds(60) where entity_id = $1', [a.id])).toEqual([])
  })


  it('a clean history reports nothing, and detects the inconsistencies it can see', async () => {
    const p = await paidCardAppointment()
    const r = await request('booking_cancelled', 'appointment', p.id)
    await settle('processed', r.reference)
    await cleanFor(p.id)
    await db.query('alter table refunds disable trigger refunds_guard')
    await db.query("update appointments set payment_status = 'paid' where id = $1", [p.id])
    await db.query("update payment_intents set status = 'settled' where reference = $1", [p.reference]).catch(() => {})
    await db.query('alter table refunds enable trigger refunds_guard')
    const kinds = (await all('select kind from reconcile_refunds(60) where entity_id = $1', [p.id])).map((x) => x.kind)
    expect(kinds).toContain('completed_but_appointment_not_refunded')
  })

  it('a refunded appointment with no completed refund (legacy shortcut) is reported after the cutover', async () => {
    const b = uid()
    const a = (await db.query(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference, refunded_at) values ($1,'x','carehub',1000,'refunded',$2, now() + interval '1 minute') returning id`, [b, ref('z')])).rows[0]
    expect((await all('select kind from reconcile_refunds(60) where entity_id = $1', [a.id])).map((x) => x.kind)).toEqual(['refunded_appointment_without_refund'])
  })
})
