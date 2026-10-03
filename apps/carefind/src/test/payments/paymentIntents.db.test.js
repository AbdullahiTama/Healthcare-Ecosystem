// @vitest-environment node
// Financial program, Phase 02: the payment_intents foundation, tested against a REAL Postgres
// (PGlite) with the real migration file - constraints, triggers and grants are database behaviour,
// so a mock would prove nothing. Supabase's default privileges (ALL to anon/authenticated/
// service_role on every new public table) are reproduced before the migration runs, because that
// is exactly what the migration has to undo.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { REFERRAL_RATES } from '../../../../carehub/src/lib/referral_program.js'

const MIGRATION = fileURLToPath(
  new URL('../../../../../supabase/migrations/carefind_20261003_payment_intents_foundation.sql', import.meta.url)
)

let db
let seq = 0

const base = (over = {}) => ({
  reference: `ref_test_${++seq}_${Math.random().toString(36).slice(2, 8)}`,
  application: 'carefind',
  purpose: 'wallet_topup',
  customer_id: '11111111-1111-1111-1111-111111111111',
  business_id: null,
  entity_type: null,
  entity_id: null,
  expected_amount: 500000,
  currency: 'NGN',
  metadata: {},
  ...over,
})

async function insertIntent(over = {}) {
  const r = base(over)
  const res = await db.query(
    `insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount, currency, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) returning *`,
    [r.reference, r.application, r.purpose, r.customer_id, r.business_id, r.entity_type, r.entity_id, r.expected_amount, r.currency, JSON.stringify(r.metadata)]
  )
  return res.rows[0]
}

const setStatus = (id, status) => db.query('update payment_intents set status = $2 where id = $1 returning *', [id, status])

async function asRole(role, fn) {
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls; -- as in Supabase: service_role bypasses RLS
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  `)
  await db.exec(readFileSync(MIGRATION, 'utf8'))
})

describe('payment_intents: shape and integer money', () => {
  it('inserts a fresh intent as "created" with server defaults', async () => {
    const row = await insertIntent()
    expect(row.status).toBe('created')
    expect(row.provider).toBe('paystack')
    expect(row.currency).toBe('NGN')
    expect(row.verified_at).toBeNull()
    expect(row.settled_at).toBeNull()
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000)
  })

  it('refuses a duplicate reference', async () => {
    const row = await insertIntent()
    await expect(insertIntent({ reference: row.reference })).rejects.toThrow(/payment_intents_reference_key|duplicate key/)
  })

  it.each([
    ['zero amount', { expected_amount: 0 }],
    ['negative amount', { expected_amount: -100 }],
    ['decimal amount', { expected_amount: 100.5 }],
    ['non-NGN currency', { currency: 'USD' }],
    ['unknown purpose', { purpose: 'free_money' }],
    ['unknown application', { application: 'carebank' }],
    ['too-short reference', { reference: 'abc' }],
    ['reference with spaces', { reference: 'has space in it 123' }],
    ['array metadata', { metadata: [] }],
    ['entity_type without entity_id', { entity_type: 'appointment', entity_id: null }],
  ])('rejects %s', async (_label, over) => {
    await expect(insertIntent(over)).rejects.toThrow()
  })

  it('rejects an intent inserted already settled, verified, or carrying a provider transaction id', async () => {
    for (const col of ['status', 'verified_at', 'provider_transaction_id']) {
      const values = { status: `'settled'`, verified_at: 'now()', provider_transaction_id: `'T1'` }
      const ref = `ref_bad_${++seq}_abcdefgh`
      const extra = col === 'status' ? `, settled_at` : ''
      const extraVal = col === 'status' ? `, now()` : ''
      const verified = col === 'status' ? `, verified_at` : ''
      const verifiedVal = col === 'status' ? `, now()` : ''
      await expect(
        db.query(
          `insert into payment_intents (reference, application, purpose, expected_amount, ${col}${extra}${verified})
           values ('${ref}', 'carefind', 'wallet_topup', 100, ${values[col]}${extraVal}${verifiedVal})`
        )
      ).rejects.toThrow()
    }
  })
})

describe('payment_intents: identity is immutable', () => {
  it.each([
    ['reference', `'ref_changed_00001'`],
    ['provider', `'flutterwave'`],
    ['application', `'carehub'`],
    ['purpose', `'booking'`],
    ['customer_id', `'22222222-2222-2222-2222-222222222222'`],
    ['business_id', `'22222222-2222-2222-2222-222222222222'`],
    ['expected_amount', '1'],
    ['currency', `'NGN'::text || ''`],
  ])('cannot change %s', async (col, value) => {
    const row = await insertIntent({ business_id: '33333333-3333-3333-3333-333333333333' })
    if (col === 'currency') {
      // same value is a no-op and must stay allowed; the CHECK already pins NGN
      await expect(db.query(`update payment_intents set currency = ${value} where id = $1`, [row.id])).resolves.toBeDefined()
      return
    }
    await expect(db.query(`update payment_intents set ${col} = ${value} where id = $1`, [row.id])).rejects.toThrow(
      /immutable|check constraint|violates/
    )
  })

  it('cannot be deleted or truncated', async () => {
    const row = await insertIntent()
    await expect(db.query('delete from payment_intents where id = $1', [row.id])).rejects.toThrow(/never deleted/)
    await expect(db.exec('truncate payment_intents')).rejects.toThrow(/not allowed/)
  })
})

describe('payment_intents: state machine', () => {
  it('walks created > pending > verified > settled > refunded and stamps the timestamps itself', async () => {
    const row = await insertIntent()
    expect((await setStatus(row.id, 'pending')).rows[0].status).toBe('pending')
    const verified = (await setStatus(row.id, 'verified')).rows[0]
    expect(verified.verified_at).not.toBeNull()
    const settled = (await setStatus(row.id, 'settled')).rows[0]
    expect(settled.settled_at).not.toBeNull()
    expect(settled.verified_at).toEqual(verified.verified_at)
    expect((await setStatus(row.id, 'refunded')).rows[0].status).toBe('refunded')
  })

  it.each([
    ['created', 'settled'],
    ['created', 'refunded'],
    ['pending', 'settled'],
    ['pending', 'needs_refund'],
  ])('refuses %s -> %s', async (from, to) => {
    const row = await insertIntent()
    if (from === 'pending') await setStatus(row.id, 'pending')
    await expect(setStatus(row.id, to)).rejects.toThrow(/illegal payment intent transition/)
  })

  it('treats settled and refunded as one-way', async () => {
    const row = await insertIntent()
    for (const s of ['pending', 'verified', 'settled']) await setStatus(row.id, s)
    for (const to of ['verified', 'pending', 'created', 'failed', 'expired', 'needs_refund']) {
      await expect(setStatus(row.id, to)).rejects.toThrow(/illegal payment intent transition/)
    }
    await setStatus(row.id, 'refunded')
    for (const to of ['settled', 'verified', 'pending', 'needs_refund']) {
      await expect(setStatus(row.id, to)).rejects.toThrow(/illegal payment intent transition/)
    }
  })

  it('accepts a late provider success on an expired or failed attempt instead of dropping it', async () => {
    const expired = await insertIntent()
    await setStatus(expired.id, 'expired')
    expect((await setStatus(expired.id, 'verified')).rows[0].verified_at).not.toBeNull()

    const failed = await insertIntent()
    await setStatus(failed.id, 'pending')
    await setStatus(failed.id, 'failed')
    expect((await setStatus(failed.id, 'verified')).rows[0].status).toBe('verified')
    // ...but a failed attempt can never be settled without being verified first
    const other = await insertIntent()
    await setStatus(other.id, 'failed')
    await expect(setStatus(other.id, 'settled')).rejects.toThrow(/illegal/)
  })

  it('routes a paid-but-unsettleable intent verified > needs_refund > refunded', async () => {
    const row = await insertIntent()
    await setStatus(row.id, 'verified')
    await setStatus(row.id, 'needs_refund')
    expect((await setStatus(row.id, 'refunded')).rows[0].status).toBe('refunded')
  })

  it('refuses to write a "verified"/"settled" status with the timestamp forced to null', async () => {
    const row = await insertIntent()
    await setStatus(row.id, 'verified')
    await expect(db.query('update payment_intents set verified_at = null where id = $1', [row.id])).rejects.toThrow()
    await expect(db.query(`update payment_intents set status = 'settled', settled_at = null where id = $1`, [row.id])).resolves.toBeDefined()
    // the trigger stamps settled_at itself, so the explicit null did not survive
    const after = await db.query('select settled_at from payment_intents where id = $1', [row.id])
    expect(after.rows[0].settled_at).not.toBeNull()
  })

  it('records the provider transaction id once, never changes it, and keeps it unique per provider', async () => {
    const a = await insertIntent()
    const b = await insertIntent()
    const txn = `TXN_${++seq}_${Date.now()}`
    await db.query('update payment_intents set provider_transaction_id = $2 where id = $1', [a.id, txn])
    await expect(db.query('update payment_intents set provider_transaction_id = $2 where id = $1', [a.id, 'OTHER'])).rejects.toThrow(/cannot be changed/)
    await expect(db.query('update payment_intents set provider_transaction_id = $2 where id = $1', [b.id, txn])).rejects.toThrow(/provider_txn_key|duplicate key/)
  })
})

describe('payment_provider_events', () => {
  const ev = (over = {}) => ({
    provider: 'paystack',
    event_id: `charge.success:${++seq}_${Date.now()}`,
    event_type: 'charge.success',
    reference: 'ref_event_00001',
    payload: { event: 'charge.success' },
    signature_ok: true,
    ...over,
  })
  const insertEvent = async (over = {}) => {
    const e = ev(over)
    return (
      await db.query(
        `insert into payment_provider_events (provider, event_id, event_type, reference, payload, signature_ok)
         values ($1,$2,$3,$4,$5::jsonb,$6) returning *`,
        [e.provider, e.event_id, e.event_type, e.reference, JSON.stringify(e.payload), e.signature_ok]
      )
    ).rows[0]
  }

  it('stores an event and refuses a replay of the same (provider, event_id)', async () => {
    const row = await insertEvent()
    expect(row.processed_at).toBeNull()
    await expect(insertEvent({ event_id: row.event_id })).rejects.toThrow(/payment_provider_events_dedupe|duplicate key/)
    // the same id from a different provider is a different event
    await expect(insertEvent({ provider: 'flutterwave', event_id: row.event_id })).resolves.toBeDefined()
  })

  it('keeps the observation immutable; only processing fields may change, and processed_at once', async () => {
    const row = await insertEvent()
    await expect(db.query(`update payment_provider_events set payload = '{"event":"forged"}' where id = $1`, [row.id])).rejects.toThrow(/immutable/)
    await expect(db.query(`update payment_provider_events set signature_ok = false where id = $1`, [row.id])).rejects.toThrow(/immutable/)
    await db.query(`update payment_provider_events set processed_at = now(), outcome = 'processed', attempts = 1 where id = $1`, [row.id])
    await expect(db.query(`update payment_provider_events set processed_at = now() + interval '1 hour' where id = $1`, [row.id])).rejects.toThrow(/cannot be changed/)
  })

  it('rejects an unknown outcome, a processed event without an outcome, and negative attempts', async () => {
    const row = await insertEvent()
    await expect(db.query(`update payment_provider_events set outcome = 'maybe' where id = $1`, [row.id])).rejects.toThrow()
    await expect(db.query(`update payment_provider_events set processed_at = now() where id = $1`, [row.id])).rejects.toThrow()
    await expect(db.query(`update payment_provider_events set attempts = -1 where id = $1`, [row.id])).rejects.toThrow()
  })

  it('cannot be deleted or truncated', async () => {
    const row = await insertEvent()
    await expect(db.query('delete from payment_provider_events where id = $1', [row.id])).rejects.toThrow(/never deleted/)
    await expect(db.exec('truncate payment_provider_events')).rejects.toThrow(/not allowed/)
  })
})

describe('financial_config mirrors the rules already in the code', () => {
  const get = async (key) => Number((await db.query('select value from financial_config where key = $1', [key])).rows[0]?.value)

  it('seeds every constant with the value currently hard-coded', async () => {
    expect(await get('coin_value_kobo')).toBe(200 * 100) // COIN_VALUE_NAIRA = 200 in initiate-withdrawal.js
    expect(await get('booking_platform_rate')).toBe(0.2) // settle_card_booking: * 0.2
    expect(await get('withdrawal_fee_rate')).toBe(0.2) // TRANSFER_FEE_RATE in initiate-withdrawal.js
    expect(await get('subscription_max_coins')).toBe(12) // charge-subscription.js
    expect(await get('min_withdrawal_coins')).toBe(5)
  })

  it('matches the CareHub referral rates in code (they are existing commercial rules, not new ones)', async () => {
    expect(await get('referral_first_payment_rate')).toBe(REFERRAL_RATES.referral_bonus)
    expect(await get('referral_residual_rate')).toBe(REFERRAL_RATES.residual)
  })

  it('rejects a rate above 100%, a negative value, a renamed key, and a delete', async () => {
    await expect(db.query(`update financial_config set value = 1.5 where key = 'booking_platform_rate'`)).rejects.toThrow()
    await expect(db.query(`update financial_config set value = -1 where key = 'coin_value_kobo'`)).rejects.toThrow()
    await expect(db.query(`update financial_config set key = 'renamed_key' where key = 'coin_value_kobo'`)).rejects.toThrow(/immutable/)
    await expect(db.query(`delete from financial_config where key = 'coin_value_kobo'`)).rejects.toThrow(/never deleted/)
  })
})

describe('access: server-only', () => {
  const tables = ['payment_intents', 'payment_provider_events', 'financial_config']
  const touch = { payment_intents: 'expected_amount', payment_provider_events: 'attempts', financial_config: 'value' }

  it('has RLS enabled and no policies on any of the three tables', async () => {
    const rls = await db.query(`select relname, relrowsecurity from pg_class where relname = any($1)`, [tables])
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true)
    expect(rls.rows).toHaveLength(3)
    const pol = await db.query(`select 1 from pg_policies where tablename = any($1)`, [tables])
    expect(pol.rows).toHaveLength(0)
  })

  it.each(['anon', 'authenticated'])('%s can neither read nor write any of them', async (role) => {
    for (const t of tables) {
      await expect(asRole(role, () => db.query(`select * from ${t}`))).rejects.toThrow(/permission denied/)
      await expect(asRole(role, () => db.query(`delete from ${t}`))).rejects.toThrow(/permission denied/)
      await expect(asRole(role, () => db.query(`update ${t} set ${touch[t]} = ${touch[t]}`))).rejects.toThrow(/permission denied/)
    }
    await expect(
      asRole(role, () => db.query(`insert into payment_intents (reference, application, purpose, expected_amount) values ('ref_anon_00001','carefind','wallet_topup',100)`))
    ).rejects.toThrow(/permission denied/)
  })

  it('service_role can read, insert and update but not delete or truncate', async () => {
    const id = (await insertIntent()).id
    await asRole('service_role', async () => {
      expect((await db.query('select 1 from payment_intents where id = $1', [id])).rows).toHaveLength(1)
      await db.query(`update payment_intents set status = 'pending' where id = $1`, [id])
      await expect(db.query('delete from payment_intents where id = $1', [id])).rejects.toThrow(/permission denied/)
    })
    await expect(asRole('service_role', () => db.exec('truncate payment_intents'))).rejects.toThrow(/permission denied/)
  })

  it('leaves no EXECUTE on the guard functions for client roles', async () => {
    const r = await db.query(
      `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') a, has_function_privilege('anon', p.oid, 'execute') n
         from pg_proc p where p.proname in ('payment_intents_guard','payment_provider_events_guard','financial_config_guard','financial_no_truncate')`
    )
    expect(r.rows).toHaveLength(4)
    expect(r.rows.every((x) => !x.a && !x.n)).toBe(true)
  })
})
