// @vitest-environment node
// H05 (carefind_20261101_payment_email_events), real Postgres (PGlite), migrations in production order:
//   * the catalog registers and ENABLES the payment, withdrawal, refund and wallet events for the brand that sends them and
//     leaves every other event alone;
//   * list_unnotified_money_events lists exactly the settled money events whose e-mail has no outbox row, bounded by the window,
//     and is read-only and service_role only.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 290000).toString(16).padStart(12, '0')}`
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
    alter table public.transactions add constraint transactions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
    alter table public.wallets add constraint wallets_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
    create function public.verify_shop_payment(p_order_id uuid, p_paystack_reference text) returns text language sql as $$ select 'ok'::text $$;
    create function public.claim_payment_event(p_order_id uuid, p_payment_reference text, p_event_type text default 'charge.success', p_amount_kobo integer default null, p_metadata jsonb default '{}'::jsonb) returns text language sql as $$ select 'ok'::text $$;
    create function public.settle_card_booking(p_appointment_id uuid, p_reference text) returns text language sql as $$ select 'old'::text $$;
  `)
  await db.exec(M('carefind_20261003_payment_intents_foundation'))
  await db.exec(M('carefind_20261004_settle_payment_intent'))
  await db.exec(M('carefind_20261005_coin_ledger'))
  await createLegacyStubs(db)
  await db.exec(M('carefind_20261005_coin_writers_use_ledger'))
  await db.exec(M('carefind_20261005_lock_wallets_to_ledger'))
  await db.exec(M('carefind_20261006_settle_plan_and_carehub_appointments'))
  await db.exec(M('carefind_20261007_commission_engine'))
  await db.exec(M('carefind_20261008_withdrawal_engine'))
  await db.exec(M('carefind_20261009_refund_engine'))
  await db.exec(M('carefind_20261010_central_settlement'))
  await db.exec(M('carefind_20261020_wallet_spend_and_topup'))
  // the e-mail system as production has it, reduced to what this migration touches
  await db.exec(`
    create table public.email_outbox (id uuid primary key default gen_random_uuid(), idempotency_key text, app text, template_key text);
    create table public.email_event_catalog (
      app text not null, event_key text not null, template_key text not null, subject_template text not null, from_email text not null,
      reply_to text, payload_schema jsonb not null default '{}'::jsonb, enabled boolean not null default false,
      required_for_business boolean not null default false, category text not null default 'transactional', rollout_mode text not null default 'live',
      primary key (app, event_key)
    );
    insert into public.email_event_catalog (app, event_key, template_key, subject_template, from_email, reply_to) values
      ('carefind', 'withdrawal_requested', 'withdrawal_requested', 'CareFind: withdrawal requested', 'CareFind <support@mail.carefind.app>', 'support@mail.carefind.app'),
      ('carefind', 'withdrawal_completed', 'withdrawal_completed', 'CareFind: withdrawal settled', 'CareFind <support@mail.carefind.app>', 'support@mail.carefind.app'),
      ('carefind', 'payment_success', 'payment_success', 'CareFind: payment received', 'CareFind <support@mail.carefind.app>', 'support@mail.carefind.app'),
      ('carefind', 'password_reset', 'password_reset', 'CareFind: reset', 'CareFind <support@mail.carefind.app>', 'support@mail.carefind.app'),
      ('carehub', 'withdrawal_requested', 'withdrawal_requested', 'CareHub: withdrawal requested', 'CareHub <support@mail.carefindhub.com>', 'support@mail.carefindhub.com'),
      ('carehub', 'password_reset', 'password_reset', 'CareHub: reset', 'CareHub <support@mail.carefindhub.com>', 'support@mail.carefindhub.com');
  `)
  await db.exec(M('carefind_20261101_payment_email_events'))
}, 240_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const listed = async (since = '48 hours', limit = 100) => all('select * from list_unnotified_money_events($1::interval, $2)', [since, limit])
// payment intents are inserted fresh and walked through the state machine, as in production
const intent = async (cols, vals, finalStatus) => {
  const row = (await one(`insert into payment_intents (${cols}) values (${vals.map((_, i) => '$' + (i + 1)).join(',')}) returning id`, vals)).id
  const path = { pending: ['pending'], settled: ['pending', 'verified', 'settled'] }[finalStatus]
  for (const st of path) await db.query('update payment_intents set status = $2 where id = $1', [row, st])
  return row
}
const queued = (key) => db.query(`insert into public.email_outbox (idempotency_key) values ($1)`, [key])

const user = async (coins = 0) => {
  const u = uid()
  await db.query('insert into auth.users (id) values ($1)', [u])
  if (coins) await db.query(`select _post_coin_entry($1,$2,'topup',$3)`, [u, coins, ref('seed')])
  return u
}
const completedWithdrawal = async () => {
  const u = await user(20)
  const w = (await one(`select create_withdrawal($1,10,'GTBank','058','0123456789','Ada Obi',null) r`, [u])).r
  await db.query(`select settle_withdrawal('success', null, $1, null, null)`, [w.id])
  return { u, w }
}
const refundedWithdrawal = async () => {
  const u = await user(20)
  const w = (await one(`select create_withdrawal($1,10,'GTBank','058','0123456789','Ada Obi',null) r`, [u])).r
  await db.query(`select settle_withdrawal('failed', null, $1, null, 'transfer.failed')`, [w.id])
  return { u, w }
}

describe('the catalog', () => {
  it('registers and enables every payment event for the brand that sends it', async () => {
    const rows = await all(`select app, event_key, enabled, category, from_email from public.email_event_catalog
      where event_key in ('withdrawal_processing','refund_requested','refund_completed','refund_failed','payment_failed','business_wallet_topup','wallet_needs_attention','payout_account_review')
      order by app, event_key`)
    const keys = (app) => rows.filter((r) => r.app === app).map((r) => r.event_key)
    // carefind: all of those but business_wallet_topup; carehub: all of those but wallet_needs_attention
    expect(keys('carefind')).toEqual(['payment_failed', 'payout_account_review', 'refund_completed', 'refund_failed', 'refund_requested', 'wallet_needs_attention', 'withdrawal_processing'])
    expect(keys('carehub')).toEqual(['business_wallet_topup', 'payment_failed', 'payout_account_review', 'refund_completed', 'refund_failed', 'refund_requested', 'withdrawal_processing'])
    for (const r of rows) {
      expect(r.enabled).toBe(true)
      expect(r.category).toBe('transactional')
      expect(r.from_email).toContain(r.app === 'carehub' ? 'CareHub <support@mail.carefindhub.com>' : 'CareFind <support@mail.carefind.app>')
    }
  })

  it('switches on the events that already existed, and never touches any other event', async () => {
    const on = await all(`select app, event_key, enabled from public.email_event_catalog where event_key in ('withdrawal_requested','withdrawal_completed','payment_success') order by 1,2`)
    expect(on.every((r) => r.enabled === true)).toBe(true)
    const untouched = await all(`select app, event_key, enabled from public.email_event_catalog where event_key = 'password_reset'`)
    expect(untouched).toHaveLength(2)
    expect(untouched.every((r) => r.enabled === false)).toBe(true)
  })

  it('is re-runnable and does not duplicate or flip anything back', async () => {
    await db.query(`update public.email_event_catalog set subject_template = 'custom subject' where app = 'carefind' and event_key = 'refund_failed'`)
    await db.exec(M('carefind_20261101_payment_email_events'))
    const row = await one(`select subject_template, enabled from public.email_event_catalog where app = 'carefind' and event_key = 'refund_failed'`)
    expect(row).toEqual({ subject_template: 'custom subject', enabled: true })
    expect((await one(`select count(*)::int c from public.email_event_catalog where event_key = 'refund_failed'`)).c).toBe(2)
  })

  it('an app without a withdrawal_requested row to model on simply registers nothing for it (no error)', async () => {
    await db.query(`delete from public.email_event_catalog where app = 'carehub' and event_key = 'refund_requested'`)
    await db.query(`delete from public.email_event_catalog where app = 'carehub' and event_key = 'withdrawal_requested'`)
    await expect(db.exec(M('carefind_20261101_payment_email_events'))).resolves.toBeDefined()
    expect((await one(`select count(*)::int c from public.email_event_catalog where app = 'carehub' and event_key = 'refund_requested'`)).c).toBe(0)
  })
})

describe('list_unnotified_money_events', () => {
  it('lists a completed CareFind withdrawal until its e-mail is queued under the key the e-mail uses', async () => {
    const { w } = await completedWithdrawal()
    let rows = (await listed()).filter((r) => r.subject_id === w.id)
    expect(rows).toEqual([expect.objectContaining({ kind: 'withdrawal_completed', app: 'carefind', reference: w.reference, coins: 10 })])
    expect(Number(rows[0].amount_kobo)).toBe(160000)
    await queued(`withdrawal-completed:${w.reference}`)
    rows = (await listed()).filter((r) => r.subject_id === w.id)
    expect(rows).toEqual([])
  })

  it('lists a refunded withdrawal as failed, under its own key', async () => {
    const { w } = await refundedWithdrawal()
    expect((await listed()).filter((r) => r.subject_id === w.id)).toEqual([expect.objectContaining({ kind: 'withdrawal_failed' })])
    await queued(`withdrawal-completed:${w.reference}`) // the OTHER e-mail's key does not hide it
    expect((await listed()).filter((r) => r.subject_id === w.id)).toHaveLength(1)
    await queued(`withdrawal-failed:${w.reference}`)
    expect((await listed()).filter((r) => r.subject_id === w.id)).toEqual([])
  })

  it('does not list a request that is still reserved or processing, or one with no reference', async () => {
    const u = await user(20)
    const w = (await one(`select create_withdrawal($1,10,'GTBank','058','0123456789','Ada',null) r`, [u])).r
    expect((await listed()).filter((r) => r.subject_id === w.id)).toEqual([])
  })

  it('lists CareHub business withdrawals with their own keys', async () => {
    const b = uid()
    await db.query('insert into business_wallets (business_id, available_balance) values ($1, 1000000)', [b])
    const done = (await one(`select create_business_withdrawal($1,200000,'GTBank','058','0123456789','Clinic',null,null) r`, [b])).r
    await db.query(`select settle_business_withdrawal('success', null, $1, null, null)`, [done.id])
    const failed = (await one(`select create_business_withdrawal($1,200000,'GTBank','058','0123456789','Clinic',null,null) r`, [b])).r
    await db.query(`select settle_business_withdrawal('failed', null, $1, null, null)`, [failed.id])
    const rows = await listed()
    expect(rows.find((r) => r.subject_id === done.id)).toMatchObject({ kind: 'business_withdrawal_completed', app: 'carehub', business_id: b })
    expect(rows.find((r) => r.subject_id === failed.id)).toMatchObject({ kind: 'business_withdrawal_failed' })
    await queued(`business-withdrawal-completed:${done.reference}`)
    expect((await listed()).find((r) => r.subject_id === done.id)).toBeUndefined()
    expect((await listed()).find((r) => r.subject_id === failed.id)).toBeDefined()
  })

  it('lists settled top-ups until their receipt is queued (CareFind coins and CareHub wallet)', async () => {
    const u = await user()
    const b = uid()
    const coin = await intent('reference, application, purpose, customer_id, expected_amount, provider', [ref('cf_topup'), 'carefind', 'wallet_topup', u, 22000, 'paystack'], 'settled')
    const wallet = await intent('reference, application, purpose, business_id, expected_amount, provider', [ref('ch_topup'), 'carehub', 'business_wallet_topup', b, 550000, 'paystack'], 'settled')
    const rows = await listed()
    expect(rows.find((r) => r.subject_id === coin)).toMatchObject({ kind: 'wallet_topup', app: 'carefind', user_id: u })
    expect(rows.find((r) => r.subject_id === wallet)).toMatchObject({ kind: 'business_wallet_topup', app: 'carehub', business_id: b })
    const refs = await all('select id, reference from payment_intents where id in ($1,$2)', [coin, wallet])
    await queued(`payment-success:${refs.find((r) => r.id === coin).reference}`)
    await queued(`wallet-topped-up:${refs.find((r) => r.id === wallet).reference}`)
    const after = await listed()
    expect(after.find((r) => r.subject_id === coin)).toBeUndefined()
    expect(after.find((r) => r.subject_id === wallet)).toBeUndefined()
  })

  it('does not list a payment that never settled', async () => {
    const u = await user()
    const open = await intent('reference, application, purpose, customer_id, expected_amount, provider', [ref('cf_topup'), 'carefind', 'wallet_topup', u, 22000, 'paystack'], 'pending')
    expect((await listed()).find((r) => r.subject_id === open)).toBeUndefined()
  })

  it('lists completed and failed refunds with the payer and entity the e-mail needs', async () => {
    const u = await user()
    const e1 = uid(); const e2 = uid()
    await db.query(`insert into refunds (reference, kind, cause, status, entity_type, entity_id, provider_transaction_reference, customer_id, amount_kobo, completed_at)
      values ($1,'card','needs_refund_intent','completed','payment_intent',$2,$3,$4,50000, now())`, [ref('rf'), e1, ref('tx'), u])
    await db.query(`insert into refunds (reference, kind, cause, status, entity_type, entity_id, provider_transaction_reference, customer_id, amount_kobo, failed_at)
      values ($1,'card','needs_refund_intent','failed','payment_intent',$2,$3,$4,70000, now())`, [ref('rf'), e2, ref('tx'), u])
    const rows = await listed()
    expect(rows.find((r) => r.entity_id === e1)).toMatchObject({ kind: 'refund_completed', user_id: u, entity_type: 'payment_intent' })
    expect(Number(rows.find((r) => r.entity_id === e1).amount_kobo)).toBe(50000)
    expect(rows.find((r) => r.entity_id === e2)).toMatchObject({ kind: 'refund_failed' })
    const id = rows.find((r) => r.entity_id === e1).subject_id
    await queued(`refund-completed:${id}`)
    expect((await listed()).find((r) => r.entity_id === e1)).toBeUndefined()
  })

  it('only looks inside the window, and the limit is honoured and bounded', async () => {
    const { w } = await completedWithdrawal()
    await db.exec('set session_replication_role = replica')
    await db.query(`update withdrawal_requests set completed_at = now() - interval '3 days' where id = $1`, [w.id])
    await db.exec('set session_replication_role = origin')
    expect((await listed('48 hours')).find((r) => r.subject_id === w.id)).toBeUndefined()
    expect((await listed('7 days')).find((r) => r.subject_id === w.id)).toBeDefined()
    expect((await listed('7 days', 1)).length).toBe(1)
    expect((await listed('7 days', 0)).length).toBe(1) // never below one
    expect((await listed('7 days', 100000)).length).toBeLessThanOrEqual(500)
  })

  it('writes nothing, and only service_role can call it', async () => {
    const before = (await one('select count(*)::int c from public.email_outbox')).c
    await listed()
    expect((await one('select count(*)::int c from public.email_outbox')).c).toBe(before)
    const acl = await one(`select has_function_privilege('anon', 'public.list_unnotified_money_events(interval,integer)', 'execute') a,
      has_function_privilege('authenticated', 'public.list_unnotified_money_events(interval,integer)', 'execute') b,
      has_function_privilege('service_role', 'public.list_unnotified_money_events(interval,integer)', 'execute') c`)
    expect(acl).toEqual({ a: false, b: false, c: true })
    expect(await all(`select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'list_unnotified_money_events'`)).toHaveLength(1)
  })
})
