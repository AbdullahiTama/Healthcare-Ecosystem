// @vitest-environment node
// A reporter can change the company on their own DRAFT (reported bug: choosing a
// company after "I don't know" failed with a generic save error). Replays the real
// ADR migrations, proves the failure on the shipped function, then applies the
// fix and proves the new behaviour and every boundary that must not move.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 300000 })
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const FIX = read('../../../../../docs/architecture/pending-migrations/carehub_20261203_adr_route_change_selection.sql')
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
const IMP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const IMP2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const PHARM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ADMIN_BIZ = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

async function act({ sub = '', email = '' }, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', sub])
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.email', email])
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
  await db.query('set role authenticated')
  try { return await fn((s) => db.query(s).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const asR1 = { sub: R1, email: 'rep@example.com' }
const asR2 = { sub: R2, email: 'other@example.com' }
const asAdmin = { sub: 'ffffffff-0000-4000-8000-000000000000', email: 'admin@x.com' }

async function draft(owner = R1) {
  const rep = (await db.query(`insert into adr_reports (business_id,module_type,status,report_source,reporter_auth_user_id)
    values (NULL,'public','draft','public','${owner}') returning report_id`)).rows[0].report_id
  const prod = (await db.query(`insert into adr_report_products (report_id,product_brand_name) values ('${rep}','Ampiclox') returning product_id`)).rows[0].product_id
  return { rep, prod }
}
const route = (who, rep, prod, kind, biz, cand, key) => act(who, (q) => q(
  `select create_adr_product_route('${rep}','${prod}','${kind}',${biz ? `'${biz}'` : 'NULL'},${cand ? `'${cand}'` : 'NULL'},'${key}') r`)).then((r) => r[0].r)
const routesOf = async (prod) => (await db.query(`select * from adr_product_company_routes where product_id='${prod}'`)).rows
const events = async (rep) => (await db.query(`select metadata from adr_report_events where report_id='${rep}' and event_type='routing_created'`)).rows

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`)
  await db.exec(read('./fixtures/adrTestSchema.sql'))
  for (const m of MIGRATIONS) await db.exec(M(m))
  await db.query(`insert into auth.users (id) values ('${R1}'), ('${R2}')`)
  await db.query(`insert into public.businesses (id,email,owner,status,business_type,phone,name,city,state,is_platform_admin) values
    ('${IMP}','i@c.com','Imp Owner','active','manufacturer_importer','1','Acme Pharma Ltd','Lagos','Lagos',false),
    ('${IMP2}','i2@c.com','Imp2 Owner','active','manufacturer_importer','4','Globex Labs','Abuja','FCT',false),
    ('${PHARM}','p@c.com','P','active','pharmacy','2','Corner Pharmacy','Lagos','Lagos',false),
    ('${ADMIN_BIZ}','admin@x.com','Admin','active','pharmacy','3','Admin','Lagos','Lagos',true)`)
}, 300000)
afterAll(async () => { await db?.close() })

describe('the bug, on the function as shipped', () => {
  it('choosing a company after "I do not know" is refused', async () => {
    const { rep, prod } = await draft()
    await route(asR1, rep, prod, 'unknown', null, null, 'bug-1')
    await expect(route(asR1, rep, prod, 'verified', IMP, null, 'bug-2')).rejects.toThrow(/at most one company selection/)
  })
})

describe('after the fix', () => {
  beforeAll(async () => { await db.exec(FIX) })

  it('unknown -> company replaces the selection in place (one route, not two)', async () => {
    const { rep, prod } = await draft()
    const a = await route(asR1, rep, prod, 'unknown', null, null, 'ch-1a')
    const b = await route(asR1, rep, prod, 'verified', IMP, null, 'ch-1b')
    expect(b.route_id).toBe(a.route_id)
    const rows = await routesOf(prod)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ selection_kind: 'verified', responsible_business_id: IMP, reporter_selected_business_id: IMP, status: 'pending', idempotency_key: 'ch-1b' })
  })

  it('company -> another company -> typed name -> unknown all work on a draft', async () => {
    const { rep, prod } = await draft()
    await route(asR1, rep, prod, 'verified', IMP, null, 'ch-2a')
    await route(asR1, rep, prod, 'verified', IMP2, null, 'ch-2b')
    let r = (await routesOf(prod))[0]
    expect(r.responsible_business_id).toBe(IMP2)
    await route(asR1, rep, prod, 'unverified_candidate', null, 'Typed  Co', 'ch-2c')
    r = (await routesOf(prod))[0]
    expect(r).toMatchObject({ selection_kind: 'unverified_candidate', responsible_business_id: null, candidate_name: 'Typed  Co', reporter_candidate_name: 'Typed  Co', reporter_selected_business_id: null })
    await route(asR1, rep, prod, 'unknown', null, null, 'ch-2d')
    r = (await routesOf(prod))[0]
    expect(r).toMatchObject({ selection_kind: 'unknown', responsible_business_id: null, candidate_name: null })
    expect(await routesOf(prod)).toHaveLength(1)
  })

  it('retrying the same selection is idempotent and logs no extra event', async () => {
    const { rep, prod } = await draft()
    await route(asR1, rep, prod, 'verified', IMP, null, 'ch-3')
    const before = (await events(rep)).length
    const again = await route(asR1, rep, prod, 'verified', IMP, null, 'ch-3')
    expect(again.status).toBe('pending')
    expect(await routesOf(prod)).toHaveLength(1)
    expect((await events(rep)).length).toBe(before)
  })

  it('the audit trail notes that a selection replaced an earlier one', async () => {
    const { rep, prod } = await draft()
    await route(asR1, rep, prod, 'unknown', null, null, 'ch-4a')
    await route(asR1, rep, prod, 'verified', IMP, null, 'ch-4b')
    const ev = await events(rep)
    expect(ev).toHaveLength(2)
    expect(ev[1].metadata.replaced_selection_kind).toBe('unknown')
  })

  it('an ineligible company is still refused, and the earlier selection survives', async () => {
    const { rep, prod } = await draft()
    await route(asR1, rep, prod, 'unknown', null, null, 'ch-5a')
    await expect(route(asR1, rep, prod, 'verified', PHARM, null, 'ch-5b')).rejects.toThrow(/not an eligible/)
    expect((await routesOf(prod))[0].selection_kind).toBe('unknown')
  })

  it("another reporter cannot touch someone else's draft", async () => {
    const { rep, prod } = await draft(R1)
    await route(asR1, rep, prod, 'unknown', null, null, 'ch-6a')
    await expect(route(asR2, rep, prod, 'verified', IMP, null, 'ch-6b')).rejects.toThrow(/not accessible/)
    expect((await routesOf(prod))[0].selection_kind).toBe('unknown')
  })

  it('after submission the selection is frozen: no replacement, still one route', async () => {
    const { rep, prod } = await draft()
    await route(asR1, rep, prod, 'verified', IMP, null, 'ch-7a')
    await db.query(`update adr_reports set status='submitted', gate_validated_at=now() where report_id='${rep}'`)
    await expect(route(asR1, rep, prod, 'verified', IMP2, null, 'ch-7b')).rejects.toThrow()
    const rows = await routesOf(prod)
    expect(rows).toHaveLength(1)
    expect(rows[0].responsible_business_id).toBe(IMP)
  })

  it('a route a reviewer has held or routed is never rewritten', async () => {
    const held = await draft()
    await route(asR1, held.rep, held.prod, 'verified', IMP, null, 'ch-8a')
    await db.query(`update adr_product_company_routes set held_at=now(), held_reason='checking' where product_id='${held.prod}'`)
    await expect(route(asR1, held.rep, held.prod, 'verified', IMP2, null, 'ch-8b')).rejects.toThrow(/at most one company selection/)
    expect((await routesOf(held.prod))[0].responsible_business_id).toBe(IMP)

    const routed = await draft()
    await route(asR1, routed.rep, routed.prod, 'verified', IMP, null, 'ch-8c')
    await db.query(`update adr_product_company_routes set status='routed', reviewed_at=now() where product_id='${routed.prod}'`)
    await expect(route(asR1, routed.rep, routed.prod, 'unknown', null, null, 'ch-8d')).rejects.toThrow(/at most one company selection/)
    expect((await routesOf(routed.prod))[0].status).toBe('routed')
  })

  it('direct client writes to routes are still blocked', async () => {
    const { rep, prod } = await draft()
    await route(asR1, rep, prod, 'unknown', null, null, 'ch-9a')
    await act(asR1, async (q) => {
      await expect(q(`update adr_product_company_routes set responsible_business_id='${IMP}', selection_kind='verified' where product_id='${prod}'`)).rejects.toThrow()
    })
  })

  it('one product keeps one route; a second product can have its own', async () => {
    const { rep, prod } = await draft()
    const prod2 = (await db.query(`insert into adr_report_products (report_id,product_brand_name) values ('${rep}','Second') returning product_id`)).rows[0].product_id
    await route(asR1, rep, prod, 'verified', IMP, null, 'ch-10a')
    await route(asR1, rep, prod2, 'verified', IMP2, null, 'ch-10b')
    expect(await routesOf(prod)).toHaveLength(1)
    expect(await routesOf(prod2)).toHaveLength(1)
  })

  it('a changed selection reaches the reviewer queue as the reporter\'s final choice', async () => {
    const { rep, prod } = await draft()
    await route(asR1, rep, prod, 'unknown', null, null, 'ch-11a')
    await route(asR1, rep, prod, 'verified', IMP, null, 'ch-11b')
    await db.query(`update adr_reports set status='submitted', gate_validated_at=now(), report_number='T-1' where report_id='${rep}'`)
    const q = await act(asAdmin, (s) => s(`select selected_business_id, selection_kind from list_adr_route_review_queue('open') where report_id='${rep}'`))
    expect(q).toEqual([{ selected_business_id: IMP, selection_kind: 'verified' }])
  })

  it('exactly one overload and no anon access', async () => {
    const r = await db.query(`select count(*) n, bool_or(has_function_privilege('anon', oid, 'execute')) anon_ok from pg_proc where proname='create_adr_product_route'`)
    expect(Number(r.rows[0].n)).toBe(1)
    expect(r.rows[0].anon_ok).toBe(false)
  })
})
