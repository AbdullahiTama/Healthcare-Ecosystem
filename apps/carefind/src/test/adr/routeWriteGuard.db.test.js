// @vitest-environment node
// P0-1 regression (docs/audits/carefind-carehub-pv-routing-audit.md): API roles
// must not set or change routing/authorisation columns on
// adr_product_company_routes directly. Replays the real ADR migrations plus the
// route-write-guard migration on PGlite.
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
]
let db
const R1 = '11111111-1111-4111-8111-111111111111'
const IMP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PHARM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ADMIN_BIZ = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

async function act({ sub = '', email = '' }, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', sub])
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.email', email])
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
  await db.query('set role authenticated')
  try { return await fn((s) => db.query(s).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const asReporter = { sub: R1, email: 'rep@example.com' }
const asAdmin = { sub: 'ffffffff-0000-4000-8000-000000000000', email: 'admin@x.com' }

async function draftWithProduct() {
  const rep = (await db.query(`insert into adr_reports (business_id,module_type,status,report_source,reporter_auth_user_id)
    values (NULL,'public','draft','public','${R1}') returning report_id`)).rows[0].report_id
  const prod = (await db.query(`insert into adr_report_products (report_id,product_brand_name) values ('${rep}','X') returning product_id`)).rows[0].product_id
  return { rep, prod }
}

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
    ('${IMP}','i@c.com','I','active','manufacturer_importer','1','Imp','L','L',false),
    ('${PHARM}','p@c.com','P','active','pharmacy','2','Pharm','L','L',false),
    ('${ADMIN_BIZ}','admin@x.com','A','active','pharmacy','3','Admin','L','L',true)`)
}, 300000)
afterAll(async () => { await db?.close() })

describe('P0-1 route write guard', () => {
  it('a draft owner cannot flip their own route to routed or retarget it', async () => {
    const { rep, prod } = await draftWithProduct()
    const route = (await act(asReporter, (q) => q(`select create_adr_product_route('${rep}','${prod}','unknown',NULL,NULL,'k-upd') r`)))[0].r.route_id
    await expect(act(asReporter, (q) => q(
      `update adr_product_company_routes set selection_kind='verified', responsible_business_id='${PHARM}', status='routed' where route_id='${route}'`)))
      .rejects.toThrow(/only through the routing functions/)
    const row = (await db.query(`select status, selection_kind, responsible_business_id from adr_product_company_routes where route_id='${route}'`)).rows[0]
    expect(row).toEqual({ status: 'pending', selection_kind: 'unknown', responsible_business_id: null })
  })

  it('a direct INSERT cannot create a routed route or target an ineligible business', async () => {
    const { rep, prod } = await draftWithProduct()
    await expect(act(asReporter, (q) => q(
      `insert into adr_product_company_routes (report_id,product_id,responsible_business_id,selection_kind,status,idempotency_key)
       values ('${rep}','${prod}','${IMP}','verified','routed','k-ins-routed')`)))
      .rejects.toThrow(/created pending/)
    await expect(act(asReporter, (q) => q(
      `insert into adr_product_company_routes (report_id,product_id,responsible_business_id,selection_kind,idempotency_key)
       values ('${rep}','${prod}','${PHARM}','verified','k-ins-inelig')`)))
      .rejects.toThrow(/not an eligible/)
    const n = (await db.query(`select count(*)::int c from adr_product_company_routes where product_id='${prod}'`)).rows[0].c
    expect(n).toBe(0)
  })

  it('platform admins get no direct-write bypass either', async () => {
    const { rep, prod } = await draftWithProduct()
    const route = (await act(asReporter, (q) => q(`select create_adr_product_route('${rep}','${prod}','verified','${IMP}',NULL,'k-adm') r`)))[0].r.route_id
    await expect(act(asAdmin, (q) => q(`update adr_product_company_routes set status='routed' where route_id='${route}'`)))
      .rejects.toThrow(/only through the routing functions/)
  })

  it('the legitimate path still works: create RPC, then admin verify routes a validated case', async () => {
    const { rep, prod } = await draftWithProduct()
    const route = (await act(asReporter, (q) => q(`select create_adr_product_route('${rep}','${prod}','verified','${IMP}',NULL,'k-ok') r`)))[0].r
    expect(route.status).toBe('pending')
    // Not validated yet: the DEFINER body runs (not the guard) and refuses.
    await expect(act(asAdmin, (q) => q(`select verify_adr_product_route('${route.route_id}','ok')`)))
      .rejects.toThrow(/not passed validation/)
    await db.query(`update adr_reports set gate_validated_at = now(), status = 'submitted' where report_id='${rep}'`)
    const out = await act(asAdmin, (q) => q(`select verify_adr_product_route('${route.route_id}','ok') r`))
    expect(out[0].r.status).toBe('routed')
  })

  it('the workflow RPC still advances company_status for a routed route', async () => {
    const { rep, prod } = await draftWithProduct()
    const route = (await act(asReporter, (q) => q(`select create_adr_product_route('${rep}','${prod}','verified','${IMP}',NULL,'k-wf') r`)))[0].r.route_id
    await db.query(`update adr_reports set gate_validated_at = now(), status = 'submitted' where report_id='${rep}'`)
    await act(asAdmin, (q) => q(`select verify_adr_product_route('${route}','ok')`))
    const out = await act(asAdmin, (q) => q(`select update_adr_route_workflow('${route}','acknowledged',NULL) r`))
    expect(out[0].r.company_status).toBe('acknowledged')
  })

  it('the guard function is not callable as an RPC by API roles', async () => {
    const acl = (await db.query(`select has_function_privilege('authenticated','public.adr_guard_route_writes()','EXECUTE') a,
      has_function_privilege('anon','public.adr_guard_route_writes()','EXECUTE') b`)).rows[0]
    expect(acl).toEqual({ a: false, b: false })
  })
})
