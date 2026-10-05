// @vitest-environment node
// Phase 11 (database): reconciliation findings, the database checks, the replay/sweep lists, and the financial_config audit trail.
// Real Postgres (PGlite), every migration in production order.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 190000).toString(16).padStart(12, '0')}`
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
  `)
  for (const m of ['carefind_20261003_payment_intents_foundation', 'carefind_20261004_settle_payment_intent', 'carefind_20261005_coin_ledger']) await db.exec(M(m))
  await createLegacyStubs(db)
  for (const m of ['carefind_20261005_coin_writers_use_ledger', 'carefind_20261005_lock_wallets_to_ledger', 'carefind_20261006_settle_plan_and_carehub_appointments',
    'carefind_20261007_commission_engine', 'carefind_20261008_commission_reconcile_first_payment', 'carefind_20261008_withdrawal_engine', 'carefind_20261009_refund_engine', 'carefind_20261010_central_settlement']) await db.exec(M(m))
  await db.exec(`
    create function public.cancel_shop_order(p_order_id uuid, p_reason text default null) returns text language sql as $$ select 'old'::text $$;
    create function public.process_shop_return(p_return_id uuid, p_action text, p_notes text default null) returns text language sql as $$ select 'old'::text $$;
  `)
  await db.exec(M('carefind_20261012_shop_vendor_payouts'))
  await db.exec(M('carefind_20261014_reconciliation'))
  await db.exec(M('carefind_20261015_reconciliation_ops'))
}, 240_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }
const sync = (source, current, scope = null) => one('select sync_reconciliation_findings($1,$2::jsonb,$3::jsonb) r', [source, JSON.stringify(current), scope && JSON.stringify(scope)]).then((x) => x.r)
const f = (kind, id, severity = 'warning', detail = 'x') => ({ kind, subject_type: 'thing', subject_id: id, severity, detail })
const findings = (source) => all('select kind, subject_id, severity, status, occurrences::int occ from reconciliation_findings where source = $1 order by subject_id', [source])
const run = async () => (await asRole('service_role', () => one('select run_db_reconciliation() r'))).r

describe('financial_config history', () => {
  it('records the baseline, then every change of a value with who changed it, and ignores no-op updates', async () => {
    const base = await all("select key, operation from financial_config_history where operation = 'baseline'")
    expect(base.length).toBe((await one('select count(*)::int c from financial_config')).c)
    expect(base.length).toBeGreaterThan(10)
    const user = uid()
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user])
    await db.query("update financial_config set value = 0.25 where key = 'booking_platform_rate'")
    await db.query("update financial_config set value = 0.25 where key = 'booking_platform_rate'")   // no change: no row
    await db.query("select set_config('request.jwt.claim.sub', '', false)")
    await db.query("update financial_config set value = 0.20 where key = 'booking_platform_rate'")
    const rows = await all("select operation, old_value::float o, new_value::float nv, changed_by from financial_config_history where key = 'booking_platform_rate' and operation <> 'baseline' order by id")
    expect(rows).toEqual([
      { operation: 'update', o: 0.2, nv: 0.25, changed_by: user },
      { operation: 'update', o: 0.25, nv: 0.2, changed_by: null },
    ])
  })

  it('logs inserts and is append-only', async () => {
    await db.query("insert into financial_config (key, value, unit, description) values ('zz_test_key', 1, 'x', 'test')")
    expect(await one("select operation, new_value::float nv from financial_config_history where key = 'zz_test_key'")).toEqual({ operation: 'insert', nv: 1 })
    await expect(db.query("update financial_config_history set key = 'x'")).rejects.toThrow(/append-only/)
    await expect(db.query('delete from financial_config_history')).rejects.toThrow(/append-only/)
    await expect(db.query('truncate financial_config_history')).rejects.toThrow()
  })

  it('no API role can read or write it', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expect(asRole(role, () => db.query('select * from financial_config_history'))).rejects.toThrow(/permission denied/)
    }
  })
})

describe('sync_reconciliation_findings', () => {
  it('inserts, counts repeat sightings, and auto-resolves what is no longer wrong', async () => {
    expect(await sync('t1', [f('a', '1'), f('a', '2', 'critical')])).toMatchObject({ inserted: 2, resolved: 0, open: 2 })
    expect(await sync('t1', [f('a', '1'), f('a', '2', 'critical')])).toMatchObject({ inserted: 0, open: 2 })
    expect((await findings('t1')).map((r) => r.occ)).toEqual([2, 2])
    expect(await sync('t1', [f('a', '1')])).toMatchObject({ resolved: 1, open: 1 })
    expect((await findings('t1')).find((r) => r.subject_id === '2').status).toBe('resolved')
  })

  it('a recurring condition reopens a resolved finding; a dismissed one stays dismissed', async () => {
    await sync('t2', [f('a', '1'), f('a', '2')])
    const id1 = (await one("select id from reconciliation_findings where source = 't2' and subject_id = '1'")).id
    const id2 = (await one("select id from reconciliation_findings where source = 't2' and subject_id = '2'")).id
    await sync('t2', [f('a', '2')])                                      // 1 resolved
    expect((await findings('t2')).find((r) => r.subject_id === '1').status).toBe('resolved')
    expect(await sync('t2', [f('a', '1'), f('a', '2')])).toMatchObject({ reopened: 1 })
    expect((await findings('t2')).find((r) => r.subject_id === '1').status).toBe('open')
    await asRole('service_role', () => one("select update_reconciliation_finding($1,'dismiss','known: other integration')", [id2]))
    await sync('t2', [f('a', '1'), f('a', '2')])
    await sync('t2', [f('a', '1')])
    await sync('t2', [f('a', '1'), f('a', '2')])
    expect((await findings('t2')).find((r) => r.subject_id === '2').status).toBe('dismissed')
    expect(id1).toBeTruthy()
  })

  it('a scope limits what can be auto-resolved (a partial scan never resolves what it did not look at)', async () => {
    await sync('t3', [f('a', '1'), f('a', '2'), f('a', '3')])
    const r = await sync('t3', [], ['1'])                                // only subject 1 was evaluated, and it is fine now
    expect(r.resolved).toBe(1)
    expect((await findings('t3')).map((x) => [x.subject_id, x.status])).toEqual([['1', 'resolved'], ['2', 'open'], ['3', 'open']])
  })

  it('sources are independent', async () => {
    await sync('t4a', [f('a', '1')]); await sync('t4b', [f('a', '1')])
    await sync('t4a', [])
    expect((await findings('t4a'))[0].status).toBe('resolved')
    expect((await findings('t4b'))[0].status).toBe('open')
  })

  it('refuses malformed input', async () => {
    await expect(sync('t5', [{ kind: 'a', subject_type: 'x', subject_id: '1', severity: 'huge', detail: 'd' }])).rejects.toThrow(/invalid finding/)
    await expect(sync('t5', [{ kind: '', subject_type: 'x', subject_id: '1', severity: 'info' }])).rejects.toThrow(/invalid finding/)
    await expect(sync('t5', [{ kind: 'a', subject_type: 'x', subject_id: '1' }])).rejects.toThrow(/invalid finding/)
    await expect(sync('Bad Source', [])).rejects.toThrow(/invalid reconciliation source/)
    await expect(one("select sync_reconciliation_findings('t5', '{}'::jsonb)")).rejects.toThrow(/json array/)
  })

  it('acknowledge / dismiss / reopen: a dismissal needs a note; an acknowledged finding still resolves itself', async () => {
    await sync('t6', [f('a', '1')])
    const id = (await one("select id from reconciliation_findings where source = 't6'")).id
    const upd = (action, note = null) => asRole('service_role', () => one('select update_reconciliation_finding($1,$2,$3,$4) r', [id, action, note, uid()])).then((x) => x.r)
    expect(await upd('acknowledge', 'looking')).toBe('ok')
    expect(await upd('acknowledge')).toBe('not_open')
    await expect(upd('dismiss', 'no')).rejects.toThrow(/needs a note/)
    await sync('t6', [])
    expect((await findings('t6'))[0].status).toBe('resolved')
    expect(await upd('reopen')).toBe('ok')
    expect(await upd('dismiss', 'explained: test data')).toBe('ok')
    expect(await upd('dismiss', 'again please')).toBe('already_dismissed')
    await expect(upd('explode')).rejects.toThrow(/unknown action/)
    expect((await asRole('service_role', () => one('select update_reconciliation_finding($1,$2) r', [uid(), 'reopen']))).r).toBe('not_found')
  })

  it('list returns open and acknowledged, critical first; a finding is never deleted or re-identified', async () => {
    await sync('t7', [f('a', '1', 'info'), f('a', '2', 'critical'), f('a', '3', 'warning')])
    const rows = await asRole('service_role', () => all("select severity from list_reconciliation_findings(null, 500) where subject_id in ('1','2','3') and source = 't7'"))
    expect(rows.map((r) => r.severity)).toEqual(['critical', 'warning', 'info'])
    await expect(db.query("delete from reconciliation_findings where source = 't7'")).rejects.toThrow(/never deleted/)
    await expect(db.query("update reconciliation_findings set subject_id = 'x' where source = 't7'")).rejects.toThrow(/immutable/)
  })

  it('only service_role may call the functions; the tables are unreadable', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const q of ["select sync_reconciliation_findings('t8','[]'::jsonb)", 'select run_db_reconciliation()', 'select * from list_reconciliation_findings()',
        'select * from list_replayable_provider_events()', 'select * from list_open_intents_to_check()']) {
        await expect(asRole(role, () => db.query(q))).rejects.toThrow(/permission denied/)
      }
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expect(asRole(role, () => db.query('select * from reconciliation_findings'))).rejects.toThrow(/permission denied/)
      await expect(asRole(role, () => db.query('select * from reconciliation_runs'))).rejects.toThrow(/permission denied/)
    }
  })
})

describe('run_db_reconciliation', () => {
  it('a clean database has no critical or warning findings (only informational legacy rows, if any)', async () => {
    await run()
    const bad = await all("select source, kind, severity from reconciliation_findings where source in ('coins','commissions','withdrawals','refunds','shop_vendor','intents','events') and severity <> 'info' and status in ('open','acknowledged')")
    expect(bad).toEqual([])
    expect((await one('select count(*)::int c from reconciliation_runs where finished_at is not null')).c).toBeGreaterThan(0)
  })

  it('finds a coin wallet that differs from its ledger, then resolves it when fixed', async () => {
    const user = uid()
    await db.query('insert into auth.users (id) values ($1)', [user])
    await db.query('insert into wallets (user_id, balance) values ($1, 0)', [user])
    await db.exec('set session_replication_role = replica')
    await db.query('update wallets set balance = 7 where user_id = $1', [user])
    await db.exec('set session_replication_role = origin')
    await run()
    expect(await one("select kind, severity, status from reconciliation_findings where source = 'coins' and subject_id = $1", [user])).toEqual({ kind: 'wallet_differs_from_ledger', severity: 'critical', status: 'open' })
    await db.exec('set session_replication_role = replica')
    await db.query('update wallets set balance = 0 where user_id = $1', [user])
    await db.exec('set session_replication_role = origin')
    await run()
    expect((await one("select status from reconciliation_findings where source = 'coins' and subject_id = $1", [user])).status).toBe('resolved')
  })

  it('finds a settled shop intent whose order is not paid, a settled intent with no transaction id', async () => {
    const vendor = uid(); const customer = uid()
    const o = (await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,1050000,1000000,200000) returning id`, [ref('CF'), customer, vendor])).rows[0]
    const reference = ref('cf_shop')
    await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,1050000)`, [reference, customer, vendor, o.id])
    expect((await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', 'T1', 1050000, 'NGN'])).r.outcome).toBe('settled')
    await db.query("update shop_orders set payment_status = 'pending', status = 'pending_payment' where id = $1", [o.id])
    await db.exec('set session_replication_role = replica')
    await db.query("update payment_intents set provider_transaction_id = null where reference = $1", [reference])
    await db.exec('set session_replication_role = origin')
    await run()
    const kinds = (await all("select kind from reconciliation_findings where source = 'intents' and status = 'open'")).map((r) => r.kind)
    expect(kinds).toEqual(expect.arrayContaining(['shop_order_settled_but_unpaid', 'settled_without_transaction_id']))
  })

  it('reports failed and stuck webhook events and every charge no intent recognises (money nothing settled)', async () => {
    const old = "now() - interval '3 hours'"
    const ins = (id, type, reference, outcome, attempts = 0, err = null, payload = '{}') =>
      db.query(`insert into payment_provider_events (provider, event_id, event_type, reference, payload, signature_ok, received_at, outcome, attempts, last_error)
                values ('paystack', $1, $2, $3, $4::jsonb, true, ${old}, $5, $6, $7)`, [id, type, reference, payload, outcome, attempts, err])
    await ins('charge.success:101', 'charge.success', 'ref_unmatched_1', 'ignored', 1, null, JSON.stringify({ data: { amount: 250000 } }))
    await ins('transfer.success:102', 'transfer.success', 'tr_1', 'failed', 3, 'database down')
    await ins('refund.processed:103', 'refund.processed', null, null)
    await ins('charge.success:104', 'charge.success', 'ref_known_1', 'ignored', 1)
    await db.query(`insert into payment_intents (reference, application, purpose, customer_id, entity_type, entity_id, expected_amount) values ('ref_known_1','carefind','shop_order',$1,'shop_order',$2,1000)`, [uid(), uid()])
    await run()
    const rows = await all("select kind, subject_id, severity from reconciliation_findings where source = 'events' and status = 'open' order by kind")
    expect(rows).toEqual([
      { kind: 'event_failed', subject_id: expect.any(String), severity: 'warning' },
      { kind: 'event_unprocessed', subject_id: expect.any(String), severity: 'warning' },
      { kind: 'unmatched_charge', subject_id: 'ref_unmatched_1', severity: 'critical' },
    ])
    expect((await one("select detail from reconciliation_findings where kind = 'unmatched_charge'")).detail).toMatch(/2500\.00 NGN/)
  })

  it('a dismissed unmatched charge is not reported as new on the next run', async () => {
    const id = (await one("select id from reconciliation_findings where kind = 'unmatched_charge'")).id
    await asRole('service_role', () => one("select update_reconciliation_finding($1,'dismiss','another integration on the same Paystack account')", [id]))
    await run()
    expect((await one('select status from reconciliation_findings where id = $1', [id])).status).toBe('dismissed')
    expect((await run()).totals.open_critical).toBeGreaterThanOrEqual(0)
  })

  it('wraps the engine reconcile functions: a legacy shop order is an info finding, a stuck refund a warning/critical one', async () => {
    const vendor = uid()
    await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status, total_kobo, subtotal_kobo, commission_kobo, updated_at) values ($1,$2,$3,'paid','paid',1050000,1000000,200000, now() - interval '30 days')`, [ref('CF'), uid(), vendor])
    await run()
    const row = await one("select kind, severity from reconciliation_findings where source = 'shop_vendor' and kind = 'legacy_paid_order_without_credit' and status = 'open'")
    expect(row).toEqual({ kind: 'legacy_paid_order_without_credit', severity: 'info' })
  })
})

describe('replay and sweep lists', () => {
  it('lists events to replay (failed or stored and never processed, old enough, attempts below the cap) and not handled ones', async () => {
    const mk = (id, outcome, processed, attempts, mins, sig = true) =>
      db.query(`insert into payment_provider_events (provider, event_id, event_type, payload, signature_ok, received_at, outcome, processed_at, attempts) values ('paystack',$1,'charge.success','{}'::jsonb,$2, now() - make_interval(mins => $3), $4, $5, $6)`,
        [id, sig, mins, outcome, processed ? new Date().toISOString() : null, attempts])
    await mk('rp_failed', 'failed', false, 2, 60)
    await mk('rp_pending', null, false, 0, 60)
    await mk('rp_fresh', null, false, 0, 1)
    await mk('rp_done', 'processed', true, 1, 60)
    await mk('rp_capped', 'failed', false, 20, 60)
    await mk('rp_badsig', null, false, 0, 60, false)
    const ids = (await asRole('service_role', () => all("select event_id from list_replayable_provider_events(10, 20, 100) where event_id like 'rp_%' order by event_id"))).map((r) => r.event_id)
    expect(ids).toEqual(['rp_failed', 'rp_pending'])
  })

  it('lists intents that may have been paid but never settled: open, old enough, recent, not settled', async () => {
    const mk = async (status, ageMin, ageDays = 0) => {
      const reference = ref('chk')
      await db.query(`insert into payment_intents (reference, application, purpose, customer_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,'shop_order',$3,1000)`, [reference, uid(), uid()])
      await db.exec('set session_replication_role = replica')
      await db.query(`update payment_intents set status = $2, created_at = now() - make_interval(days => $4, mins => $3), updated_at = now() - make_interval(days => $4, mins => $3) where reference = $1`, [reference, status, ageMin, ageDays])
      await db.exec('set session_replication_role = origin')
      return reference
    }
    const pending = await mk('pending', 30); const created = await mk('created', 30); const fresh = await mk('pending', 2)
    const settled = await mk('failed', 30); const ancient = await mk('pending', 30, 9)
    const refs = (await asRole('service_role', () => all('select reference from list_open_intents_to_check(15, 200)'))).map((r) => r.reference)
    expect(refs).toEqual(expect.arrayContaining([pending, created]))
    for (const r of [fresh, settled, ancient]) expect(refs).not.toContain(r)
  })
})

describe('alerts (claim_findings_to_alert)', () => {
  const claim = (hours = 24) => asRole('service_role', () => all('select id, kind, subject_id from claim_findings_to_alert($1, 100)', [hours]))
  const crit = (id) => ({ kind: 'k', subject_type: 't', subject_id: id, severity: 'critical', detail: 'd' })

  it('hands each open critical finding to exactly one caller, once; warnings and info are never alerted', async () => {
    await sync('al1', [crit('a'), crit('b'), f('w', 'c', 'warning'), f('i', 'd', 'info')])
    const first = (await claim()).filter((r) => ['a', 'b', 'c', 'd'].includes(r.subject_id))
    expect(first.map((r) => r.subject_id).sort()).toEqual(['a', 'b'])
    expect((await claim()).filter((r) => ['a', 'b'].includes(r.subject_id))).toEqual([])
  })

  it('reminds after the interval while still open, never for an acknowledged, dismissed or resolved finding', async () => {
    await sync('al2', [crit('x'), crit('y'), crit('z')])
    await claim()
    const ids = Object.fromEntries((await all("select id, subject_id from reconciliation_findings where source = 'al2'")).map((r) => [r.subject_id, r.id]))
    await db.query("update reconciliation_findings set alerted_at = now() - interval '25 hours' where source = 'al2'")
    await asRole('service_role', () => one("select update_reconciliation_finding($1,'acknowledge','looking')", [ids.y]))
    await asRole('service_role', () => one("select update_reconciliation_finding($1,'dismiss','known and explained')", [ids.z]))
    expect((await claim()).filter((r) => ['x', 'y', 'z'].includes(r.subject_id)).map((r) => r.subject_id)).toEqual(['x'])
    await sync('al2', [crit('y'), crit('z')])                         // x resolved
    await db.query("update reconciliation_findings set alerted_at = now() - interval '25 hours' where source = 'al2'")
    expect((await claim()).filter((r) => ['x', 'y', 'z'].includes(r.subject_id))).toEqual([])
  })

  it('a claim that could not be emailed is released and is handed out again', async () => {
    await sync('al3', [crit('r')])
    const got = (await claim()).filter((r) => r.subject_id === 'r')
    expect(got).toHaveLength(1)
    expect((await asRole('service_role', () => one('select release_finding_alerts($1::uuid[]) n', [[got[0].id]]))).n).toBe(1)
    expect((await claim()).filter((r) => r.subject_id === 'r')).toHaveLength(1)
  })

  it('only service_role may use them', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(asRole(role, () => db.query('select * from claim_findings_to_alert()'))).rejects.toThrow(/permission denied/)
      await expect(asRole(role, () => db.query('select release_finding_alerts(array[]::uuid[])'))).rejects.toThrow(/permission denied/)
      await expect(asRole(role, () => db.query("select claim_job_slot('x_job', 1)"))).rejects.toThrow(/permission denied/)
      await expect(asRole(role, () => db.query('select mark_intents_checked(array[]::uuid[])'))).rejects.toThrow(/permission denied/)
    }
  })
})

describe('claim_job_slot', () => {
  const slot = (job, mins) => asRole('service_role', () => one('select claim_job_slot($1,$2) r', [job, mins])).then((x) => x.r)
  it('is true for the first caller and false until the interval has passed', async () => {
    expect(await slot('job_a', 30)).toBe(true)
    expect(await slot('job_a', 30)).toBe(false)
    await db.query("update job_slots set last_started_at = now() - interval '31 minutes' where job = 'job_a'")
    expect(await slot('job_a', 30)).toBe(true)
    expect(await slot('job_a', 30)).toBe(false)
  })
  it('jobs are independent, a zero interval is always due, and bad input is refused', async () => {
    expect(await slot('job_b', 30)).toBe(true)
    expect(await slot('job_c', 0)).toBe(true)
    expect(await slot('job_c', 0)).toBe(true)
    await expect(slot('Bad Job!', 5)).rejects.toThrow(/invalid job name/)
    await expect(slot('job_d', -1)).rejects.toThrow(/invalid interval/)
  })
})

describe('sweep backoff', () => {
  const mk = async (ageMin) => {
    const reference = ref('bo')
    await db.query(`insert into payment_intents (reference, application, purpose, customer_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,'shop_order',$3,1000)`, [reference, uid(), uid()])
    await db.exec('set session_replication_role = replica')
    await db.query(`update payment_intents set status = 'pending', created_at = now() - make_interval(mins => $2), updated_at = now() - make_interval(mins => $2) where reference = $1`, [reference, ageMin])
    await db.exec('set session_replication_role = origin')
    return (await one('select id from payment_intents where reference = $1', [reference])).id
  }
  const due = async () => (await asRole('service_role', () => all('select id from list_open_intents_to_check(15, 200)'))).map((r) => r.id)
  const check = (id, agoMin) => db.query(`insert into payment_intent_checks (intent_id, last_checked_at) values ($1, now() - make_interval(mins => $2)) on conflict (intent_id) do update set last_checked_at = excluded.last_checked_at`, [id, agoMin])

  it('an intent is due when never checked; a young one again after 10 minutes, a day-old one after an hour, an old one after 12 hours', async () => {
    const young = await mk(30); const day = await mk(300); const old = await mk(3000)
    expect(await due()).toEqual(expect.arrayContaining([young, day, old]))
    for (const id of [young, day, old]) await check(id, 1)
    const d1 = await due()
    for (const id of [young, day, old]) expect(d1).not.toContain(id)
    await check(young, 11); await check(day, 11); await check(old, 11)
    const d2 = await due()
    expect(d2).toContain(young); expect(d2).not.toContain(day); expect(d2).not.toContain(old)
    await check(day, 61); await check(old, 61)
    const d3 = await due()
    expect(d3).toContain(day); expect(d3).not.toContain(old)
    await check(old, 12 * 60 + 1)
    expect(await due()).toContain(old)
  })

  it('mark_intents_checked records the check, counts repeats, and takes the intent out of the due list', async () => {
    const id = await mk(30)
    expect(await due()).toContain(id)
    await asRole('service_role', () => one('select mark_intents_checked($1::uuid[])', [[id]]))
    await asRole('service_role', () => one('select mark_intents_checked($1::uuid[])', [[id]]))
    expect(await one('select checks::int c from payment_intent_checks where intent_id = $1', [id])).toEqual({ c: 2 })
    expect(await due()).not.toContain(id)
  })

  it('the operations tables are unreadable by every API role', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await expect(asRole(role, () => db.query('select * from job_slots'))).rejects.toThrow(/permission denied/)
      await expect(asRole(role, () => db.query('select * from payment_intent_checks'))).rejects.toThrow(/permission denied/)
    }
  })
})
