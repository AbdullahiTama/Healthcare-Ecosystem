// @vitest-environment node
// Phase 08 (database): the withdrawal engine for CareFind (CareCoins) and CareHub (business wallets). Real
// Postgres (PGlite), every migration in production order, a replica of the live tables.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 110000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}`

const newDb = async () => {
  const d = new PGlite()
  await d.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await d.exec(read('./fixtures/liveSchemaSubset.sql'))
  await d.exec(`
    alter table public.transactions add constraint transactions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
    alter table public.wallets add constraint wallets_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  `)
  await d.exec(M('carefind_20261003_payment_intents_foundation'))
  await d.exec(M('carefind_20261004_settle_payment_intent'))
  await d.exec(M('carefind_20261005_coin_ledger'))
  await createLegacyStubs(d)
  await d.exec(M('carefind_20261005_coin_writers_use_ledger'))
  await d.exec(M('carefind_20261005_lock_wallets_to_ledger'))
  return d
}

beforeAll(async () => {
  db = await newDb()
  await db.exec(M('carefind_20261008_withdrawal_engine'))
}, 180_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }
const user = async (coins = 0) => {
  const u = uid()
  await db.query('insert into auth.users (id) values ($1)', [u])
  if (coins) await db.query(`select _post_coin_entry($1,$2,'topup',$3)`, [u, coins, ref('seed')])
  return u
}
const bal = async (u) => Number((await one('select balance from wallets where user_id = $1', [u]))?.balance ?? 0)
const create = async (u, coins = 10, cap = null) =>
  (await one(`select create_withdrawal($1,$2,'GTBank','058','0123456789','Ada Obi',$3) r`, [u, coins, cap])).r
const settle = async (outcome, key, extra = {}) =>
  (await one('select settle_withdrawal($1,$2,$3,$4,$5) r', [outcome, extra.byId ? null : key, extra.byId ? key : null, extra.amount ?? null, extra.detail ?? null])).r
const row = (id) => one('select * from withdrawal_requests where id = $1', [id])
const coinBooks = async () => {
  expect(await all('select * from reconcile_coin_wallets()')).toEqual([])
  expect(await all('select * from verify_coin_ledger_chain()')).toEqual([])
}
const cleanFor = async (id) => expect((await all('select * from reconcile_withdrawals(60)')).filter((x) => x.request_id === id)).toEqual([])

describe('CareFind: reserving a withdrawal', () => {
  it('creates the request, the debit and the reference in one step; the reference is derived from the request id', async () => {
    const u = await user(20)
    const r = await create(u, 10)
    expect(r.outcome).toBe('ok')
    expect(r.reference).toBe('cf_wd_' + r.id.replaceAll('-', ''))
    expect(r.reference.length).toBeLessThanOrEqual(50)
    expect(r.reference).toMatch(/^[a-z0-9_]+$/)           // Paystack: lowercase, digits, _ and -
    expect(r.payout_kobo).toBe(10 * 160 * 100)             // 10 coins = N2000, less the 20% fee = N1600
    const w = await row(r.id)
    expect(w).toMatchObject({ user_id: u, amount: 10, status: 'reserved', paystack_reference: r.reference, bank_code: '058' })
    expect(Number(w.payout_kobo)).toBe(160000)
    expect(await bal(u)).toBe(10)
    expect(await one(`select delta, reference from coin_ledger where user_id = $1 and kind = 'withdrawal'`, [u])).toMatchObject({ delta: -10, reference: 'wd_' + r.id })
    expect(await one(`select reference from transactions where user_id = $1 and type = 'withdrawal'`, [u])).toMatchObject({ reference: r.reference })
    await coinBooks()
  })

  it('every request gets its own id and reference; two identical requests are two withdrawals, both funded', async () => {
    const u = await user(40)
    const a = await create(u, 10); const b = await create(u, 10)
    expect(a.id).not.toBe(b.id)
    expect(a.reference).not.toBe(b.reference)
    expect(await bal(u)).toBe(20)
  })

  it('refuses without touching anything: below minimum, missing bank details, insufficient, no user', async () => {
    const u = await user(8)
    expect((await create(u, 4)).outcome).toBe('below_minimum')
    expect((await one(`select create_withdrawal($1,10,'',null,'1','x',null) r`, [u])).r.outcome).toBe('missing_bank_details')
    expect((await create(u, 9)).outcome).toBe('insufficient')
    expect((await one(`select create_withdrawal(null,10,'b','1','1','x',null) r`)).r.outcome).toBe('not_logged_in')
    expect(await bal(u)).toBe(8)
    expect(await all('select 1 from withdrawal_requests where user_id = $1', [u])).toHaveLength(0)
    expect(await all(`select 1 from coin_ledger where user_id = $1 and kind = 'withdrawal'`, [u])).toHaveLength(0)
  })

  it('enforces the rolling 24h cap inside the same transaction as the reservation; refunded requests do not count', async () => {
    const u = await user(100)
    expect((await create(u, 30, 50)).outcome).toBe('ok')
    expect((await create(u, 21, 50)).outcome).toBe('daily_limit')
    const r = await create(u, 20, 50)
    expect(r.outcome).toBe('ok')
    await settle('failed', r.reference)               // refunded -> frees the headroom
    expect((await create(u, 20, 50)).outcome).toBe('ok')
  })

  it('rejects a stored amount that is not positive', async () => {
    await expect(db.query("insert into withdrawal_requests (user_id, amount, status, paystack_reference) values ($1, 0, 'reserved', $2)", [uid(), ref('x')])).rejects.toThrow()
  })
})

describe('CareFind: provider linkage and settlement', () => {
  it('attach_withdrawal_transfer links the exact request and moves it to processing; replays are harmless', async () => {
    const u = await user(20); const r = await create(u, 10)
    expect((await one('select attach_withdrawal_transfer($1,$2,$3) r', [r.id, 'TRF_1', 'RCP_1'])).r).toBe('ok')
    expect(await row(r.id)).toMatchObject({ status: 'processing', paystack_transfer_code: 'TRF_1', paystack_recipient_code: 'RCP_1' })
    expect((await one('select attach_withdrawal_transfer($1,$2,$3) r', [r.id, 'TRF_OTHER', 'RCP_OTHER'])).r).toBe('ok')
    expect((await row(r.id)).paystack_transfer_code).toBe('TRF_1')   // never re-pointed
    expect((await one('select attach_withdrawal_transfer($1,$2,$3) r', [uid(), 'T', 'R'])).r).toBe('not_found')
  })

  it('a webhook that outruns the attach still completes it; the late attach records the code but does not reopen it', async () => {
    const u = await user(20); const r = await create(u, 10)
    expect((await settle('success', r.reference)).result).toBe('completed')
    expect((await one('select attach_withdrawal_transfer($1,$2,$3) r', [r.id, 'TRF_L', 'RCP_L'])).r).toBe('already_completed')
    expect(await row(r.id)).toMatchObject({ status: 'completed', paystack_transfer_code: 'TRF_L' })
  })

  it('success completes once; replays and by-id lookups agree; trust data returned', async () => {
    const u = await user(20); const r = await create(u, 10)
    await one('select attach_withdrawal_transfer($1,$2,$3) r', [r.id, 'T', 'R'])
    const a = await settle('success', r.reference, { amount: 160000 })
    expect(a).toMatchObject({ result: 'completed', user_id: u, amount: 10, from_status: 'processing' })
    expect((await settle('success', r.reference)).result).toBe('already_completed')
    expect((await settle('success', r.id, { byId: true })).result).toBe('already_completed')
    expect((await row(r.id)).completed_at).toBeTruthy()
    expect(await bal(u)).toBe(10)                          // coins stay spent
    await cleanFor(r.id)
  })

  it('a success for a different amount than reserved is NOT completed (provider linkage by amount)', async () => {
    const u = await user(20); const r = await create(u, 10)
    const x = await settle('success', r.reference, { amount: 999999 })
    expect(x).toMatchObject({ result: 'amount_mismatch', provider_amount_kobo: 999999 })
    expect((await row(r.id)).status).toBe('reserved')
  })

  it('failed refunds the coins exactly once, through the ledger; replays and a late reversal change nothing', async () => {
    const u = await user(20); const r = await create(u, 10)
    expect(await bal(u)).toBe(10)
    expect((await settle('failed', r.reference, { detail: 'insufficient funds at provider' })).result).toBe('refunded')
    expect(await bal(u)).toBe(20)
    expect(await row(r.id)).toMatchObject({ status: 'refunded', failure_reason: 'insufficient funds at provider' })
    for (const o of ['failed', 'reversed']) expect((await settle(o, r.reference)).result).toBe('already_refunded')
    expect(await bal(u)).toBe(20)
    expect(await all(`select 1 from coin_ledger where user_id = $1 and kind = 'withdrawal_refund'`, [u])).toHaveLength(1)
    expect(await all(`select 1 from transactions where user_id = $1 and type = 'withdrawal_refund'`, [u])).toHaveLength(1)
    await coinBooks(); await cleanFor(r.id)
  })

  it('a transfer that completed and is LATER reversed is refunded (reversal recovery), once', async () => {
    const u = await user(20); const r = await create(u, 10)
    await settle('success', r.reference)
    expect((await settle('reversed', r.reference)).result).toBe('refunded')
    expect(await bal(u)).toBe(20)
    expect((await settle('reversed', r.reference)).result).toBe('already_refunded')
    expect(await row(r.id)).toMatchObject({ status: 'refunded', failure_reason: 'reversed' })
    await coinBooks()
  })

  it('a reversal that arrives before the transfer was ever marked complete is refunded too', async () => {
    const u = await user(20); const r = await create(u, 10)
    await one('select attach_withdrawal_transfer($1,$2,$3) r', [r.id, 'T', 'R'])
    expect((await settle('reversed', r.reference)).result).toBe('refunded')
    expect(await bal(u)).toBe(20)
  })

  it('contradictory provider signals are reported, never "fixed": paid-after-refund, failed-after-completed', async () => {
    const u = await user(40)
    const a = await create(u, 10); await settle('failed', a.reference)
    expect((await settle('success', a.reference)).result).toBe('conflict_paid_after_refund')
    expect((await row(a.id)).status).toBe('refunded')
    const b = await create(u, 10); await settle('success', b.reference)
    expect((await settle('failed', b.reference)).result).toBe('conflict_failed_after_completed')
    expect((await row(b.id)).status).toBe('completed')
    expect(await bal(u)).toBe(30)
  })

  it('unknown references, unknown outcomes and missing keys', async () => {
    expect((await settle('success', 'cf_wd_nope')).result).toBe('not_found')
    await expect(settle('weird', 'x')).rejects.toThrow(/unknown withdrawal outcome/)
    await expect(db.query('select settle_withdrawal($1)', ['failed'])).rejects.toThrow(/reference or a request id/)
  })

  it('no negative balances and the books always balance after a mixed run', async () => {
    const u = await user(100)
    const rs = []
    for (let i = 0; i < 8; i++) rs.push(await create(u, 10))
    expect((await create(u, 21)).outcome).toBe('insufficient')   // 100 - 80 = 20
    await settle('failed', rs[0].reference); await settle('success', rs[1].reference); await settle('success', rs[2].reference)
    await settle('reversed', rs[2].reference); await settle('failed', rs[3].reference)
    const expected = 100 - 80 + 10 + 10 + 10
    expect(await bal(u)).toBe(expected)
    await coinBooks()
  })
})

describe('CareFind: the table cannot be changed around the engine', () => {
  it('state machine and immutability are enforced by the database', async () => {
    const u = await user(40); const r = await create(u, 10)
    const sql = (q) => db.query(q, [r.id])
    await expect(sql("update withdrawal_requests set status = 'refunded' where id = $1")).rejects.toThrow(/illegal withdrawal status/)
    await expect(sql("update withdrawal_requests set status = 'reversed' where id = $1")).rejects.toThrow(/illegal withdrawal status/)
    await expect(sql('update withdrawal_requests set amount = 1 where id = $1')).rejects.toThrow(/immutable/)
    await expect(sql("update withdrawal_requests set account_number = '999' where id = $1")).rejects.toThrow(/immutable/)
    await expect(sql("update withdrawal_requests set user_id = '00000000-0000-4000-8000-00000000ffff' where id = $1")).rejects.toThrow(/immutable/)
    await expect(sql("update withdrawal_requests set paystack_reference = 'other' where id = $1")).rejects.toThrow(/immutable/)
    await expect(sql('delete from withdrawal_requests where id = $1')).rejects.toThrow(/never deleted/)
    await expect(db.query('truncate withdrawal_requests')).rejects.toThrow()
    await db.query("update withdrawal_requests set status = 'completed' where id = $1", [r.id])
    await expect(sql("update withdrawal_requests set status = 'processing' where id = $1")).rejects.toThrow(/illegal withdrawal status/)
    await db.query("update withdrawal_requests set paystack_transfer_code = 'A' where id = $1", [r.id])
    await expect(sql("update withdrawal_requests set paystack_transfer_code = 'B' where id = $1")).rejects.toThrow(/linkage/)
  })

  it('no role can write the table or call the engine from the client side', async () => {
    const u = await user(20); const r = await create(u, 10)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await asRole(role, async () => {
        await expect(db.query("insert into withdrawal_requests (user_id, amount, status, paystack_reference) values ($1,5,'reserved','x')", [u])).rejects.toThrow(/permission denied/)
        await expect(db.query("update withdrawal_requests set status = 'completed'")).rejects.toThrow(/permission denied/)
        await expect(db.query('delete from withdrawal_requests')).rejects.toThrow(/permission denied/)
      })
    }
    for (const role of ['anon', 'authenticated']) {
      await asRole(role, async () => {
        await expect(db.query(`select create_withdrawal($1,10,'b','1','1','x',null)`, [u])).rejects.toThrow(/permission denied/)
        await expect(db.query(`select settle_withdrawal('failed', $1)`, [r.reference])).rejects.toThrow(/permission denied/)
        await expect(db.query('select attach_withdrawal_transfer($1,$2,$3)', [r.id, 'a', 'b'])).rejects.toThrow(/permission denied/)
        await expect(db.query('select * from reconcile_withdrawals(60)')).rejects.toThrow(/permission denied/)
      })
    }
  })

  it('the legacy functions are gone (no request_withdrawal replay branch, no second overload)', async () => {
    const names = (await all("select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('request_withdrawal','reject_withdrawal_request','approve_withdrawal_request','complete_withdrawal_transfer','request_business_withdrawal','reject_business_withdrawal','refund_business_withdrawal')")).map((r) => r.proname)
    expect(names).toEqual([])
    const counts = await all("select proname, count(*)::int c from pg_proc where pronamespace = 'public'::regnamespace and proname in ('create_withdrawal','settle_withdrawal','attach_withdrawal_transfer','create_business_withdrawal','settle_business_withdrawal','attach_business_withdrawal_transfer','reconcile_withdrawals') group by 1")
    expect(counts.every((c) => c.c === 1)).toBe(true)
  })
})

describe('CareFind: reconciliation', () => {
  it('reports stuck requests and the ledger inconsistencies it can see', async () => {
    const u = await user(100)
    const stuck = await create(u, 10)
    await db.query("alter table withdrawal_requests disable trigger withdrawal_requests_guard")
    await db.query("update withdrawal_requests set created_at = now() - interval '3 hours' where id = $1", [stuck.id])
    // a refunded request with no refund entry, and a refund entry on a request that is not refunded
    const noLedger = await create(u, 10)
    await db.query("update withdrawal_requests set status = 'refunded' where id = $1", [noLedger.id])
    const orphan = await create(u, 10)
    await db.query(`select _post_coin_entry($1,10,'withdrawal_refund',$2)`, [u, 'wd_refund_' + orphan.id])
    await db.query("alter table withdrawal_requests enable trigger withdrawal_requests_guard")
    const kinds = Object.fromEntries((await all('select kind, request_id from reconcile_withdrawals(60)')).filter((x) => [stuck.id, noLedger.id, orphan.id].includes(x.request_id)).map((x) => [x.request_id, x.kind]))
    expect(kinds[stuck.id]).toBe('stuck')
    expect(kinds[noLedger.id]).toBe('refunded_without_ledger')
    expect(kinds[orphan.id]).toBe('refund_without_refunded_status')
  })
})

describe('CareHub: business withdrawals', () => {
  const biz = async (kobo = 5_000_000) => {
    const b = uid()
    await db.query('insert into business_wallets (business_id, available_balance) values ($1,$2)', [b, kobo])
    return b
  }
  const bcreate = async (b, kobo = 1_000_000, cap = null) =>
    (await one(`select create_business_withdrawal($1,$2,'GTBank','058','0123456789','Clinic Ltd',$3,$4) r`, [b, kobo, uid(), cap])).r
  const bsettle = async (outcome, key, extra = {}) =>
    (await one('select settle_business_withdrawal($1,$2,$3,$4,$5) r', [outcome, extra.byId ? null : key, extra.byId ? key : null, extra.amount ?? null, extra.detail ?? null])).r
  const avail = async (b) => Number((await one('select available_balance a from business_wallets where business_id = $1', [b])).a)
  const brow = (id) => one('select * from business_withdrawal_requests where id = $1', [id])

  it('reserves atomically with a derived reference, a ledger transaction and the initiator recorded', async () => {
    const b = await biz(); const who = uid()
    const r = (await one(`select create_business_withdrawal($1,1000000,'GTBank','058','0123456789','Clinic Ltd',$2,null) r`, [b, who])).r
    expect(r.outcome).toBe('ok')
    expect(r.reference).toBe('ch_wd_' + r.id.replaceAll('-', ''))
    expect(await brow(r.id)).toMatchObject({ business_id: b, amount: 1000000, status: 'reserved', paystack_reference: r.reference, bank_code: '058', initiated_by: who })
    expect(await avail(b)).toBe(4_000_000)
    expect(await one(`select amount, reference from business_wallet_transactions where business_id = $1 and type = 'withdrawal'`, [b])).toMatchObject({ amount: -1000000, reference: r.reference })
  })

  it('refuses: below the provider floor, insufficient, no wallet, missing bank details, over the daily cap', async () => {
    const b = await biz(2_000_000)
    expect((await bcreate(b, 9_999)).outcome).toBe('below_minimum')
    expect((await bcreate(b, 2_000_001)).outcome).toBe('insufficient')
    expect((await bcreate(uid(), 20_000)).outcome).toBe('no_wallet')
    expect((await one(`select create_business_withdrawal($1,20000,'','058','1','x',null,null) r`, [b])).r.outcome).toBe('missing_bank_details')
    expect(await avail(b)).toBe(2_000_000)
    expect((await bcreate(b, 1_500_000, 2_000_000)).outcome).toBe('ok')
    expect((await bcreate(b, 400_000, 2_000_000)).outcome).toBe('ok')                       // 1.9M of 2.0M
    expect((await bcreate(b, 100_001, 2_000_000)).outcome).toBe('insufficient')             // wallet is 100,000 left
  })

  it('the default cap comes from financial_config (N1,000,000 per 24h); a refunded request frees the headroom', async () => {
    const b = await biz(500_000_000)
    const a = await bcreate(b, 60_000_000)
    expect(a.outcome).toBe('ok')
    expect((await bcreate(b, 50_000_000)).outcome).toBe('daily_limit')
    await bsettle('failed', a.reference)
    expect((await bcreate(b, 50_000_000)).outcome).toBe('ok')
  })

  it('failed and reversed refund exactly once; success completes once; amount mismatch and contradictions are reported', async () => {
    const b = await biz(10_000_000)
    const a = await bcreate(b, 1_000_000)
    expect((await one('select attach_business_withdrawal_transfer($1,$2,$3) r', [a.id, 'T', 'R'])).r).toBe('ok')
    expect((await brow(a.id)).status).toBe('processing')
    expect((await bsettle('failed', a.reference)).result).toBe('refunded')
    expect((await bsettle('failed', a.reference)).result).toBe('already_refunded')
    expect((await bsettle('reversed', a.reference)).result).toBe('already_refunded')
    expect((await bsettle('success', a.reference)).result).toBe('conflict_paid_after_refund')
    expect(await avail(b)).toBe(10_000_000)
    expect(await all(`select 1 from business_wallet_transactions where business_id = $1 and type = 'withdrawal_refund'`, [b])).toHaveLength(1)

    const c = await bcreate(b, 1_000_000)
    expect((await bsettle('success', c.reference, { amount: 1 })).result).toBe('amount_mismatch')
    expect((await bsettle('success', c.reference, { amount: 1_000_000 })).result).toBe('completed')
    expect((await bsettle('success', c.reference)).result).toBe('already_completed')
    expect((await bsettle('failed', c.reference)).result).toBe('conflict_failed_after_completed')
    expect(await avail(b)).toBe(9_000_000)
    expect((await bsettle('reversed', c.reference)).result).toBe('refunded')            // completed, later reversed
    expect(await avail(b)).toBe(10_000_000)
    expect((await bsettle('reversed', c.id, { byId: true })).result).toBe('already_refunded')
    expect((await brow(c.id)).status).toBe('refunded')
  })

  it('the business wallet never goes negative under a run of reservations', async () => {
    const b = await biz(3_000_000)
    const outcomes = []
    for (let i = 0; i < 6; i++) outcomes.push((await bcreate(b, 1_000_000, 0)).outcome)   // cap 0 = disabled
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(3)
    expect(outcomes.filter((o) => o === 'insufficient')).toHaveLength(3)
    expect(await avail(b)).toBe(0)
  })

  it('immutability, state machine and write access mirror CareFind', async () => {
    const b = await biz(); const r = await bcreate(b)
    await expect(db.query("update business_withdrawal_requests set status = 'refunded' where id = $1", [r.id])).rejects.toThrow(/illegal withdrawal status/)
    await expect(db.query('update business_withdrawal_requests set amount = 1 where id = $1', [r.id])).rejects.toThrow(/immutable/)
    await expect(db.query('delete from business_withdrawal_requests where id = $1', [r.id])).rejects.toThrow(/never deleted/)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await asRole(role, async () => {
        await expect(db.query("update business_withdrawal_requests set status = 'completed'")).rejects.toThrow(/permission denied/)
      })
    }
    await asRole('authenticated', async () => {
      await expect(db.query(`select create_business_withdrawal($1,20000,'b','1','1','x',null,null)`, [b])).rejects.toThrow(/permission denied/)
    })
  })

  it('reconciles clean after normal use; reports a refund that has no ledger entry', async () => {
    const b = await biz(5_000_000); const a = await bcreate(b, 1_000_000)
    await bsettle('failed', a.reference)
    expect((await all('select * from reconcile_withdrawals(60)')).filter((x) => x.request_id === a.id)).toEqual([])
    await db.query("alter table business_withdrawal_requests disable trigger business_withdrawal_requests_guard")
    const c = await bcreate(b, 1_000_000)
    await db.query("update business_withdrawal_requests set status = 'refunded' where id = $1", [c.id])
    await db.query("alter table business_withdrawal_requests enable trigger business_withdrawal_requests_guard")
    expect((await all('select kind from reconcile_withdrawals(60) where request_id = $1', [c.id])).map((x) => x.kind)).toEqual(['refunded_without_ledger'])
  })
})

describe('applying the migration to production-shaped data', () => {
  it('maps legacy statuses, keeps rows, and raises nothing', async () => {
    const d = await newDb()
    const u = uid(); await d.query('insert into auth.users (id) values ($1)', [u])
    const b = uid()
    const w = async (status, ref, code) => (await d.query('insert into withdrawal_requests (user_id, amount, status, paystack_reference, paystack_transfer_code) values ($1,5,$2,$3,$4) returning id', [u, status, ref, code])).rows[0].id
    const ids = {
      pendingNoRef: await w('pending', null, null), pendingRef: await w('pending', 'a1', null), pendingCode: await w('pending', 'a2', 'T'),
      approved: await w('approved', 'a3', 'T'), rejected: await w('rejected', 'a4', null), completed: await w('completed', 'a5', 'T'),
    }
    const bw = async (status, ref, code) => (await d.query('insert into business_withdrawal_requests (business_id, amount, status, paystack_reference, paystack_transfer_code) values ($1,20000,$2,$3,$4) returning id', [b, status, ref, code])).rows[0].id
    const bids = { pending: await bw('pending', 'b1', null), processing: await bw('processing', 'b2', 'T'), failed: await bw('failed', 'b3', null), rejected: await bw('rejected', 'b4', null), completed: await bw('completed', 'b5', 'T') }
    await d.exec(M('carefind_20261008_withdrawal_engine'))
    const status = async (t, id) => (await d.query(`select status from ${t} where id = $1`, [id])).rows[0].status
    expect(await status('withdrawal_requests', ids.pendingNoRef)).toBe('reserved')
    expect(await status('withdrawal_requests', ids.pendingRef)).toBe('reserved')
    expect(await status('withdrawal_requests', ids.pendingCode)).toBe('processing')
    expect(await status('withdrawal_requests', ids.approved)).toBe('processing')
    expect(await status('withdrawal_requests', ids.rejected)).toBe('refunded')
    expect(await status('withdrawal_requests', ids.completed)).toBe('completed')
    expect(await status('business_withdrawal_requests', bids.pending)).toBe('reserved')
    expect(await status('business_withdrawal_requests', bids.processing)).toBe('processing')
    expect(await status('business_withdrawal_requests', bids.failed)).toBe('refunded')
    expect(await status('business_withdrawal_requests', bids.rejected)).toBe('refunded')
    // pre-cutover refunds have no ledger entries and must not be reported as inconsistent
    expect((await d.query("select kind from reconcile_withdrawals(60) where kind <> 'stuck'")).rows).toEqual([])
    // legacy rows still settle through the engine (a rows without a transfer code can be refunded)
    const r = (await d.query("select settle_withdrawal('failed', 'a1') r")).rows[0].r
    expect(r.result).toBe('refunded')
  }, 180_000)
})
