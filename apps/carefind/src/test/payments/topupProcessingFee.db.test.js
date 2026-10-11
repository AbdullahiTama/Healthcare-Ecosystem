// @vitest-environment node
// H03 (carefind_20261030_topup_processing_fee): a card top-up is charged price + 10% processing fee and credits the full
// amount. The engine compares what Paystack reports to the TOTAL the intent expects; the handlers credit the BASE (CareHub
// wallet) or the whole coins (CareFind), and refuse an intent whose base + fee is not what was charged. Real Postgres
// (PGlite), production-order migrations.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 230000).toString(16).padStart(12, '0')}`
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
  await db.exec(M('carefind_20261030_topup_processing_fee'))
}, 180_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const settle = async (i, over = {}) => {
  const a = { txn: `T${i.reference}`, amount: i.expected_amount, ...over }
  return (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [i.reference, i.provider, a.txn, a.amount, 'NGN'])).r
}
const businessIntent = async ({ expected, metadata = {} }) => {
  const b = uid()
  await db.query('insert into businesses (id) values ($1)', [b])
  await db.query('insert into business_wallets (business_id, available_balance) values ($1, 0)', [b])
  const i = (await db.query(`insert into payment_intents (reference, application, purpose, business_id, expected_amount, provider, metadata)
    values ($1,'carehub','business_wallet_topup',$2,$3,'paystack',$4) returning *`, [ref('ch_topup'), b, expected, JSON.stringify(metadata)])).rows[0]
  return { b, i }
}
const balanceOf = async (b) => Number((await one('select available_balance a from business_wallets where business_id = $1', [b])).a)
const coinIntent = async ({ expected, metadata }) => {
  const u = uid()
  await db.query('insert into auth.users (id) values ($1)', [u])
  const i = (await db.query(`insert into payment_intents (reference, application, purpose, customer_id, expected_amount, provider, metadata)
    values ($1,'carefind','wallet_topup',$2,$3,'paystack',$4) returning *`, [ref('cf_topup'), u, expected, JSON.stringify(metadata)])).rows[0]
  return { u, i }
}
const coinsOf = async (u) => Number((await one('select coalesce(max(balance),0) b from wallets where user_id = $1', [u])).b)

describe('CareHub business wallet: the card is charged price + fee, the wallet receives the price', () => {
  const meta = { base_amount_kobo: 1_000_000, fee_kobo: 100_000, fee_rate: 0.1 }

  it('N10,000 top-up charged N11,000 credits exactly N10,000, and reports the fee', async () => {
    const { b, i } = await businessIntent({ expected: 1_100_000, metadata: meta })
    const r = await settle(i)
    expect(r).toMatchObject({ outcome: 'settled', credited_kobo: 1_000_000, fee_kobo: 100_000, new_available: 1_000_000 })
    expect(await balanceOf(b)).toBe(1_000_000)
    const tx = await one(`select amount from business_wallet_transactions where reference = $1`, [i.reference])
    expect(Number(tx.amount)).toBe(1_000_000)
  })

  it('a replay (webhook after redirect) settles nothing more', async () => {
    const { b, i } = await businessIntent({ expected: 1_100_000, metadata: meta })
    expect((await settle(i)).outcome).toBe('settled')
    expect((await settle(i)).outcome).toBe('already_settled')
    expect(await balanceOf(b)).toBe(1_000_000)
    expect((await one(`select count(*)::int c from business_wallet_transactions where reference = $1`, [i.reference])).c).toBe(1)
  })

  it('paying only the base (the fee skipped) is a mismatch: needs_refund, nothing credited', async () => {
    const { b, i } = await businessIntent({ expected: 1_100_000, metadata: meta })
    const r = await settle(i, { amount: 1_000_000 })
    expect(r).toMatchObject({ outcome: 'needs_refund', reason: 'amount_mismatch' })
    expect(await balanceOf(b)).toBe(0)
  })

  it('overpaying is also refused', async () => {
    const { b, i } = await businessIntent({ expected: 1_100_000, metadata: meta })
    expect((await settle(i, { amount: 1_200_000 })).outcome).toBe('needs_refund')
    expect(await balanceOf(b)).toBe(0)
  })

  it('metadata whose base + fee is not the charged total is refused (cannot be used to credit more than was paid)', async () => {
    for (const metadata of [
      { base_amount_kobo: 1_100_000, fee_kobo: 100_000 },   // base claims the whole charge plus a fee
      { base_amount_kobo: 2_000_000, fee_kobo: 0 },
      { base_amount_kobo: 1_000_000, fee_kobo: -5 },
      { base_amount_kobo: 'abc', fee_kobo: 0 },
      { base_amount_kobo: 0, fee_kobo: 1_100_000 },
    ]) {
      const { b, i } = await businessIntent({ expected: 1_100_000, metadata })
      const r = await settle(i)
      expect(r).toMatchObject({ outcome: 'needs_refund', reason: 'topup_amount_mismatch' })
      expect(await balanceOf(b)).toBe(0)
    }
  })

  it('an intent created before the fee (no metadata) is credited its full expected amount, as before', async () => {
    const { b, i } = await businessIntent({ expected: 500_000, metadata: {} })
    expect((await settle(i)).outcome).toBe('settled')
    expect(await balanceOf(b)).toBe(500_000)
  })

  it('a zero fee (rate 0) credits the amount charged', async () => {
    const { b, i } = await businessIntent({ expected: 400_000, metadata: { base_amount_kobo: 400_000, fee_kobo: 0, fee_rate: 0 } })
    expect((await settle(i)).outcome).toBe('settled')
    expect(await balanceOf(b)).toBe(400_000)
  })
})

describe('CareFind CareCoins: the card is charged price + fee, whole coins are credited', () => {
  it('a 5-coin pack (N950) charged N1,045 credits exactly 5 coins', async () => {
    const { u, i } = await coinIntent({ expected: 104_500, metadata: { coins: 5, package_id: '5', base_amount_kobo: 95_000, fee_kobo: 9_500, fee_rate: 0.1 } })
    const r = await settle(i)
    expect(r).toMatchObject({ outcome: 'settled', coins: 5, new_balance: 5, fee_kobo: 9_500 })
    expect(await coinsOf(u)).toBe(5)
    const t = await one(`select amount, naira_amount from transactions where reference = $1 and type = 'topup'`, [i.reference])
    expect(Number(t.amount)).toBe(5)
    expect(Number(t.naira_amount)).toBe(1045) // what the card was charged
  })

  it('paying the base only is refused and no coin is credited', async () => {
    const { u, i } = await coinIntent({ expected: 22_000, metadata: { coins: 1, package_id: '1', base_amount_kobo: 20_000, fee_kobo: 2_000, fee_rate: 0.1 } })
    expect(await settle(i, { amount: 20_000 })).toMatchObject({ outcome: 'needs_refund', reason: 'amount_mismatch' })
    expect(await coinsOf(u)).toBe(0)
  })

  it('metadata that does not add up to the charge is refused', async () => {
    const { u, i } = await coinIntent({ expected: 22_000, metadata: { coins: 50, package_id: '50', base_amount_kobo: 22_000, fee_kobo: 2_000 } })
    expect(await settle(i)).toMatchObject({ outcome: 'needs_refund', reason: 'topup_amount_mismatch' })
    expect(await coinsOf(u)).toBe(0)
  })

  it('a replay never credits twice', async () => {
    const { u, i } = await coinIntent({ expected: 22_000, metadata: { coins: 1, package_id: '1', base_amount_kobo: 20_000, fee_kobo: 2_000, fee_rate: 0.1 } })
    expect((await settle(i)).outcome).toBe('settled')
    expect((await settle(i)).outcome).toBe('already_settled')
    expect(await coinsOf(u)).toBe(1)
  })

  it('an intent created before the fee (no base/fee metadata) still credits its coins', async () => {
    const { u, i } = await coinIntent({ expected: 20_000, metadata: { coins: 1, package_id: '1' } })
    expect((await settle(i)).outcome).toBe('settled')
    expect(await coinsOf(u)).toBe(1)
  })
})

describe('configuration and function surface', () => {
  it('seeds the rate at 0.10 and a re-apply keeps an operator change', async () => {
    expect(Number((await one(`select value v from financial_config where key = 'topup_processing_fee_rate'`)).v)).toBe(0.1)
    await db.query(`update financial_config set value = 0.05 where key = 'topup_processing_fee_rate'`)
    await db.exec(M('carefind_20261030_topup_processing_fee'))
    expect(Number((await one(`select value v from financial_config where key = 'topup_processing_fee_rate'`)).v)).toBe(0.05)
  })

  it('the rate is a ratio the table accepts only between 0 and 1', async () => {
    await expect(db.query(`update financial_config set value = 2 where key = 'topup_processing_fee_rate'`)).rejects.toThrow()
  })

  it('each handler is still ONE function and nobody (not even service_role) can execute it directly', async () => {
    for (const name of ['_settle_wallet_topup', '_settle_business_wallet_topup']) {
      expect((await db.query(`select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = $1`, [name])).rows).toHaveLength(1)
      const acl = await one(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b, has_function_privilege('service_role', $1, 'execute') c`, [`public.${name}(public.payment_intents)`])
      expect(acl).toEqual({ a: false, b: false, c: false })
    }
  })
})
