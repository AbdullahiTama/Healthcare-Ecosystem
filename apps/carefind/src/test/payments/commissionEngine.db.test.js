// @vitest-environment node
// Phase 07 (database): the referral commission engine. Real Postgres (PGlite), the real migrations, a replica
// of the live tables. Business rules under test are the EXISTING ones: first payment 40%, later payments 5%.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 90000).toString(16).padStart(12, '0')}`
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
  await db.exec(read('../../../../../supabase/migrations/carefind_20261003_payment_intents_foundation.sql'))
  await db.exec(read('../../../../../supabase/migrations/carefind_20261004_settle_payment_intent.sql'))
  await db.exec(read('../../../../../supabase/migrations/carefind_20261006_settle_plan_and_carehub_appointments.sql'))
  await db.exec(read('../../../../../supabase/migrations/carefind_20261007_commission_engine.sql'))
}, 120_000)

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const agent = async (status = 'active') => { const id = uid(); await db.query('insert into agents (id, status) values ($1,$2)', [id, status]); return id }
const business = async (agentId = null) => { const id = uid(); await db.query('insert into businesses (id, name, referring_agent_id) values ($1,$2,$3)', [id, 'Clinic', agentId]); return id }
const renew = async (b, naira = 5000, months = 1, reference = ref('pay')) =>
  (await one('select * from renew_business_plan($1,$2,$3,$4)', [b, months, naira, reference]))
const commissions = (b) => all('select * from commissions where business_id = $1 order by created_at, id', [b])
const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn() } finally { await db.exec('reset role') } }
const reconcile = () => all('select * from reconcile_commissions()')

describe('commission creation is part of the payment', () => {
  it('first payment -> one referral_bonus at 40% of the naira paid, with base, rate and ids recorded', async () => {
    const a = await agent(); const b = await business(a)
    const r = await renew(b, 5000)
    expect(r.is_first_payment).toBe(true)
    const rows = await commissions(b)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ agent_id: a, business_id: b, payment_id: r.payment_id, type: 'referral_bonus', status: 'accrued' })
    expect(Number(rows[0].rate)).toBe(0.4)
    expect(Number(rows[0].base_amount)).toBe(5000)
    expect(Number(rows[0].amount)).toBe(2000)
    expect(rows[0].created_at).toBeTruthy()
  })

  it('later payments -> residual at 5%', async () => {
    const a = await agent(); const b = await business(a)
    await renew(b, 5000)
    const r2 = await renew(b, 10000)
    expect(r2.is_first_payment).toBe(false)
    const rows = await commissions(b)
    expect(rows.map((x) => x.type)).toEqual(['referral_bonus', 'residual'])
    expect(Number(rows[1].amount)).toBe(500)
    expect(Number(rows[1].rate)).toBe(0.05)
  })

  it('rounds to kobo (2dp) not to the naira', async () => {
    const a = await agent(); const b = await business(a)
    await renew(b, 5000)
    await renew(b, 3333) // 5% = 166.65
    const rows = await commissions(b)
    expect(Number(rows[1].amount)).toBe(166.65)
  })

  it('a business with no referring agent earns nobody a commission and raises no flag', async () => {
    const b = await business(null)
    await renew(b)
    expect(await commissions(b)).toHaveLength(0)
    expect(await all('select 1 from commission_review_flags where payment_id in (select id from plan_payments where business_id = $1)', [b])).toHaveLength(0)
    expect(await reconcile()).toEqual([])
  })

  it('an inactive or suspended agent: no commission, one review flag (policy ACCRUED_WHILE_INACTIVE = false)', async () => {
    for (const status of ['suspended', 'inactive', 'pending_review']) {
      const a = await agent(status); const b = await business(a)
      const r = await renew(b)
      expect(await commissions(b)).toHaveLength(0)
      const flags = await all('select * from commission_review_flags where payment_id = $1', [r.payment_id])
      expect(flags.map((f) => f.reason)).toEqual([`agent_${status}`])
    }
  })

  it('the inactive-agent policy is configuration, not code: flipping it accrues instead of flagging', async () => {
    const a = await agent('suspended'); const b = await business(a)
    await db.query("update financial_config set value = 1 where key = 'referral_accrue_while_inactive'")
    try { await renew(b); expect(await commissions(b)).toHaveLength(1) }
    finally { await db.query("update financial_config set value = 0 where key = 'referral_accrue_while_inactive'") }
  })

  it('an attribution pointing at a missing agent is flagged, not lost', async () => {
    const b = await business(uid())
    const r = await renew(b)
    const flags = await all('select reason from commission_review_flags where payment_id = $1', [r.payment_id])
    expect(flags.map((f) => f.reason)).toEqual(['no_agent_for_attribution'])
  })

  it('replaying the same reference creates nothing new (idempotent)', async () => {
    const a = await agent(); const b = await business(a)
    const reference = ref('same')
    await renew(b, 5000, 1, reference)
    const again = await renew(b, 5000, 1, reference)
    expect(again.already_processed).toBe(true)
    expect(await commissions(b)).toHaveLength(1)
  })

  it('the rate is read from financial_config at the time of payment and frozen on the row', async () => {
    const a = await agent(); const b = await business(a)
    await db.query("update financial_config set value = 0.5 where key = 'referral_first_payment_rate'")
    try { await renew(b, 1000) } finally { await db.query("update financial_config set value = 0.4 where key = 'referral_first_payment_rate'") }
    const [c] = await commissions(b)
    expect(Number(c.rate)).toBe(0.5)
    expect(Number(c.amount)).toBe(500)
    const bad = (await reconcile()).filter((x) => x.business_id === b)
    expect(bad.map((x) => x.kind)).toEqual(['wrong_rate']) // config drifted: visible, not silently "fixed"
  })

  it('through the settlement engine: a plan_renewal intent produces the commission in the same transaction', async () => {
    const a = await agent(); const b = await business(a)
    const reference = ref('ch')
    await db.query(
      `insert into payment_intents (reference, application, purpose, business_id, expected_amount, metadata)
       values ($1,'carehub','plan_renewal',$2,500000,'{"months":1}'::jsonb)`, [reference, b])
    const r = (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', `T${reference}`, 500000, 'NGN'])).r
    expect(r.outcome).toBe('settled')
    const rows = await commissions(b)
    expect(rows).toHaveLength(1)
    expect(Number(rows[0].amount)).toBe(2000)
    // a replay of the same settlement adds nothing
    await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', `T${reference}`, 500000, 'NGN'])
    expect(await commissions(b)).toHaveLength(1)
  })

  it('a failure after the payment row is written rolls the whole renewal back (no payment without its commission)', async () => {
    const a = await agent(); const b = await business(a)
    // simulate the commission step failing after the payment row was written
    await db.exec(`create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`).catch(() => {})
    await db.exec(`create or replace function public.test_boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
                   create trigger test_boom before insert on public.commissions for each row execute function public.test_boom()`)
    try {
      await expect(renew(b, 5000)).rejects.toThrow(/boom/)
    } finally { await db.exec('drop trigger test_boom on public.commissions; drop function public.test_boom()') }
    expect(await all('select 1 from plan_payments where business_id = $1', [b])).toHaveLength(0)
    expect((await one('select plan_expires_at e from businesses where id = $1', [b])).e).toBeNull()
  })
})

describe('database invariants (cannot be bypassed by a buggy caller)', () => {
  it('a second referral_bonus for the same business is refused', async () => {
    const a = await agent(); const b = await business(a)
    await renew(b, 5000)
    const p2 = (await one("insert into plan_payments (business_id, months, naira_amount, reference, status, is_first_payment) values ($1,1,5000,$2,'success',false) returning id", [b, ref('x')])).id
    await expect(db.query("insert into commissions (agent_id, business_id, payment_id, type, base_amount, rate, amount) values ($1,$2,$3,'referral_bonus',5000,0.4,2000)", [a, b, p2])).rejects.toThrow(/one_bonus/)
  })

  it('a second payment flagged as first for the same business is refused', async () => {
    const b = await business(null)
    await renew(b)
    await expect(db.query("insert into plan_payments (business_id, months, naira_amount, reference, status, is_first_payment) values ($1,1,5000,$2,'success',true)", [b, ref('y')])).rejects.toThrow(/one_first/)
  })

  it('two commissions for one payment are refused', async () => {
    const a = await agent(); const b = await business(a)
    const r = await renew(b, 5000)
    await expect(db.query("insert into commissions (agent_id, business_id, payment_id, type, base_amount, rate, amount) values ($1,$2,$3,'residual',5000,0.05,250)", [a, b, r.payment_id])).rejects.toThrow()
  })

  it('amount must equal base x rate; rate within 0..1; type and status are enumerated', async () => {
    const a = await agent(); const b = await business(null)
    const p = (await one("insert into plan_payments (business_id, months, naira_amount, reference, status, is_first_payment) values ($1,1,1000,$2,'success',true) returning id", [b, ref('z')])).id
    const ins = (type, base, rate, amount, status = 'accrued') => db.query(
      'insert into commissions (agent_id, business_id, payment_id, type, base_amount, rate, amount, status) values ($1,$2,$3,$4,$5,$6,$7,$8)', [a, b, p, type, base, rate, amount, status])
    await expect(ins('referral_bonus', 1000, 0.4, 999)).rejects.toThrow(/amount_matches/)
    await expect(ins('referral_bonus', 1000, 1.5, 1500)).rejects.toThrow(/rate_range/)
    await expect(ins('bonus', 1000, 0.4, 400)).rejects.toThrow(/type_check/)
    await expect(ins('referral_bonus', 1000, 0.4, 400, 'whatever')).rejects.toThrow(/status_check/)
    await expect(ins('referral_bonus', 0, 0.4, 0)).rejects.toThrow(/base_positive/)
  })

  it('identity and amounts are immutable; status moves only forward; rows are never deleted', async () => {
    const a = await agent(); const b = await business(a)
    await renew(b, 5000)
    const [c] = await commissions(b)
    await expect(db.query('update commissions set amount = 9999 where id = $1', [c.id])).rejects.toThrow(/immutable/)
    await expect(db.query('update commissions set rate = 0.9 where id = $1', [c.id])).rejects.toThrow(/immutable/)
    await expect(db.query('update commissions set agent_id = $2 where id = $1', [c.id, await agent()])).rejects.toThrow(/immutable/)
    await expect(db.query('delete from commissions where id = $1', [c.id])).rejects.toThrow(/never deleted/)
    await expect(db.query('truncate commissions')).rejects.toThrow()
    await db.query("update commissions set status = 'payable' where id = $1", [c.id])
    await db.query("update commissions set status = 'paid' where id = $1", [c.id])
    await expect(db.query("update commissions set status = 'accrued' where id = $1", [c.id])).rejects.toThrow(/illegal commission status/)
    await expect(db.query("update commissions set status = 'void' where id = $1", [c.id])).rejects.toThrow(/illegal commission status/)
  })
})

describe('no client can create or alter a commission', () => {
  it('anon, authenticated and even service_role cannot write the tables directly', async () => {
    const a = await agent(); const b = await business(a)
    const r = await renew(b, 5000)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await asRole(role, async () => {
        await expect(db.query("insert into commissions (agent_id, business_id, payment_id, type, base_amount, rate, amount) values ($1,$2,$3,'residual',5000,0.05,250)", [a, b, uid()])).rejects.toThrow(/permission denied/)
        await expect(db.query("update commissions set status = 'paid'")).rejects.toThrow(/permission denied/)
        await expect(db.query('delete from commissions')).rejects.toThrow(/permission denied/)
        await expect(db.query('insert into commission_review_flags (payment_id, reason) values ($1,$2)', [r.payment_id, 'x'])).rejects.toThrow(/permission denied/)
      })
    }
  })

  it('anon and authenticated cannot call the engine, the renewal or the reconciliation', async () => {
    const b = await business(null)
    for (const role of ['anon', 'authenticated']) {
      await asRole(role, async () => {
        await expect(db.query('select renew_business_plan($1,1,5000,$2)', [b, ref('q')])).rejects.toThrow(/permission denied/)
        await expect(db.query('select _record_referral_commission($1)', [uid()])).rejects.toThrow(/permission denied/)
        await expect(db.query('select * from reconcile_commissions()')).rejects.toThrow(/permission denied/)
        await expect(db.query('select backfill_missing_commissions(10)')).rejects.toThrow(/permission denied/)
      })
    }
    await asRole('service_role', async () => {
      await expect(db.query('select _record_referral_commission($1)', [uid()])).rejects.toThrow(/permission denied/)
    })
  })

  it('set_commission_status requires service_role or a platform admin', async () => {
    const a = await agent(); const b = await business(a)
    await renew(b, 5000)
    const [c] = await commissions(b)
    await asRole('authenticated', async () => {
      await expect(db.query('select set_commission_status($1,$2)', [c.id, 'payable'])).rejects.toThrow(/Not authorized/)
    })
    await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
    try {
      await asRole('service_role', async () => {
        expect((await one('select set_commission_status($1,$2) r', [c.id, 'payable'])).r).toBe('ok')
        await expect(db.query('select set_commission_status($1,$2)', [c.id, 'accrued'])).rejects.toThrow(/illegal commission status/)
      })
    } finally { await db.exec("select set_config('request.jwt.claim.role','',false)") }
  })
})

describe('reconciliation and repair', () => {
  it('a clean ledger reconciles to nothing', async () => {
    const a = await agent(); const b = await business(a)
    await renew(b, 5000); await renew(b, 7000)
    expect((await reconcile()).filter((x) => x.business_id === b)).toEqual([])
  })

  it('finds a legacy payment with neither commission nor flag, and the backfill repairs it (idempotently)', async () => {
    const a = await agent(); const b = await business(a)
    const p = (await one("insert into plan_payments (business_id, months, naira_amount, reference, status, is_first_payment) values ($1,1,5000,$2,'success',true) returning id", [b, ref('legacy')])).id
    expect((await reconcile()).filter((x) => x.payment_id === p).map((x) => x.kind)).toEqual(['missing_commission'])
    expect(await one('select backfill_missing_commissions(1000) c')).toMatchObject({ c: expect.any(Number) })
    const [c] = await commissions(b)
    expect(c).toMatchObject({ payment_id: p, type: 'referral_bonus' })
    expect(Number(c.amount)).toBe(2000)
    expect((await reconcile()).filter((x) => x.payment_id === p)).toEqual([])
    expect((await one('select backfill_missing_commissions(1000) c')).c).toBe(0)
  })

  it('the backfill has no cap that starves newer payments: limit applies per run, oldest first, and repeated runs finish the job', async () => {
    const a = await agent()
    const bs = []
    for (let i = 0; i < 5; i++) {
      const b = await business(a); bs.push(b)
      await db.query("insert into plan_payments (business_id, months, naira_amount, reference, status, is_first_payment, created_at) values ($1,1,1000,$2,'success',true, now() - ($3 || ' days')::interval)", [b, ref('old'), String(10 - i)])
    }
    expect((await one('select backfill_missing_commissions(2) c')).c).toBe(2)
    expect((await one('select backfill_missing_commissions(2) c')).c).toBe(2)
    expect((await one('select backfill_missing_commissions(2) c')).c).toBe(1)
    for (const b of bs) expect(await commissions(b)).toHaveLength(1)
  })

  it('detects wrong type, wrong base, wrong agent, and first-payment integrity problems', async () => {
    // bypass the guards the way only a superuser could, to prove the reconciliation catches corruption
    const a = await agent(); const other = await agent(); const b = await business(a)
    const r1 = await renew(b, 5000)
    const r2 = await renew(b, 8000)
    await db.exec('alter table commissions disable trigger commissions_guard')
    try {
      await db.query("update commissions set type = 'residual' where payment_id = $1", [r1.payment_id])
      await db.query('update commissions set base_amount = 1, amount = 0.05 where payment_id = $1', [r2.payment_id])
    } finally { await db.exec('alter table commissions enable trigger commissions_guard') }
    await db.query('update businesses set referring_agent_id = $2 where id = $1', [b, other])
    const kinds = new Set((await reconcile()).filter((x) => x.business_id === b).map((x) => x.kind))
    expect(kinds.has('wrong_type')).toBe(true)
    expect(kinds.has('wrong_base')).toBe(true)
    expect(kinds.has('wrong_agent')).toBe(true)
  })

  it('does NOT flag a first payment whose created_at is later than a sibling (created_at is transaction start, "first" is lock order)', async () => {
    const a = await agent(); const b = await business(a)
    await renew(b, 5000)
    await renew(b, 5000)
    // make the flagged first payment look newer than the second, as happens when a transaction that started earlier waits on the lock
    await db.exec('alter table plan_payments disable trigger all')
    await db.query("update plan_payments set created_at = now() + interval '1 second' where business_id = $1 and is_first_payment", [b])
    await db.exec('alter table plan_payments enable trigger all')
    expect((await reconcile()).filter((x) => x.business_id === b)).toEqual([])
  })

  it('reports a payment paid by BOTH programs (tier agent_earnings and referral commissions)', async () => {
    const a = await agent(); const b = await business(a)
    const r = await renew(b, 5000)
    const reference = (await one('select reference from plan_payments where id = $1', [r.payment_id])).reference
    await db.query('insert into agent_earnings (agent_id, payment_reference) values ($1,$2)', [a, reference])
    expect((await reconcile()).filter((x) => x.payment_id === r.payment_id).map((x) => x.kind)).toEqual(['double_program'])
  })
})

describe('production safety', () => {
  it('exactly one renew_business_plan exists, with the production signature and ACL', async () => {
    const rows = await all("select proname, proacl::text acl from pg_proc where pronamespace = 'public'::regnamespace and proname = 'renew_business_plan'")
    expect(rows).toHaveLength(1)
    expect(rows[0].acl).not.toMatch(/anon|authenticated/)
  })
})
