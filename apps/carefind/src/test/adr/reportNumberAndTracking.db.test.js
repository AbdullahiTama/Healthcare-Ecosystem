// @vitest-environment node
// A submitted report needs a UNIQUE ADR number the reporter can track it by.
// Replays the real ADR migrations, reproduces the duplicate numbers with the
// shipped generator, applies the migration, then proves uniqueness (including
// under concurrency), the renumbering, and the privacy/rate-limit rules of the
// tracking lookup.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 90000, hookTimeout: 300000 })
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const FIX = read('../../../../../docs/architecture/pending-migrations/carehub_20261204_adr_report_number_and_tracking.sql')
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
const R2 = '22222222-2222-4222-8222-222222222222'
const R3 = '33333333-3333-4333-8333-333333333333'
const IMP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ADMIN_BIZ = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

async function act({ sub = '', email = '' }, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', sub])
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.email', email])
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
  await db.query('set role authenticated')
  try { return await fn((s) => db.query(s).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const as = (sub) => ({ sub, email: sub.slice(0, 4) + '@example.com' })

async function publicReport(owner, { email = null, phone = null, submit = true, createdAt = null } = {}) {
  const rep = (await db.query(`insert into adr_reports (business_id,module_type,status,report_source,reporter_auth_user_id,
      reporter_name,reporter_qualification,reporter_phone,reporter_email,reporter_consent_followup,patient_identifier,patient_gender,patient_age
      ${createdAt ? ',created_at' : ''})
    values (NULL,'public','draft','public','${owner}','Ada Okoro','consumer',${phone ? `'${phone}'` : "'08030000003'"},${email ? `'${email}'` : 'NULL'},true,'AB-PATIENT','female',34
      ${createdAt ? `,'${createdAt}'` : ''}) returning report_id, report_number`)).rows[0]
  const prod = (await db.query(`insert into adr_report_products (report_id,product_brand_name) values ('${rep.report_id}','Ampiclox') returning product_id`)).rows[0].product_id
  await db.query(`insert into adr_report_reactions (report_id,reaction_description,severity,outcome,
      seriousness_death,seriousness_life_threatening,seriousness_hospitalization,seriousness_disability,
      seriousness_congenital_anomaly,seriousness_other_medically_important,seriousness_unknown)
    values ('${rep.report_id}','Rash','mild','recovered',false,false,false,false,false,false,'{}')`)
  const route = (await act(as(owner), (q) => q(`select create_adr_product_route('${rep.report_id}','${prod}','verified','${IMP}',NULL,'rn-${rep.report_id}') r`)))[0].r.route_id
  if (submit) {
    const out = (await act(as(owner), (q) => q(`select submit_adr_public_report('${rep.report_id}') r`)))[0].r
    expect(out.valid, JSON.stringify(out)).toBe(true)
  }
  return { id: rep.report_id, prod, route, number: (await db.query(`select report_number from adr_reports where report_id='${rep.report_id}'`)).rows[0].report_number }
}
const track = (who, num, contact = null) => act(who, (q) => q(`select track_adr_report('${num}', ${contact ? `'${contact}'` : 'NULL'}) r`)).then((r) => r[0].r)

let legacy
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`)
  await db.exec(read('./fixtures/adrTestSchema.sql'))
  for (const m of MIGRATIONS) await db.exec(M(m))
  await db.query(`insert into auth.users (id) values ('${R1}'), ('${R2}'), ('${R3}')`)
  await db.query(`insert into public.businesses (id,email,owner,status,business_type,phone,name,city,state,is_platform_admin) values
    ('${IMP}','i@c.com','Imp Owner','active','manufacturer_importer','1','Acme Pharma Ltd','Lagos','Lagos',false),
    ('${ADMIN_BIZ}','admin@x.com','Admin','active','pharmacy','3','Admin','Lagos','Lagos',true)`)
  // three public reports made before the fix, in a known order
  legacy = [
    await publicReport(R1, { email: 'ada@example.com', phone: '0803 000 0003', createdAt: '2026-01-05 10:00+00' }),
    await publicReport(R2, { createdAt: '2026-01-06 10:00+00' }),
    await publicReport(R1, { submit: false, createdAt: '2026-01-07 10:00+00' }),
  ]
}, 300000)
afterAll(async () => { await db?.close() })

describe('the bug, on the generator as shipped', () => {
  it('every public report gets the same number', () => {
    expect(new Set(legacy.map((l) => l.number)).size).toBe(1)
  })
})

describe('after the migration', () => {
  beforeAll(async () => { await db.exec(FIX) })

  it('existing reports are renumbered once, uniquely, in creation order', async () => {
    const rows = (await db.query(`select report_number from adr_reports order by created_at, report_id`)).rows.map((r) => r.report_number)
    expect(new Set(rows).size).toBe(rows.length)
    expect(rows).toEqual(rows.map((_, i) => `ADR-2026-${String(i + 1).padStart(6, '0')}`))
  })

  it('re-running the migration does not renumber anything', async () => {
    const before = (await db.query(`select report_id, report_number from adr_reports order by report_id`)).rows
    await db.exec(FIX)
    const after = (await db.query(`select report_id, report_number from adr_reports order by report_id`)).rows
    expect(after).toEqual(before)
  })

  it('new public reports get the next number; the counter never repeats', async () => {
    const a = await publicReport(R3, { submit: false })
    const b = await publicReport(R3, { submit: false })
    expect(a.number).toMatch(/^ADR-\d{4}-\d{6}$/)
    expect(Number(b.number.slice(-6))).toBe(Number(a.number.slice(-6)) + 1)
  })

  it('concurrent inserts never share a number', async () => {
    await Promise.all(Array.from({ length: 12 }, () => db.query(
      `insert into adr_reports (business_id,module_type,status,report_source) values (NULL,'public','draft','public')`)))
    const dup = (await db.query(`select report_number from adr_reports group by 1 having count(*)>1`)).rows
    expect(dup).toEqual([])
  })

  it('the database refuses a duplicate number', async () => {
    await expect(db.query(`update adr_reports set report_number=(select report_number from adr_reports limit 1) where report_id=(select report_id from adr_reports order by report_id desc limit 1)`)).rejects.toThrow(/unique|duplicate/i)
  })

  it('business-facing reports are unique too', async () => {
    const mk = () => db.query(`insert into adr_reports (business_id,module_type,status) values ('${IMP}','community_pharmacy','draft') returning report_number`)
    const a = (await mk()).rows[0].report_number
    const b = (await mk()).rows[0].report_number
    expect(a).not.toBe(b)
  })
})

describe('tracking by ADR number', () => {
  let target
  beforeAll(async () => { target = (await db.query(`select report_id, report_number from adr_reports where reporter_email='ada@example.com'`)).rows[0] })

  it('the reporter sees stage names for their own report, with no patient or company data', async () => {
    const r = await track(as(R1), target.report_number)
    expect(r.found).toBe(true)
    expect(r.report_number).toBe(target.report_number)
    expect(r.products).toEqual([{ product: 'Ampiclox', stage: 'received' }])
    const text = JSON.stringify(r)
    for (const secret of ['AB-PATIENT', 'Ada Okoro', 'Acme', 'ada@example.com']) expect(text).not.toContain(secret)
  })

  it('a different signed-in user needs the e-mail or phone the report was made with', async () => {
    expect((await track(as(R3), target.report_number)).found).toBe(false)
    expect((await track(as(R3), target.report_number, 'wrong@example.com')).found).toBe(false)
    expect((await track(as(R3), target.report_number, 'ADA@example.com ')).found).toBe(true)
    expect((await track(as(R3), target.report_number, '+234 803 000 0003')).found).toBe(true)
  })

  it('an unknown number, a draft and a malformed number all look the same: not found', async () => {
    const draftNum = (await db.query(`select report_number from adr_reports where status='draft' and report_source='public' limit 1`)).rows[0].report_number
    const who = as('44444444-4444-4444-8444-444444444444')
    await db.query(`insert into auth.users (id) values ('${who.sub}')`)
    expect(await track(who, 'ADR-2099-999999')).toEqual({ found: false })
    expect(await track(who, draftNum, 'ada@example.com')).toEqual({ found: false })
    expect((await track(who, 'not a number')).found).toBe(false)
  })

  it('failures are rate-limited per user, and the limit survives (the attempt rows are not rolled back)', async () => {
    const who = as('55555555-5555-4555-8555-555555555555')
    await db.query(`insert into auth.users (id) values ('${who.sub}')`)
    for (let i = 0; i < 8; i++) expect((await track(who, target.report_number, `guess${i}@example.com`)).found).toBe(false)
    await expect(track(who, target.report_number, 'ada@example.com')).rejects.toThrow(/too_many_attempts/)
    // someone else is unaffected
    expect((await track(as(R1), target.report_number)).found).toBe(true)
  })

  it('anonymous callers cannot call it, and nobody can read the attempt log', async () => {
    await db.query('reset role')
    await db.query('set role anon')
    await expect(db.query(`select track_adr_report('${target.report_number}', null)`)).rejects.toThrow(/permission denied/)
    await db.query('reset role')
    await act(as(R1), async (q) => {
      await expect(q('select * from adr_track_attempts')).rejects.toThrow(/permission denied/)
      await expect(q('select * from adr_report_counters')).rejects.toThrow(/permission denied/)
    })
  })

  it('the stage follows the routing: in review, sent to company, acknowledged, closed', async () => {
    const c = await publicReport(R1, {})
    const stage = async () => (await track(as(R1), c.number)).products[0].stage
    expect(await stage()).toBe('received')
    await db.query(`update adr_product_company_routes set held_at=now(), held_reason='checking' where route_id='${c.route}'`)
    expect(await stage()).toBe('in_review')
    await db.query(`update adr_product_company_routes set held_at=null, status='routed', reviewed_at=now() where route_id='${c.route}'`)
    expect(await stage()).toBe('sent_to_company')
    await db.query(`update adr_product_company_routes set company_status='acknowledged' where route_id='${c.route}'`)
    expect(await stage()).toBe('acknowledged_by_company')
    await db.query(`update adr_product_company_routes set company_status='under_assessment' where route_id='${c.route}'`)
    expect(await stage()).toBe('under_assessment')
    await db.query(`update adr_product_company_routes set company_status='closed' where route_id='${c.route}'`)
    expect(await stage()).toBe('closed')
  })

  it('functions exist once and are not callable by anon', async () => {
    const r = await db.query(`select proname, count(*) n, bool_or(has_function_privilege('anon', oid, 'execute')) anon_ok
      from pg_proc where proname in ('track_adr_report','generate_adr_report_number') group by 1`)
    expect(r.rows).toHaveLength(2)
    for (const row of r.rows) { expect(Number(row.n)).toBe(1); expect(row.anon_ok).toBe(false) }
  })
})
