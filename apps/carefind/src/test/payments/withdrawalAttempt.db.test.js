// @vitest-environment node
// H04 (carefind_20261031_withdrawal_attempt_and_conflicts), real Postgres (PGlite), every migration in production order:
//   * the attempt marker: reserved = no transfer call was made, processing = a call was made or is in flight;
//   * provider reports that contradict the books are stamped on the request and surface as 'provider_conflict';
//   * an in-flight transfer is not a reconciliation problem until it is overdue;
//   * the stray pre-engine reject_business_withdrawal(uuid) is gone;
//   * refund-at-most-once and the state guard are unchanged.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 250000).toString(16).padStart(12, '0')}`
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
  await db.exec(`
    alter table public.transactions add constraint transactions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
    alter table public.wallets add constraint wallets_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  `)
  await db.exec(M('carefind_20261003_payment_intents_foundation'))
  await db.exec(M('carefind_20261004_settle_payment_intent'))
  await db.exec(M('carefind_20261005_coin_ledger'))
  await createLegacyStubs(db)
  await db.exec(M('carefind_20261005_coin_writers_use_ledger'))
  await db.exec(M('carefind_20261005_lock_wallets_to_ledger'))
  await db.exec(M('carefind_20261008_withdrawal_engine'))
  // The state production is in: the stray pre-engine function was re-created after the engine retired it.
  await db.exec(`
    create or replace function public.reject_business_withdrawal(p_request_id uuid) returns text language plpgsql security definer as $$
    begin return 'stray'; end; $$;
  `)
  await db.exec(M('carefind_20261031_withdrawal_attempt_and_conflicts'))
}, 180_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const user = async (coins = 0) => {
  const u = uid()
  await db.query('insert into auth.users (id) values ($1)', [u])
  if (coins) await db.query(`select _post_coin_entry($1,$2,'topup',$3)`, [u, coins, ref('seed')])
  return u
}
const bal = async (u) => Number((await one('select balance from wallets where user_id = $1', [u]))?.balance ?? 0)
const create = async (u, coins = 10) => (await one(`select create_withdrawal($1,$2,'GTBank','058','0123456789','Ada Obi',null) r`, [u, coins])).r
const mark = async (id) => (await one('select mark_withdrawal_transfer_attempt($1) r', [id])).r
const settle = async (outcome, id, amount = null, detail = null) => (await one('select settle_withdrawal($1,null,$2,$3,$4) r', [outcome, id, amount, detail])).r
const row = (id) => one('select * from withdrawal_requests where id = $1', [id])
const conflictsFor = async (id) => (await all(`select * from reconcile_withdrawals(60) where kind = 'provider_conflict' and request_id = $1`, [id]))

const biz = async (kobo) => { const b = uid(); await db.query('insert into business_wallets (business_id, available_balance) values ($1,$2)', [b, kobo]); return b }
const bcreate = async (b, kobo) => (await one(`select create_business_withdrawal($1,$2,'GTBank','058','0123456789','Clinic',null,null) r`, [b, kobo])).r
const bmark = async (id) => (await one('select mark_business_withdrawal_transfer_attempt($1) r', [id])).r
const bsettle = async (outcome, id, amount = null) => (await one('select settle_business_withdrawal($1,null,$2,$3,null) r', [outcome, id, amount])).r
const brow = (id) => one('select * from business_withdrawal_requests where id = $1', [id])
const avail = async (b) => Number((await one('select available_balance a from business_wallets where business_id = $1', [b])).a)

describe('the attempt marker (CareFind)', () => {
  it('moves reserved to processing, and a retry keeps the ORIGINAL mark time (it starts the provider window)', async () => {
    const u = await user(20)
    const w = await create(u)
    expect((await row(w.id)).status).toBe('reserved')
    expect(await mark(w.id)).toBe('ok')
    const first = await row(w.id)
    expect(first.status).toBe('processing')
    await db.query(`update withdrawal_requests set updated_at = now() - interval '40 minutes' where id = $1`, [w.id])
    const aged = (await row(w.id)).updated_at
    expect(await mark(w.id)).toBe('ok')
    expect((await row(w.id)).updated_at).toEqual(aged)
    expect((await row(w.id)).status).toBe('processing')
  })

  it('refuses once the request is settled, and for an unknown id; nothing changes', async () => {
    const u = await user(20)
    const w = await create(u)
    await settle('failed', w.id)
    expect(await mark(w.id)).toBe('already_refunded')
    expect((await row(w.id)).status).toBe('refunded')
    expect(await mark(uid())).toBe('not_found')
    const done = await create(u)
    await mark(done.id); await settle('success', done.id)
    expect(await mark(done.id)).toBe('already_completed')
  })

  it('a webhook that outruns the mark still settles a reserved request; the later mark is refused', async () => {
    const u = await user(20)
    const w = await create(u)
    expect((await settle('success', w.id)).result).toBe('completed')
    expect(await mark(w.id)).toBe('already_completed')
  })

  it('marked, then failed: refunded exactly once; replays and a late success never move money again', async () => {
    const u = await user(20)
    const w = await create(u)
    await mark(w.id)
    expect(await bal(u)).toBe(10)
    expect((await settle('failed', w.id)).result).toBe('refunded')
    expect(await bal(u)).toBe(20)
    for (let i = 0; i < 5; i++) expect((await settle('failed', w.id)).result).toBe('already_refunded')
    expect(await bal(u)).toBe(20)
    expect(await all('select * from reconcile_coin_wallets()')).toEqual([])
  })

  it('attach after the mark records the codes and leaves the state processing', async () => {
    const u = await user(20)
    const w = await create(u)
    await mark(w.id)
    expect((await one(`select attach_withdrawal_transfer($1,'TRF_1','RCP_1') r`, [w.id])).r).toBe('ok')
    expect(await row(w.id)).toMatchObject({ status: 'processing', paystack_transfer_code: 'TRF_1', paystack_recipient_code: 'RCP_1' })
  })
})

describe('provider conflicts are durable (CareFind)', () => {
  it('a success reported AFTER a refund is stamped once, changes no balance, and shows as provider_conflict', async () => {
    const u = await user(20)
    const w = await create(u)
    await mark(w.id)
    await settle('failed', w.id)
    const before = await bal(u)
    for (let i = 0; i < 4; i++) expect((await settle('success', w.id)).result).toBe('conflict_paid_after_refund')
    const r = await row(w.id)
    expect(r.status).toBe('refunded')
    expect(r.failure_reason.match(/conflict:paid_after_refund/g)).toHaveLength(1) // idempotent, not appended four times
    expect(await bal(u)).toBe(before)
    expect(await conflictsFor(w.id)).toEqual([expect.objectContaining({ app: 'carefind', request_id: w.id })])
  })

  it('a failure reported after completion is stamped, the request stays completed, no refund', async () => {
    const u = await user(20)
    const w = await create(u)
    await mark(w.id); await settle('success', w.id)
    expect((await settle('failed', w.id)).result).toBe('conflict_failed_after_completed')
    expect((await row(w.id)).status).toBe('completed')
    expect((await row(w.id)).failure_reason).toContain('conflict:failed_after_completed')
    expect(await bal(u)).toBe(10)
    expect(await conflictsFor(w.id)).toHaveLength(1)
  })

  it('a success for the wrong amount is refused, stamped, and the request stays in flight', async () => {
    const u = await user(20)
    const w = await create(u)
    await mark(w.id)
    const r = await settle('success', w.id, 12345)
    expect(r.result).toBe('amount_mismatch')
    expect(await row(w.id)).toMatchObject({ status: 'processing' })
    expect((await row(w.id)).failure_reason).toContain('conflict:amount_mismatch')
    expect(await conflictsFor(w.id)).toHaveLength(1)
  })

  it('an ordinary failed/refunded request has no conflict and is not reported', async () => {
    const u = await user(20)
    const w = await create(u)
    await mark(w.id); await settle('failed', w.id, null, 'transfer.failed')
    expect((await row(w.id)).failure_reason).toBe('transfer.failed')
    expect(await conflictsFor(w.id)).toEqual([])
  })

  it('the immutable fields are still immutable', async () => {
    const u = await user(20)
    const w = await create(u)
    await expect(db.query(`update withdrawal_requests set amount = 1 where id = $1`, [w.id])).rejects.toThrow(/immutable/)
    await expect(db.query(`update withdrawal_requests set status = 'completed' where id = $1 and false`, [w.id])).resolves.toBeDefined()
    await mark(w.id); await settle('failed', w.id)
    await expect(db.query(`update withdrawal_requests set status = 'processing' where id = $1`, [w.id])).rejects.toThrow(/illegal withdrawal status change/)
  })
})

describe('reconciliation of in-flight transfers', () => {
  const stale = async (id, minutes, table = 'withdrawal_requests') =>
    db.query(`update ${table} set updated_at = now() - make_interval(mins => $2) where id = $1`, [id, minutes])
  const flagged = async (id) => (await all(`select kind from reconcile_withdrawals(60) where request_id = $1 and kind = 'processing_without_transfer'`, [id])).length

  it('processing with no code is normal until it is overdue (stale window + 30 minutes)', async () => {
    const u = await user(20)
    const w = await create(u)
    await mark(w.id)
    expect(await flagged(w.id)).toBe(0)
    await stale(w.id, 80)
    expect(await flagged(w.id)).toBe(0)
    await stale(w.id, 100)
    expect(await flagged(w.id)).toBe(1)
  })

  it('processing WITH a transfer code is never flagged for lacking one', async () => {
    const u = await user(20)
    const w = await create(u)
    await mark(w.id)
    await db.query(`select attach_withdrawal_transfer($1,'TRF_9','RCP_9')`, [w.id])
    await stale(w.id, 500)
    expect(await flagged(w.id)).toBe(0)
  })

  it('still reports everything it reported before (stuck, ledger and amount checks)', async () => {
    const u = await user(20)
    const w = await create(u)
    // created_at is immutable by design; a test backdates it with the guard triggers off for this one statement
    await db.exec("set session_replication_role = replica")
    await db.query(`update withdrawal_requests set created_at = now() - interval '3 hours' where id = $1`, [w.id])
    await db.exec("set session_replication_role = origin")
    expect((await all(`select kind from reconcile_withdrawals(60) where request_id = $1`, [w.id])).map((r) => r.kind)).toContain('stuck')
  })

  it('provider_conflict is critical by default in the reconciliation severity map (no listed kind downgrades it)', () => {
    const text = M('carefind_20261014_reconciliation')
    const fn = text.slice(text.indexOf('function public._recon_severity'))
    const body = fn.slice(0, fn.indexOf('$$;', fn.indexOf('as $$')) )
    expect(body).not.toContain('provider_conflict')
    expect(body).toMatch(/else 'critical'/)
  })
})

describe('CareHub business withdrawals', () => {
  it('mark moves reserved to processing; a late mark after settlement is refused', async () => {
    const b = await biz(1_000_000)
    const w = await bcreate(b, 200_000)
    expect(await bmark(w.id)).toBe('ok')
    expect((await brow(w.id)).status).toBe('processing')
    await bsettle('failed', w.id)
    expect(await bmark(w.id)).toBe('already_refunded')
    expect(await avail(b)).toBe(1_000_000)
  })

  it('refunds once under replays; a success after the refund is stamped and moves nothing', async () => {
    const b = await biz(1_000_000)
    const w = await bcreate(b, 300_000)
    await bmark(w.id)
    expect(await avail(b)).toBe(700_000)
    expect((await bsettle('failed', w.id)).result).toBe('refunded')
    expect((await bsettle('failed', w.id)).result).toBe('already_refunded')
    expect(await avail(b)).toBe(1_000_000)
    for (let i = 0; i < 3; i++) expect((await bsettle('success', w.id)).result).toBe('conflict_paid_after_refund')
    expect(await avail(b)).toBe(1_000_000)
    const r = await brow(w.id)
    expect(r.status).toBe('refunded')
    expect(r.failure_reason.match(/conflict:paid_after_refund/g)).toHaveLength(1)
    expect((await all(`select * from reconcile_withdrawals(60) where kind = 'provider_conflict' and request_id = $1`, [w.id])).map((x) => x.app)).toEqual(['carehub'])
  })

  it('a wrong-amount success is stamped and the request stays in flight', async () => {
    const b = await biz(1_000_000)
    const w = await bcreate(b, 150_000)
    await bmark(w.id)
    expect((await bsettle('success', w.id, 1)).result).toBe('amount_mismatch')
    expect((await brow(w.id)).status).toBe('processing')
    expect((await brow(w.id)).failure_reason).toContain('conflict:amount_mismatch')
  })
})

describe('function surface', () => {
  it('the stray reject_business_withdrawal is gone', async () => {
    expect(await all(`select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'reject_business_withdrawal'`)).toEqual([])
  })

  it('each engine function is ONE function and the new ones are service_role only', async () => {
    for (const name of ['mark_withdrawal_transfer_attempt', 'mark_business_withdrawal_transfer_attempt', 'settle_withdrawal', 'settle_business_withdrawal', 'reconcile_withdrawals']) {
      expect(await all(`select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = $1`, [name])).toHaveLength(1)
    }
    for (const sig of ['public.mark_withdrawal_transfer_attempt(uuid)', 'public.mark_business_withdrawal_transfer_attempt(uuid)']) {
      const acl = await one(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b, has_function_privilege('service_role', $1, 'execute') c`, [sig])
      expect(acl).toEqual({ a: false, b: false, c: true })
    }
  })

  it('the settle functions keep their ACL (service_role only) after being re-created', async () => {
    for (const sig of ['public.settle_withdrawal(text,text,uuid,bigint,text)', 'public.settle_business_withdrawal(text,text,uuid,bigint,text)']) {
      const acl = await one(`select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b, has_function_privilege('service_role', $1, 'execute') c`, [sig])
      expect(acl).toEqual({ a: false, b: false, c: true })
    }
  })

  it('re-applying the migration is harmless', async () => {
    await db.exec(M('carefind_20261031_withdrawal_attempt_and_conflicts'))
    const u = await user(20)
    const w = await create(u)
    expect(await mark(w.id)).toBe('ok')
  })
})
