// @vitest-environment node
// carehub_20270130_adr_facility_company_routing: a healthcare facility's ADR report reaches the manufacturer / importer
// the facility selected. Replays the real ADR migrations (as autoRoute.db.test.js), then this migration, on PGlite.
// Before it, a facility's selection was accepted but every later step (auto-routing, reviewer queue, reviewer alert)
// was limited to public reports, and a changed selection on a facility draft was added next to the old one.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 300000 })
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const BEFORE = [
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
const MIGRATION = 'carehub_20270130_adr_facility_company_routing'

const R1 = '11111111-1111-4111-8111-111111111111' // public reporter
const FAC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' // reporting pharmacy
const MGR_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' // its manager (submitter chain)
const OUTSIDER = '22222222-2222-4222-8222-222222222222'
const IMP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' // eligible importer
const IMP2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' // second eligible importer
const IMP_MGR = '12121212-1212-4121-8121-121212121212'
const IMP2_MGR = '13131313-1313-4131-8131-131313131313'
const PHARM2 = '99999999-9999-4999-8999-999999999999' // a pharmacy: not a selectable company
const ADMIN_BIZ = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

const asFacility = { sub: MGR_A, email: 'mgr@a.com' }
const asImpManager = { sub: IMP_MGR, email: 'imgr@co.com' }
const asImp2Manager = { sub: IMP2_MGR, email: 'i2mgr@co.com' }
const asAdmin = { sub: 'ffffffff-0000-4000-8000-000000000000', email: 'admin@x.com' }
const asOutsider = { sub: OUTSIDER, email: 'x@nowhere.com' }

let db
async function act({ sub = '', email = '' }, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', sub])
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.email', email])
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
  await db.query('set role authenticated')
  try { return await fn((s) => db.query(s).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const one = async (sql) => (await db.query(sql)).rows[0]
const count = async (sql) => (await one(sql)).c
const notif = (kind, link) => count(`select count(*)::int c from staff_notifications where kind='${kind}' and link like '%${link}%'`)
const routesOf = async (rep) => (await db.query(`select * from adr_product_company_routes where report_id='${rep}' order by created_at`)).rows
const routeCall = (rep, prod, kind, biz, cand, key) =>
  `select create_adr_product_route('${rep}','${prod}','${kind}',${biz ? `'${biz}'` : 'NULL'},${cand ? `'${cand}'` : 'NULL'},${key ? `'${key}'` : 'NULL'}) r`

// A facility draft (CareHub ADR form) with one product and one reaction, ready for submit_adr_report.
async function facilityDraft(source = 'business_facility') {
  const rep = (await one(`insert into adr_reports (business_id, module_type, status, report_source, created_by_user_id,
      reporter_name, reporter_qualification, reporter_phone, reporter_consent_followup, patient_identifier, patient_gender, patient_age)
    values ('${FAC}', 'community_pharmacy', 'draft', '${source}', '${MGR_A}',
      'Pharm A', 'pharmacist', '08010000001', true, 'CD-PATIENT', 'male', 45) returning report_id`)).report_id
  const prod = (await one(`insert into adr_report_products (report_id, product_brand_name, batch_lot_number) values ('${rep}', 'Ampiclox', 'B123') returning product_id`)).product_id
  await db.query(`insert into adr_report_reactions (report_id,reaction_description,severity,outcome,
      seriousness_death,seriousness_life_threatening,seriousness_hospitalization,seriousness_disability,
      seriousness_congenital_anomaly,seriousness_other_medically_important,seriousness_unknown)
    values ('${rep}','Rash','mild','recovered',false,false,false,false,false,false,'{}')`)
  return { rep, prod }
}
const select = (c, kind, biz = null, cand = null, key = null) => act(asFacility, (q) => q(routeCall(c.rep, c.prod, kind, biz, cand, key)))
async function submitFacility(rep) {
  const out = (await act(asFacility, (q) => q(`select submit_adr_report('${rep}') r`)))[0].r
  expect(out, JSON.stringify(out)).toMatchObject({ valid: true })
}

async function boot(withMigration) {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`)
  await db.exec(read('./fixtures/adrTestSchema.sql'))
  for (const m of BEFORE) await db.exec(M(m))
  if (withMigration) await db.exec(M(MIGRATION))
  await db.query(`insert into auth.users (id) values ('${R1}'), ('${MGR_A}'), ('${IMP_MGR}'), ('${IMP2_MGR}'), ('${OUTSIDER}')`)
  await db.query(`insert into public.businesses (id,email,owner,status,business_type,phone,name,city,state,is_platform_admin) values
    ('${FAC}','owner@a.com','Owner A','active','pharmacy','08010000001','Pharmacy A','Lagos','Lagos',false),
    ('${IMP}','imp@co.com','Importer','active','manufacturer_importer','2','Acme Pharma Ltd','Lagos','Lagos',false),
    ('${IMP2}','imp2@co.com','Importer Two','active','manufacturer_importer','3','Globex Labs','Abuja','FCT',false),
    ('${PHARM2}','p2@b.com','Pharm Two','active','pharmacy','5','Pharmacy Two','Lagos','Lagos',false),
    ('${ADMIN_BIZ}','admin@x.com','Admin','active','pharmacy','4','Admin','Lagos','Lagos',true)`)
  await db.query(`insert into public.staff (id,business_id,email,status,role,auth_user_id,full_name) values
    ('${MGR_A}','${FAC}','mgr@a.com','active','Manager','${MGR_A}','Manager A'),
    ('${IMP_MGR}','${IMP}','imgr@co.com','active','Regional Manager','${IMP_MGR}','Importer Manager'),
    ('${IMP2_MGR}','${IMP2}','i2mgr@co.com','active','Regional Manager','${IMP2_MGR}','Importer Two Manager')`)
}

describe('before the migration (the defect)', () => {
  beforeAll(async () => { await boot(false) }, 300000)
  afterAll(async () => { await db?.close() })

  it('a facility selection was accepted but never reached the company after submission', async () => {
    const c = await facilityDraft()
    await select(c, 'verified', IMP)
    await submitFacility(c.rep)
    const [route] = await routesOf(c.rep)
    expect(route.status).toBe('pending')
    expect(await act(asImpManager, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(0)
    expect(await act(asAdmin, (q) => q(`select route_id from list_adr_route_review_queue('all')`))).toHaveLength(0)
  })
})

describe('facility reports are routed to the selected company', () => {
  beforeAll(async () => { await boot(true) }, 300000)
  afterAll(async () => { await db?.close() })

  it('the facility can search the registered manufacturers / importers (and only those)', async () => {
    const rows = await act(asFacility, (q) => q(`select business_id, business_name from search_eligible_product_companies('', 50)`))
    expect(rows.map((r) => r.business_name).sort()).toEqual(['Acme Pharma Ltd', 'Globex Labs'])
  })

  it('a registered selection is routed at submission: the company sees the case masked and is alerted', async () => {
    const c = await facilityDraft()
    await select(c, 'verified', IMP)
    expect((await routesOf(c.rep))[0].status).toBe('pending')
    await submitFacility(c.rep)

    const [route] = await routesOf(c.rep)
    expect(route).toMatchObject({ status: 'routed', responsible_business_id: IMP, reporter_selected_business_id: IMP })
    const ev = (await db.query(`select actor_type, metadata from adr_report_events where report_id='${c.rep}' and event_type='routing_routed'`)).rows
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ actor_type: 'system', metadata: { auto: true, responsible_business_id: IMP } })

    const seen = await act(asImpManager, (q) => q(`select report_id, reporter_name, reporter_facility_name, reporter_phone, patient_age from adr_pv_case_view where report_id='${c.rep}'`))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ reporter_name: null, reporter_facility_name: null, reporter_phone: null, patient_age: 45 })
    expect(await act(asImpManager, (q) => q(`select product_brand_name from adr_report_products where report_id='${c.rep}'`))).toEqual([{ product_brand_name: 'Ampiclox' }])
    // Another company sees nothing.
    expect(await act(asImp2Manager, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(0)

    expect(await notif('adr_case_routed', c.rep)).toBeGreaterThan(0)
    const body = (await one(`select body from staff_notifications where kind='adr_case_routed' and link like '%${c.rep}%' limit 1`)).body
    expect(body).not.toMatch(/CD-PATIENT|Pharm A|08010000001/)
    expect(await notif('adr_routing_review_needed', c.rep)).toBe(0)
  })

  it('a health-facility report is routed the same way', async () => {
    const c = await facilityDraft('health_facility')
    await select(c, 'verified', IMP2)
    await submitFacility(c.rep)
    expect((await routesOf(c.rep))[0].status).toBe('routed')
    expect(await act(asImp2Manager, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(1)
  })

  it('changing the company on a draft replaces the earlier selection, so only the final company receives the case', async () => {
    const c = await facilityDraft()
    await select(c, 'verified', IMP)
    await select(c, 'verified', IMP2)
    const routes = await routesOf(c.rep)
    expect(routes).toHaveLength(1)
    expect(routes[0].responsible_business_id).toBe(IMP2)
    const created = (await db.query(`select metadata from adr_report_events where report_id='${c.rep}' and event_type='routing_created' order by created_at`)).rows
    expect(created).toHaveLength(2)
    expect(created[1].metadata).toMatchObject({ selection_kind: 'verified', replaced_selection_kind: 'verified' })

    await submitFacility(c.rep)
    expect(await act(asImp2Manager, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(1)
    expect(await act(asImpManager, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(0)
  })

  it('switching to "I don\'t know" removes the company before submission', async () => {
    const c = await facilityDraft()
    await select(c, 'verified', IMP)
    await select(c, 'unknown')
    const routes = await routesOf(c.rep)
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ selection_kind: 'unknown', responsible_business_id: null })
  })

  it('typed names and "I don\'t know" go to the reviewer queue, and reviewers are alerted', async () => {
    const typed = await facilityDraft()
    await select(typed, 'unverified_candidate', null, 'Acme Pharma')
    const unknown = await facilityDraft()
    await select(unknown, 'unknown')
    await submitFacility(typed.rep)
    await submitFacility(unknown.rep)
    const queue = await act(asAdmin, (q) => q(`select report_id, selection_kind, suggestions from list_adr_route_review_queue('open')`))
    for (const c of [typed, unknown]) {
      expect((await routesOf(c.rep))[0].status).toBe('pending')
      expect(queue.some((r) => r.report_id === c.rep)).toBe(true)
      expect(await notif('adr_routing_review_needed', c.rep)).toBe(1)
    }
    // The reviewer is offered the registered match for the typed name.
    expect(queue.find((r) => r.report_id === typed.rep).suggestions.map((s) => s.name)).toEqual(['Acme Pharma Ltd'])
  })

  it('a reviewer can route a facility case that was left for review', async () => {
    const c = await facilityDraft()
    await select(c, 'unverified_candidate', null, 'Globex')
    await submitFacility(c.rep)
    const [route] = await routesOf(c.rep)
    await act(asAdmin, (q) => q(`select review_adr_product_route('${route.route_id}', 'redirect', 'Registered as Globex Labs', '${IMP2}') r`))
    expect((await routesOf(c.rep))[0]).toMatchObject({ status: 'routed', responsible_business_id: IMP2 })
    expect(await act(asImp2Manager, (q) => q(`select report_id from adr_pv_case_view where report_id='${c.rep}'`))).toHaveLength(1)
  })

  it('a company that stopped being eligible is not routed; the selection waits for a reviewer', async () => {
    const c = await facilityDraft()
    await select(c, 'verified', IMP2)
    await db.query(`update businesses set status='suspended' where id='${IMP2}'`)
    try {
      await submitFacility(c.rep)
      expect((await routesOf(c.rep))[0].status).toBe('pending')
      expect(await notif('adr_routing_review_needed', c.rep)).toBe(1)
    } finally { await db.query(`update businesses set status='active' where id='${IMP2}'`) }
  })

  it('refuses a business that is not a manufacturer / importer, and an outsider\'s selection', async () => {
    const c = await facilityDraft()
    await expect(select(c, 'verified', PHARM2)).rejects.toThrow(/not an eligible active Importer\/Manufacturer/)
    await expect(act(asOutsider, (q) => q(routeCall(c.rep, c.prod, 'verified', IMP, null, null)))).rejects.toThrow(/not accessible/)
    expect(await routesOf(c.rep)).toHaveLength(0)
  })

  it('the facility still cannot write routing state directly', async () => {
    const c = await facilityDraft()
    await select(c, 'verified', IMP)
    const [route] = await routesOf(c.rep)
    await expect(act(asFacility, (q) => q(`update adr_product_company_routes set status='routed' where route_id='${route.route_id}'`)))
      .rejects.toThrow(/route columns|routing functions/i)
  })

  it('once submitted, a selection is never replaced (a later call adds, as before)', async () => {
    const c = await facilityDraft()
    await select(c, 'verified', IMP)
    await submitFacility(c.rep)
    await act(asFacility, (q) => q(routeCall(c.rep, c.prod, 'verified', IMP2, null, null))).catch(() => null)
    const routes = await routesOf(c.rep)
    expect(routes[0]).toMatchObject({ responsible_business_id: IMP, status: 'routed' })
  })

  it('unclassified reports (source unknown) are still not routed automatically', async () => {
    const c = await facilityDraft()
    await select(c, 'verified', IMP)
    await db.query(`update adr_reports set report_source='unknown' where report_id='${c.rep}'`).catch(() => null)
    const src = (await one(`select report_source from adr_reports where report_id='${c.rep}'`)).report_source
    if (src === 'unknown') {
      await submitFacility(c.rep)
      expect((await routesOf(c.rep))[0].status).toBe('pending')
    } else {
      // The source lock refuses reclassification; then check the helper directly.
      const out = (await one(`select adr_auto_route_report('${c.rep}') r`)).r
      expect(out).toMatchObject({ skipped: true })
    }
  })

  it('public reports behave exactly as before (routed when a registered company is picked)', async () => {
    const rep = (await one(`insert into adr_reports (business_id,module_type,status,report_source,reporter_auth_user_id,
        reporter_name,reporter_qualification,reporter_phone,reporter_consent_followup,patient_identifier,patient_gender,patient_age)
      values (NULL,'public','draft','public','${R1}','Ada','consumer','08030000003',true,'AB','female',34) returning report_id`)).report_id
    const prod = (await one(`insert into adr_report_products (report_id,product_brand_name) values ('${rep}','Ampiclox') returning product_id`)).product_id
    await db.query(`insert into adr_report_reactions (report_id,reaction_description,severity,outcome,seriousness_death,seriousness_life_threatening,
      seriousness_hospitalization,seriousness_disability,seriousness_congenital_anomaly,seriousness_other_medically_important,seriousness_unknown)
      values ('${rep}','Rash','mild','recovered',false,false,false,false,false,false,'{}')`)
    const asReporter = { sub: R1, email: 'rep@example.com' }
    await act(asReporter, (q) => q(routeCall(rep, prod, 'verified', IMP, null, 'pub-1')))
    await act(asReporter, (q) => q(routeCall(rep, prod, 'verified', IMP2, null, 'pub-2')))
    expect(await routesOf(rep)).toHaveLength(1)
    const out = (await act(asReporter, (q) => q(`select submit_adr_public_report('${rep}') r`)))[0].r
    expect(out.valid).toBe(true)
    expect((await routesOf(rep))[0]).toMatchObject({ status: 'routed', responsible_business_id: IMP2 })
  })

  it('internal routing functions stay closed to API roles; grants unchanged', async () => {
    const g = await one(`select
      has_function_privilege('authenticated','adr_auto_route_report(uuid)','execute') a,
      has_function_privilege('anon','create_adr_product_route(uuid,uuid,text,uuid,text,text)','execute') b,
      has_function_privilege('authenticated','create_adr_product_route(uuid,uuid,text,uuid,text,text)','execute') c,
      has_function_privilege('anon','list_adr_route_review_queue(text)','execute') d`)
    expect(g).toEqual({ a: false, b: false, c: true, d: false })
  })
})
