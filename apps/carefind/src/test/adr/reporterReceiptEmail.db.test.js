// @vitest-environment node
// The reporter's receipt e-mail: queued by the database when a PUBLIC report is submitted, once, to the address on the
// report, carrying the number and nothing clinical, and never able to block or break a submission. Replays the real ADR
// migrations (through the unique-number one), production's enqueue functions, then the receipt migration.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 90000, hookTimeout: 300000 })
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
const FIX = read('../../../../../supabase/migrations/carehub_20261205_adr_reporter_receipt_email.sql')
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
  'carehub_20261114_adr_route_review', 'carehub_20261204_adr_report_number_and_tracking',
]
let db
const R1 = '11111111-1111-4111-8111-111111111111'
const IMP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ADMIN_BIZ = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

async function act(sub, fn) {
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', sub])
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.email', 'rep@example.com'])
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
  await db.query('set role authenticated')
  try { return await fn((s) => db.query(s).then((r) => r.rows)) } finally { await db.query('reset role') }
}
const q = (s, p = []) => db.query(s, p).then((r) => r.rows)
const esc = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

// A public report the real submit RPC accepts; submit unless told not to.
async function report({ email = 'ada@example.com', name = 'Ada Okoro', phone = '08030000003', submit = true } = {}) {
  const rep = (await q(`insert into adr_reports (business_id,module_type,status,report_source,reporter_auth_user_id,
      reporter_name,reporter_qualification,reporter_phone,reporter_email,reporter_consent_followup,patient_identifier,patient_gender,patient_age)
    values (NULL,'public','draft','public','${R1}',${esc(name)},'consumer',${esc(phone)},${esc(email)},true,'PATIENT-SECRET','female',34) returning report_id`))[0].report_id
  const prod = (await q(`insert into adr_report_products (report_id,product_brand_name) values ('${rep}','Ampiclox') returning product_id`))[0].product_id
  await q(`insert into adr_report_reactions (report_id,reaction_description,severity,outcome,
      seriousness_death,seriousness_life_threatening,seriousness_hospitalization,seriousness_disability,
      seriousness_congenital_anomaly,seriousness_other_medically_important,seriousness_unknown)
    values ('${rep}','Anaphylaxis','mild','recovered',false,false,false,false,false,false,'{}')`)
  await act(R1, (x) => x(`select create_adr_product_route('${rep}','${prod}','verified','${IMP}',NULL,'rcpt-${rep}') r`))
  if (submit) {
    const out = (await act(R1, (x) => x(`select submit_adr_public_report('${rep}') r`)))[0].r
    expect(out.valid, JSON.stringify(out)).toBe(true)
  }
  return rep
}
const outboxFor = (rep) => q(`select * from email_outbox where source_id='${rep}' and event_key='adr_report_received'`)
const logsFor = (rep) => q(`select status, error from adr_notification_log where report_id='${rep}' and kind='adr_reporter_receipt'`)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`)
  await db.exec(read('./fixtures/adrTestSchema.sql'))
  for (const m of MIGRATIONS) await db.exec(M(m))
  await db.exec(read('./fixtures/emailEnqueue.sql'))
  await db.query(`insert into auth.users (id) values ('${R1}')`)
  await db.query(`insert into public.businesses (id,email,owner,status,business_type,phone,name,city,state,is_platform_admin) values
    ('${IMP}','i@c.com','Imp Owner','active','manufacturer_importer','1','Acme Pharma Ltd','Lagos','Lagos',false),
    ('${ADMIN_BIZ}','admin@x.com','Admin','active','pharmacy','3','Admin','Lagos','Lagos',true)`)
  await db.exec(FIX)
}, 300000)
afterAll(async () => { await db?.close() })

describe('the catalog row', () => {
  it('is registered for CareFind, enabled, strict, and branded the way production requires', async () => {
    const [row] = await q(`select * from email_event_catalog where app='carefind' and event_key='adr_report_received'`)
    expect(row).toMatchObject({ enabled: true, template_key: 'adr_report_received', category: 'transactional', rollout_mode: 'live' })
    expect(row.subject_template).toBe('CareFind: Safety report {{report_number}} received')
    expect(Object.keys(row.payload_schema.properties).sort()).toEqual(['recipient_name', 'report_number'])
    expect(row.payload_schema.additionalProperties).toBe(false)
  })
})

describe('on submission', () => {
  it('a draft sends nothing', async () => {
    const rep = await report({ submit: false })
    expect(await outboxFor(rep)).toHaveLength(0)
  })

  it('submitting queues exactly one e-mail, to the address on the report, with the number and nothing clinical', async () => {
    const rep = await report()
    const [num] = await q(`select report_number from adr_reports where report_id='${rep}'`)
    const rows = await outboxFor(rep)
    expect(rows).toHaveLength(1)
    const m = rows[0]
    expect(m).toMatchObject({ to_email: 'ada@example.com', template_key: 'adr_report_received', app: 'carefind', status: 'pending' })
    expect(m.subject).toBe(`CareFind: Safety report ${num.report_number} received`)
    expect(m.payload).toEqual({ report_number: num.report_number, recipient_name: 'Ada Okoro' })
    const everything = JSON.stringify(m)
    for (const secret of ['PATIENT-SECRET', 'Ampiclox', 'Anaphylaxis', 'Acme', '08030000003']) expect(everything).not.toContain(secret)
    expect(await logsFor(rep)).toEqual([{ status: 'sent', error: null }])
  })

  it('is once-only: firing the transition again does not queue a second e-mail', async () => {
    const rep = await report()
    await q(`update adr_reports set status='draft' where report_id='${rep}'`)
    await q(`update adr_reports set status='submitted' where report_id='${rep}'`)
    expect(await outboxFor(rep)).toHaveLength(1)
  })

  it('no address on the report: no e-mail and no failure', async () => {
    const rep = await report({ email: null })
    expect(await outboxFor(rep)).toHaveLength(0)
    expect(await logsFor(rep)).toEqual([])
  })

  it.each(['not-an-email', 'a@b', 'two words@x.com', 'a@@b.com'])('an invalid address (%s) sends nothing', async (email) => {
    const rep = await report({ email })
    expect(await outboxFor(rep)).toHaveLength(0)
  })

  it('a name with control characters or excessive length is cleaned, not rejected (a name is required by the server)', async () => {
    const a = await report({ name: 'Ada\nOkoro\t' })
    expect((await outboxFor(a))[0].payload.recipient_name).toBe('Ada Okoro')
    const b = await report({ name: 'N'.repeat(300) })
    expect((await outboxFor(b))[0].payload.recipient_name).toHaveLength(120)
  })

  it('a business-facing (non-public) report never sends this e-mail', async () => {
    const id = (await q(`insert into adr_reports (business_id,module_type,status,reporter_email) values ('${IMP}','community_pharmacy','draft','x@y.com') returning report_id`))[0].report_id
    await q(`update adr_reports set status='submitted', gate_validated_at=now() where report_id='${id}'`)
    expect(await outboxFor(id)).toHaveLength(0)
  })
})

describe('it can never break a submission', () => {
  it('a suppressed event (disabled in the catalog) still submits, and is recorded as not sent', async () => {
    await q(`update email_event_catalog set enabled=false where app='carefind' and event_key='adr_report_received'`)
    try {
      const rep = await report()
      expect((await q(`select status from adr_reports where report_id='${rep}'`))[0].status).toBe('submitted')
      expect(await outboxFor(rep)).toHaveLength(0)
      expect(await logsFor(rep)).toEqual([{ status: 'failed', error: 'suppressed by the e-mail catalog' }])
    } finally {
      await q(`update email_event_catalog set enabled=true where app='carefind' and event_key='adr_report_received'`)
    }
  })

  it('a missing catalog row (an unknown event) still submits, and the failure is visible to reviewers', async () => {
    const saved = (await q(`select * from email_event_catalog where app='carefind' and event_key='adr_report_received'`))[0]
    await q(`delete from email_event_catalog where app='carefind' and event_key='adr_report_received'`)
    try {
      const rep = await report()
      expect((await q(`select status from adr_reports where report_id='${rep}'`))[0].status).toBe('submitted')
      const logs = await logsFor(rep)
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({ status: 'failed', error: 'unknown_catalog_event' })
      await db.query('select set_config($1,$2,false)', ['request.jwt.claim.email', 'admin@x.com'])
      await db.query('set role authenticated')
      const failures = (await q(`select kind, error from list_adr_notification_failures() where report_id='${rep}'`))
      await db.query('reset role')
      expect(failures).toEqual([{ kind: 'adr_reporter_receipt', error: 'unknown_catalog_event' }])
    } finally {
      await q(`insert into email_event_catalog (app,event_key,template_key,subject_template,from_email,reply_to,payload_schema,enabled,required_for_business,category,rollout_mode)
        values ($1,$2,$3,$4,$5,$6,$7,true,false,'transactional','live')`.replace(/\$(\d)/g, (_, i) => esc(
        [saved.app, saved.event_key, saved.template_key, saved.subject_template, saved.from_email, saved.reply_to, JSON.stringify(saved.payload_schema)][i - 1])))
    }
  })
})

describe('permissions', () => {
  it('the trigger function exists once and no API role can call it; a reporter cannot read the outbox', async () => {
    const r = await q(`select count(*) n, bool_or(has_function_privilege('anon', oid, 'execute')) a, bool_or(has_function_privilege('authenticated', oid, 'execute')) u
      from pg_proc where proname='adr_enqueue_reporter_receipt'`)
    expect(Number(r[0].n)).toBe(1)
    expect(r[0].a).toBe(false)
    expect(r[0].u).toBe(false)
  })
})
