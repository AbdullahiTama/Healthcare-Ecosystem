// @vitest-environment node
// Reviewer approval queue (policy B): queue visibility, approve / redirect /
// hold, idempotency, eligibility + validity re-checks, notifications and their
// failure isolation. Replays the real ADR migrations plus the route-guard and
// route-review migrations on PGlite.
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
  'carehub_20261114_adr_route_review',
]
let db
const R1 = '11111111-1111-4111-8111-111111111111'
const IMP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const IMP2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PHARM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ADMIN_BIZ = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const S_MGR = '12121212-1212-4121-8121-121212121212'
const S_CASH = '13131313-1313-4131-8131-131313131313'
const S_AUDIT = '14141414-1414-4141-8141-141414141414'
const S_ANALYST = '15151515-1515-4151-8151-151515151515'
const S_GONE = '16161616-1616-4161-8161-161616161616'

async function act({ sub = '', email = '' }, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', sub])
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.email', email])
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
  await db.query('set role authenticated')
  try { return await fn((s) => db.query(s).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const asReporter = { sub: R1, email: 'rep@example.com' }
const asAdmin = { sub: 'ffffffff-0000-4000-8000-000000000000', email: 'admin@x.com' }
const asImpManager = { sub: S_MGR, email: 'mgr@imp.com' }
const asPharm = { sub: 'abababab-abab-4aba-8aba-abababababab', email: 'p@c.com' }

// A public report the real submit RPC accepts, with one product + route.
async function submittedPublicCase({ kind = 'verified', businessId = IMP, candidate = null, manufacturer = null, key } = {}) {
  const rep = (await db.query(`insert into adr_reports (business_id,module_type,status,report_source,reporter_auth_user_id,
      reporter_name,reporter_qualification,reporter_phone,reporter_consent_followup,patient_identifier,patient_gender,patient_age)
    values (NULL,'public','draft','public','${R1}','Ada Okoro','consumer','08030000003',true,'AB-PATIENT','female',34)
    returning report_id`)).rows[0].report_id
  const prod = (await db.query(`insert into adr_report_products (report_id,product_brand_name,manufacturer)
    values ('${rep}','Ampiclox',${manufacturer ? `'${manufacturer}'` : 'NULL'}) returning product_id`)).rows[0].product_id
  await db.query(`insert into adr_report_reactions (report_id,reaction_description,severity,outcome,
      seriousness_death,seriousness_life_threatening,seriousness_hospitalization,seriousness_disability,
      seriousness_congenital_anomaly,seriousness_other_medically_important,seriousness_unknown)
    values ('${rep}','Rash','mild','recovered',false,false,false,false,false,false,'{}')`)
  const route = (await act(asReporter, (q) => q(
    `select create_adr_product_route('${rep}','${prod}','${kind}',${businessId ? `'${businessId}'` : 'NULL'},${candidate ? `'${candidate}'` : 'NULL'},'${key}') r`)))[0].r.route_id
  const out = (await act(asReporter, (q) => q(`select submit_adr_public_report('${rep}') r`)))[0].r
  expect(out.valid).toBe(true)
  return { rep, prod, route }
}
const review = (route, action, reason, biz = null, who = asAdmin) =>
  act(who, (q) => q(`select review_adr_product_route('${route}','${action}','${reason}',${biz ? `'${biz}'` : 'NULL'}) r`)).then((r) => r[0].r)
const notifCount = async (kind) =>
  (await db.query(`select count(*)::int c from staff_notifications where kind='${kind}'`)).rows[0].c
const eventCount = async (rep, type) =>
  (await db.query(`select count(*)::int c from adr_report_events where report_id='${rep}' and event_type='${type}'`)).rows[0].c

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
    ('${PHARM}','p@c.com','P','active','pharmacy','2','Corner Pharmacy','Lagos','Lagos',false),
    ('${ADMIN_BIZ}','admin@x.com','Admin','active','pharmacy','3','Admin','Lagos','Lagos',true)`)
  await db.query(`insert into public.staff (id,business_id,email,status,role,auth_user_id,full_name) values
    ('${S_MGR}','${IMP}','mgr@imp.com','active','Regional Manager','${S_MGR}','Regional Mgr'),
    ('${S_CASH}','${IMP}','cash@imp.com','active','Cashier','${S_CASH}','Cashier'),
    ('${S_AUDIT}','${IMP}','audit@imp.com','active','Auditor','${S_AUDIT}','Auditor'),
    ('${S_ANALYST}','${IMP}','an@imp.com','active','Analyst','${S_ANALYST}','Analyst'),
    ('${S_GONE}','${IMP}','gone@imp.com','inactive','Manager','${S_GONE}','Left')`)
  await db.query(`insert into public.roles (business_id,name,permissions) values
    ('${IMP}','Auditor','{"nav":["dashboard","reports"]}'),
    ('${IMP}','Analyst','{"nav":["dashboard","pv-tracker"]}')`)
}, 300000)
afterAll(async () => { await db?.close() })

describe('review queue', () => {
  it('lists submitted, validated, pending routes for reviewers only, and is empty for everyone else', async () => {
    const c = await submittedPublicCase({ key: 'q-1' })
    // an unsubmitted draft's route must not appear
    const draft = (await db.query(`insert into adr_reports (business_id,module_type,status,report_source,reporter_auth_user_id) values (NULL,'public','draft','public','${R1}') returning report_id`)).rows[0].report_id
    const dprod = (await db.query(`insert into adr_report_products (report_id,product_brand_name) values ('${draft}','Z') returning product_id`)).rows[0].product_id
    await act(asReporter, (q) => q(`select create_adr_product_route('${draft}','${dprod}','unknown',NULL,NULL,'q-draft') r`))

    const rows = await act(asAdmin, (q) => q(`select * from list_adr_route_review_queue('open')`))
    const mine = rows.find((r) => r.route_id === c.route)
    expect(mine).toBeTruthy()
    expect(mine.selection_kind).toBe('verified')
    expect(mine.selected_business_name).toBe('Acme Pharma Ltd')
    expect(mine.selected_business_eligible).toBe(true)
    expect(mine.match_evidence.basis).toMatch(/not independently verified/)
    expect(rows.some((r) => r.report_id === draft)).toBe(false)
    // no patient identifier anywhere in the queue payload
    expect(JSON.stringify(rows)).not.toMatch(/AB-PATIENT|Ada Okoro|08030000003/)

    for (const who of [asReporter, asImpManager, asPharm]) {
      const none = await act(who, (q) => q(`select * from list_adr_route_review_queue('all')`))
      expect(none).toHaveLength(0)
    }
  })

  it('distinguishes typed and unknown selections and only suggests, never routes', async () => {
    const typed = await submittedPublicCase({ kind: 'unverified_candidate', businessId: null, candidate: 'Acme Pharma', key: 'q-typed' })
    const unknown = await submittedPublicCase({ kind: 'unknown', businessId: null, manufacturer: 'Globex', key: 'q-unk' })
    const rows = await act(asAdmin, (q) => q(`select * from list_adr_route_review_queue('open')`))
    const t = rows.find((r) => r.route_id === typed.route)
    const u = rows.find((r) => r.route_id === unknown.route)
    expect(t.selection_kind).toBe('unverified_candidate')
    expect(t.candidate_name).toBe('Acme Pharma')
    expect(t.suggestions.map((s) => s.name)).toContain('Acme Pharma Ltd')
    expect(u.suggestions.map((s) => s.name)).toContain('Globex Labs')
    const status = (await db.query(`select status, responsible_business_id from adr_product_company_routes where route_id in ('${typed.route}','${unknown.route}')`)).rows
    expect(status.every((s) => s.status === 'pending' && s.responsible_business_id === null)).toBe(true)
  })
})

describe('approve', () => {
  it('routes a registered selection, audits it, shows it to that company only, and notifies only tracker users', async () => {
    const c = await submittedPublicCase({ key: 'a-1' })
    // before approval: the company sees nothing
    expect(await act(asImpManager, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(0)

    const out = await review(c.route, 'approve', 'Registered importer matches product label')
    expect(out.status).toBe('routed')
    expect(out.noop).toBe(false)

    const rt = (await db.query(`select status, responsible_business_id, reporter_selected_business_id, review_reason, reviewed_by from adr_product_company_routes where route_id='${c.route}'`)).rows[0]
    expect(rt.status).toBe('routed')
    expect(rt.reporter_selected_business_id).toBe(IMP)
    expect(rt.review_reason).toBe('Registered importer matches product label')

    expect(await act(asImpManager, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(1)
    expect(await act(asPharm, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(0)

    const ev = (await db.query(`select actor_type, metadata from adr_report_events where report_id='${c.rep}' and event_type='routing_routed'`)).rows
    expect(ev).toHaveLength(1)
    expect(ev[0].actor_type).toBe('platform_reviewer')
    expect(ev[0].metadata.reason).toBe('Registered importer matches product label')

    // owner row + Regional Manager (default perms) + Analyst (custom nav); not Cashier, Auditor, inactive staff
    const n = (await db.query(`select staff_id, is_owner, business_id, title, body, link from staff_notifications where kind='adr_case_routed' and link like '%${c.rep}'`)).rows
    expect(n).toHaveLength(3)
    expect(n.every((x) => x.business_id === IMP)).toBe(true)
    expect(n.map((x) => x.staff_id).sort()).toEqual([null, S_ANALYST, S_MGR].sort())
    for (const x of n) {
      expect(x.link).toBe(`/dashboard/reports/pv-tracker/${c.rep}`)
      expect(`${x.title} ${x.body}`).not.toMatch(/AB-PATIENT|Ada|0803|rash|female/i)
      expect(x.body).toMatch(/Ampiclox/)
    }
  })

  it('is idempotent: repeating approval creates no duplicate event, notification or route', async () => {
    const c = await submittedPublicCase({ key: 'a-2' })
    await review(c.route, 'approve', 'first approval')
    const before = { ev: await eventCount(c.rep, 'routing_routed'), n: await notifCount('adr_case_routed'),
      routes: (await db.query(`select count(*)::int c from adr_product_company_routes where report_id='${c.rep}'`)).rows[0].c }
    const again = await review(c.route, 'approve', 'first approval')
    expect(again.noop).toBe(true)
    expect(await eventCount(c.rep, 'routing_routed')).toBe(before.ev)
    expect(await notifCount('adr_case_routed')).toBe(before.n)
    expect((await db.query(`select count(*)::int c from adr_product_company_routes where report_id='${c.rep}'`)).rows[0].c).toBe(before.routes)
  })

  it('re-checks eligibility at decision time and refuses typed/unknown approvals', async () => {
    const c = await submittedPublicCase({ key: 'a-3' })
    await db.query(`update businesses set status='suspended' where id='${IMP}'`)
    await expect(review(c.route, 'approve', 'try anyway')).rejects.toThrow(/not an eligible/)
    await db.query(`update businesses set status='active' where id='${IMP}'`)

    const typed = await submittedPublicCase({ kind: 'unverified_candidate', businessId: null, candidate: 'Acme Pharma', key: 'a-3t' })
    await expect(review(typed.route, 'approve', 'looks right')).rejects.toThrow(/typed company name cannot be approved/)
    const unk = await submittedPublicCase({ kind: 'unknown', businessId: null, key: 'a-3u' })
    await expect(review(unk.route, 'approve', 'looks right')).rejects.toThrow(/no company was selected/)
  })

  it('requires a reason, requires a reviewer, and refuses unvalidated reports', async () => {
    const c = await submittedPublicCase({ key: 'a-4' })
    await expect(review(c.route, 'approve', '  ')).rejects.toThrow(/reason is required/)
    await expect(review(c.route, 'approve', 'fine', null, asReporter)).rejects.toThrow(/admin only/)
    await expect(review(c.route, 'approve', 'fine', null, asImpManager)).rejects.toThrow(/admin only/)
    await expect(review(c.route, 'delete', 'fine')).rejects.toThrow(/invalid review action/)

    const bad = await submittedPublicCase({ key: 'a-4b' })
    await db.query(`update adr_reports set gate_validated_at = NULL where report_id='${bad.rep}'`)
    await expect(review(bad.route, 'approve', 'fine')).rejects.toThrow(/not passed validation/)
  })
})

describe('redirect and hold', () => {
  it('resolves a typed company to a registered one without a second route and keeps provenance', async () => {
    const c = await submittedPublicCase({ kind: 'unverified_candidate', businessId: null, candidate: 'Globex', key: 'r-1' })
    await expect(review(c.route, 'redirect', 'matches registry', PHARM)).rejects.toThrow(/not an eligible/)
    await expect(review(c.route, 'redirect', 'matches registry', null)).rejects.toThrow(/company is required/)

    const out = await review(c.route, 'redirect', 'Globex Labs confirmed by phone', IMP2)
    expect(out.status).toBe('routed')
    const rows = (await db.query(`select status, selection_kind, responsible_business_id, reporter_selected_business_id, reporter_candidate_name, candidate_name from adr_product_company_routes where product_id='${c.prod}'`)).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'routed', selection_kind: 'verified', responsible_business_id: IMP2,
      reporter_selected_business_id: null, reporter_candidate_name: 'Globex', candidate_name: null })
    expect(await act({ sub: '17171717-1717-4171-8171-171717171717', email: 'i2@c.com' }, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(1)
    expect(await act(asImpManager, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(0)
    // repeating the same redirect is a no-op
    expect((await review(c.route, 'redirect', 'Globex Labs confirmed by phone', IMP2)).noop).toBe(true)
  })

  it('redirects a reporter-selected company to a different one and records both', async () => {
    const c = await submittedPublicCase({ key: 'r-2' })
    await review(c.route, 'redirect', 'label shows Globex as MAH', IMP2)
    const ev = (await db.query(`select metadata from adr_report_events where report_id='${c.rep}' and event_type='routing_routed'`)).rows[0].metadata
    expect(ev.responsible_business_id).toBe(IMP2)
    expect(ev.reporter_selected_business_id).toBe(IMP)
  })

  it('hold keeps the route pending and invisible, shows in the held view, and a later approval clears it', async () => {
    const c = await submittedPublicCase({ key: 'h-1' })
    const h = await review(c.route, 'hold', 'need to confirm licence')
    expect(h.status).toBe('pending')
    expect((await review(c.route, 'hold', 'need to confirm licence')).noop).toBe(true)
    expect(await eventCount(c.rep, 'routing_held')).toBe(1)
    expect(await act(asImpManager, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(0)
    const open = await act(asAdmin, (q) => q(`select route_id from list_adr_route_review_queue('open')`))
    const held = await act(asAdmin, (q) => q(`select route_id, held_reason from list_adr_route_review_queue('held')`))
    expect(open.some((r) => r.route_id === c.route)).toBe(false)
    expect(held.find((r) => r.route_id === c.route).held_reason).toBe('need to confirm licence')
    await review(c.route, 'approve', 'licence confirmed')
    const rt = (await db.query(`select status, held_at, held_reason from adr_product_company_routes where route_id='${c.route}'`)).rows[0]
    expect(rt).toEqual({ status: 'routed', held_at: null, held_reason: null })
  })
})

describe('notification failure isolation and retry', () => {
  it('a failing company notification never undoes the routing; it is logged, surfaced and retryable', async () => {
    const c = await submittedPublicCase({ key: 'n-1' })
    await db.query(`create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'simulated outage'; end $$`)
    await db.query(`create or replace function public.test_boom() returns trigger language plpgsql as $$ begin raise exception 'simulated outage'; end $$`)
    await db.query(`create trigger trg_test_boom before insert on staff_notifications for each row when (new.kind = 'adr_case_routed') execute function public.test_boom()`)

    const out = await review(c.route, 'approve', 'approve during outage')
    expect(out.status).toBe('routed')
    expect(out.notification.failed).toBeGreaterThan(0)
    expect((await db.query(`select status from adr_product_company_routes where route_id='${c.route}'`)).rows[0].status).toBe('routed')

    const failures = await act(asAdmin, (q) => q(`select route_id, error from list_adr_notification_failures()`))
    expect(failures.some((f) => f.route_id === c.route && /simulated outage/.test(f.error))).toBe(true)
    expect(await act(asImpManager, (q) => q(`select * from adr_notification_log`))).toHaveLength(0)

    await db.query('drop trigger trg_test_boom on staff_notifications')
    const retry = await act(asAdmin, (q) => q(`select retry_adr_route_notification('${c.route}') r`))
    expect(retry[0].r.notified).toBe(3)
    const after = await act(asAdmin, (q) => q(`select route_id from list_adr_notification_failures()`))
    expect(after.some((f) => f.route_id === c.route)).toBe(false)
    // retrying again sends nothing new
    expect((await act(asAdmin, (q) => q(`select retry_adr_route_notification('${c.route}') r`)))[0].r.notified).toBe(0)
    await expect(act(asImpManager, (q) => q(`select retry_adr_route_notification('${c.route}')`))).rejects.toThrow(/admin only/)
  })

  it('alerts reviewers when a public report is submitted, and an alert outage does not block submission', async () => {
    const before = await notifCount('adr_routing_review_needed')
    const c = await submittedPublicCase({ key: 'n-2' })
    const mine = (await db.query(`select business_id, is_owner, body, link from staff_notifications where kind='adr_routing_review_needed' and link = '/admin#adr-${c.rep}'`)).rows
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ business_id: ADMIN_BIZ, is_owner: true })
    expect(mine[0].body).not.toMatch(/AB-PATIENT|Ada|Ampiclox/)
    expect(await notifCount('adr_routing_review_needed')).toBe(before + 1)

    await db.query(`create or replace function public.test_boom() returns trigger language plpgsql as $$ begin raise exception 'alert outage'; end $$`)
    await db.query(`create trigger trg_test_boom2 before insert on staff_notifications for each row when (new.kind = 'adr_routing_review_needed') execute function public.test_boom()`)
    const c2 = await submittedPublicCase({ key: 'n-3' })
    expect((await db.query(`select status from adr_reports where report_id='${c2.rep}'`)).rows[0].status).toBe('submitted')
    await db.query('drop trigger trg_test_boom2 on staff_notifications')
  })
})

describe('route guard still holds against the new columns', () => {
  it('a reporter cannot write provenance, hold or review columns', async () => {
    const c = await submittedPublicCase({ key: 'g-1' })
    const draft = (await db.query(`insert into adr_reports (business_id,module_type,status,report_source,reporter_auth_user_id) values (NULL,'public','draft','public','${R1}') returning report_id`)).rows[0].report_id
    const prod = (await db.query(`insert into adr_report_products (report_id,product_brand_name) values ('${draft}','Y') returning product_id`)).rows[0].product_id
    const route = (await act(asReporter, (q) => q(`select create_adr_product_route('${draft}','${prod}','unknown',NULL,NULL,'g-2') r`)))[0].r.route_id
    for (const col of ["held_reason = 'x'", "review_reason = 'x'", `reporter_selected_business_id = '${IMP}'`, 'reviewed_at = now()']) {
      await expect(act(asReporter, (q) => q(`update adr_product_company_routes set ${col} where route_id='${route}'`)))
        .rejects.toThrow(/only through the routing functions/)
    }
    expect(c.route).toBeTruthy()
  })

  it('the helper and trigger functions are not callable as RPCs', async () => {
    const fns = ['adr_tracker_recipients(uuid)', 'adr_notify_route_routed(uuid)', 'adr_notify_reviewers_on_submit()', 'adr_route_stamp_provenance()', 'adr_guard_route_writes()']
    for (const f of fns) {
      const r = (await db.query(`select has_function_privilege('authenticated','public.${f}','EXECUTE') a, has_function_privilege('anon','public.${f}','EXECUTE') b`)).rows[0]
      expect(r, f).toEqual({ a: false, b: false })
    }
    const anon = (await db.query(`select has_function_privilege('anon','public.review_adr_product_route(uuid,text,text,uuid)','EXECUTE') a,
      has_function_privilege('anon','public.list_adr_route_review_queue(text)','EXECUTE') b`)).rows[0]
    expect(anon).toEqual({ a: false, b: false })
  })
})
