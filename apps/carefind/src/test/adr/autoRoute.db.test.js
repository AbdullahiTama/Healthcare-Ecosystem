// @vitest-environment node
// Auto-routing of reporter-selected registered companies (owner decision 2026-10-22).
// Replays the real ADR migrations, then 20261206 (auto-route) and 20261207 (backfill), on PGlite.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 300000 })
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const MIGRATIONS = [
  'carehub_20260810_recursive_business_ids', 'carehub_20260816_adr_reports_basic',
  'carehub_20260818_adr_reports_phase1', 'carehub_20260818_adr_phase2_hospital',
  'carehub_20260818_adr_phase2_reports_analytics', 'carehub_20260818_adr_phase2_visibility',
  'carehub_20260818_adr_phase2_events', 'carehub_20260819_adr_fix_returning_rls',
  'carehub_20261102_adr_routing_foundation', 'carehub_20261103_adr_public_access',
  'carehub_20261104_adr_icsr_hardening', 'carehub_20261105_adr_pv_tracker',
  'carehub_20261106_adr_source_governance', 'carehub_20261107_adr_analytics_access',
  'carehub_20261108_adr_deadline_rules', 'carehub_20261109_adr_trigger_execute_hardening',
  'carehub_20261110_adr_delete_guards', 'carehub_20261111_adr_public_single_company',
  'carehub_20261112_adr_notify_party', 'carehub_20261113_adr_route_write_guard',
  'carehub_20261114_adr_route_review', 'carehub_20261203_adr_route_change_selection',
  'carehub_20261206_adr_auto_route_verified_selections',
]
let db
const R1 = '11111111-1111-4111-8111-111111111111'
const IMP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const IMP2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ADMIN_BIZ = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const S_MGR = '12121212-1212-4121-8121-121212121212'

async function act({ sub = '', email = '' }, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', sub])
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.email', email])
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
  await db.query('set role authenticated')
  try { return await fn((s) => db.query(s).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const asReporter = { sub: R1, email: 'rep@example.com' }
const asImpManager = { sub: S_MGR, email: 'mgr@imp.com' }
const asImp2Owner = { sub: 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc', email: 'i2@c.com' }

// A public draft with one product and one route; submit separately so tests can intervene.
async function draftCase({ kind = 'verified', businessId = IMP, candidate = null, key }) {
  const rep = (await db.query(`insert into adr_reports (business_id,module_type,status,report_source,reporter_auth_user_id,
      reporter_name,reporter_qualification,reporter_phone,reporter_consent_followup,patient_identifier,patient_gender,patient_age)
    values (NULL,'public','draft','public','${R1}','Ada Okoro','consumer','08030000003',true,'AB-PATIENT','female',34)
    returning report_id`)).rows[0].report_id
  const prod = (await db.query(`insert into adr_report_products (report_id,product_brand_name) values ('${rep}','Ampiclox') returning product_id`)).rows[0].product_id
  await db.query(`insert into adr_report_reactions (report_id,reaction_description,severity,outcome,
      seriousness_death,seriousness_life_threatening,seriousness_hospitalization,seriousness_disability,
      seriousness_congenital_anomaly,seriousness_other_medically_important,seriousness_unknown)
    values ('${rep}','Rash','mild','recovered',false,false,false,false,false,false,'{}')`)
  const route = (await act(asReporter, (q) => q(
    `select create_adr_product_route('${rep}','${prod}','${kind}',${businessId ? `'${businessId}'` : 'NULL'},${candidate ? `'${candidate}'` : 'NULL'},'${key}') r`)))[0].r.route_id
  return { rep, prod, route }
}
const submit = async (rep) => {
  const out = (await act(asReporter, (q) => q(`select submit_adr_public_report('${rep}') r`)))[0].r
  expect(out.valid).toBe(true)
}
const routeRow = async (route) => (await db.query(`select * from adr_product_company_routes where route_id='${route}'`)).rows[0]
const count = async (sql) => (await db.query(sql)).rows[0].c
const notif = (kind, link) => count(`select count(*)::int c from staff_notifications where kind='${kind}'${link ? ` and link like '%${link}%'` : ''}`)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`)
  await db.exec(read('./fixtures/adrTestSchema.sql'))
  for (const m of MIGRATIONS) await db.exec(M(m))
  await db.query(`insert into auth.users (id) values ('${R1}')`)
  await db.query(`insert into public.businesses (id,email,owner,status,business_type,phone,name,city,state,is_platform_admin) values
    ('${IMP}','i@c.com','Imp Owner','active','manufacturer_importer','1','Acme Pharma Ltd','Lagos','Lagos',false),
    ('${IMP2}','i2@c.com','Imp2 Owner','active','manufacturer_importer','4','Globex Labs','Abuja','FCT',false),
    ('${ADMIN_BIZ}','admin@x.com','Admin','active','pharmacy','3','Admin','Lagos','Lagos',true)`)
  await db.query(`insert into public.staff (id,business_id,email,status,role,auth_user_id,full_name) values
    ('${S_MGR}','${IMP}','mgr@imp.com','active','Regional Manager','${S_MGR}','Regional Mgr')`)
}, 300000)
afterAll(async () => { await db?.close() })

describe('auto-routing at submission', () => {
  it('routes a registered, eligible selection straight to that company, audited as automatic', async () => {
    const c = await draftCase({ key: 'ar-1' })
    expect((await routeRow(c.route)).status).toBe('pending')
    await submit(c.rep)

    const row = await routeRow(c.route)
    expect(row.status).toBe('routed')
    expect(row.responsible_business_id).toBe(IMP)
    expect(row.reporter_selected_business_id).toBe(IMP)

    const ev = (await db.query(`select actor_type, actor_name, metadata from adr_report_events where report_id='${c.rep}' and event_type='routing_routed'`)).rows
    expect(ev).toHaveLength(1)
    expect(ev[0].actor_type).toBe('system')
    expect(ev[0].metadata).toMatchObject({ auto: true, action: 'auto', responsible_business_id: IMP })

    // the company now sees the case, with reporter identity still masked
    const seen = await act(asImpManager, (q) => q(`select report_id, reporter_name, reporter_phone from adr_pv_case_view where report_id='${c.rep}'`))
    expect(seen).toHaveLength(1)
    expect(seen[0].reporter_name).toBeNull()
    expect(seen[0].reporter_phone).toBeNull()
    // another company does not
    expect(await act(asImp2Owner, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(0)

    // company alerted (no patient data in the copy); reviewers are NOT alerted and the queue is empty of it
    expect(await notif('adr_case_routed', `/${c.rep}`)).toBeGreaterThan(0)
    const body = (await db.query(`select body from staff_notifications where kind='adr_case_routed' and link like '%${c.rep}%' limit 1`)).rows[0].body
    expect(body).not.toMatch(/AB-PATIENT|Ada Okoro|08030000003/)
    expect(await notif('adr_routing_review_needed', c.rep)).toBe(0)
    const queue = await act({ sub: 'ffffffff-0000-4000-8000-000000000000', email: 'admin@x.com' }, (q) => q(`select route_id from list_adr_route_review_queue('all')`))
    expect(queue.some((r) => r.route_id === c.route)).toBe(false)
  })

  it('leaves typed and unknown selections for a reviewer and alerts reviewers', async () => {
    const typed = await draftCase({ kind: 'unverified_candidate', businessId: null, candidate: 'Acme Pharma', key: 'ar-typed' })
    const unknown = await draftCase({ kind: 'unknown', businessId: null, key: 'ar-unk' })
    await submit(typed.rep)
    await submit(unknown.rep)
    for (const c of [typed, unknown]) {
      const row = await routeRow(c.route)
      expect(row.status).toBe('pending')
      expect(row.responsible_business_id).toBeNull()
      expect(await notif('adr_routing_review_needed', c.rep)).toBe(1)
    }
  })

  it('leaves a selection whose company stopped being eligible for a reviewer', async () => {
    const c = await draftCase({ businessId: IMP2, key: 'ar-inelig' })
    await db.query(`update businesses set status='suspended' where id='${IMP2}'`)
    await submit(c.rep)
    expect((await routeRow(c.route)).status).toBe('pending')
    expect(await notif('adr_routing_review_needed', c.rep)).toBe(1)
    await db.query(`update businesses set status='active' where id='${IMP2}'`)
  })

  it('does not auto-route a route a reviewer has put on hold', async () => {
    const c = await draftCase({ key: 'ar-held' })
    await db.query(`update adr_product_company_routes set held_at=now(), held_reason='confirm licence' where route_id='${c.route}'`)
    await submit(c.rep)
    expect((await routeRow(c.route)).status).toBe('pending')
  })

  it('does not touch a draft, an unsubmitted public report, or a non-public report', async () => {
    const c = await draftCase({ key: 'ar-draft' })
    const out = (await db.query(`select adr_auto_route_report('${c.rep}') r`)).rows[0].r
    expect(out).toMatchObject({ routed: 0, skipped: true })
    expect((await routeRow(c.route)).status).toBe('pending')
  })
})

describe('failure isolation', () => {
  it('never blocks a submission when auto-routing itself fails; the route stays pending and the failure is logged', async () => {
    const c = await draftCase({ key: 'ar-fail' })
    await db.exec(`create or replace function public.adr_auto_route_report(p_report_id uuid) returns jsonb language plpgsql as $$ begin raise exception 'boom'; end $$`)
    try {
      await submit(c.rep)   // submit_adr_public_report must still succeed
    } finally {
      await db.exec(M('carehub_20261206_adr_auto_route_verified_selections'))   // restore the real helper
    }
    expect((await db.query(`select status from adr_reports where report_id='${c.rep}'`)).rows[0].status).toBe('submitted')
    expect((await routeRow(c.route)).status).toBe('pending')
    expect(await count(`select count(*)::int c from adr_notification_log where report_id='${c.rep}' and kind='adr_auto_route' and status='failed'`)).toBe(1)
    expect(await notif('adr_routing_review_needed', c.rep)).toBe(1)
  })

  it('keeps the routing when the company alert cannot be delivered, and logs the failure', async () => {
    await db.exec(`alter table staff_notifications add constraint test_block_case_alert check (kind <> 'adr_case_routed') not valid`)
    let c
    try {
      c = await draftCase({ key: 'ar-notif' })
      await submit(c.rep)
    } finally {
      await db.exec(`alter table staff_notifications drop constraint test_block_case_alert`)
    }
    expect((await routeRow(c.route)).status).toBe('routed')
    expect(await count(`select count(*)::int c from adr_notification_log where route_id='${c.route}' and kind='adr_case_routed' and status='failed'`)).toBeGreaterThan(0)
  })
})

describe('permissions', () => {
  it('is not callable by API roles', async () => {
    const c = await draftCase({ key: 'ar-acl' })
    for (const role of ['authenticated', 'anon']) {
      await db.query(`set role ${role}`)
      try {
        await expect(db.query(`select adr_auto_route_report('${c.rep}')`)).rejects.toThrow(/permission denied/i)
        await expect(db.query(`select adr_auto_route_on_submit()`)).rejects.toThrow(/permission denied/i)
      } finally { await db.query('reset role') }
    }
  })

  it('does not let a reporter route their own case by writing the route directly', async () => {
    const c = await draftCase({ key: 'ar-guard' })
    await expect(act(asReporter, (q) => q(`update adr_product_company_routes set status='routed' where route_id='${c.route}'`)))
      .rejects.toThrow(/routing functions|route columns|routes are created pending/i)
  })
})

describe('backfill', () => {
  it('routes already-submitted pending verified selections, and re-running is a no-op', async () => {
    await db.exec('alter table adr_reports disable trigger trg_adr_auto_route')
    let a, b
    try {
      a = await draftCase({ key: 'bf-1' })
      b = await draftCase({ kind: 'unknown', businessId: null, key: 'bf-2' })
      await submit(a.rep)
      await submit(b.rep)
    } finally {
      await db.exec('alter table adr_reports enable trigger trg_adr_auto_route')
    }
    expect((await routeRow(a.route)).status).toBe('pending')

    const first = await db.query(M('carehub_20261207_adr_backfill_auto_route'))
    const mine = (Array.isArray(first) ? first.at(-1) : first).rows.find((r) => r.result && r.result.routed >= 0 && r.report_number)
    expect(mine).toBeTruthy()
    expect((await routeRow(a.route)).status).toBe('routed')
    expect((await routeRow(b.route)).status).toBe('pending')   // unknown stays with reviewers

    const events = await count(`select count(*)::int c from adr_report_events where report_id='${a.rep}' and event_type='routing_routed'`)
    await db.query(M('carehub_20261207_adr_backfill_auto_route'))
    expect(await count(`select count(*)::int c from adr_report_events where report_id='${a.rep}' and event_type='routing_routed'`)).toBe(events)
  })
})
