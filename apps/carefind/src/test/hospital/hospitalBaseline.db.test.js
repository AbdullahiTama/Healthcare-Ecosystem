// @vitest-environment node
// carehub_20270123_hospital_schema_baseline: the eight hospital tables as live (read 2026-11-16/17). These tests pin
// that the baseline reproduces production, including the weaknesses CODE_AUDIT A34, A35 and A37 record, so the
// access migration's tests (hospitalAccess.db.test.js) are measured against the real starting point.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createHospitalDb, actAs, MIGRATIONS, BIZ, OTHER, OWNER, CASHIER, STRANGER, PT } from './hospitalFixture'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })

let db, as
beforeAll(async () => {
  db = await createHospitalDb({ upTo: 'baseline' })
  as = actAs(db)
})

describe('carehub_20270123_hospital_schema_baseline', () => {
  it('creates the eight tables with the live columns and foreign keys', async () => {
    const cols = await db.query(`select table_name t, count(*)::int n from information_schema.columns
      where table_schema = 'public' and table_name in ('patients','triage','consultations','prescriptions','lab_requests','lab_results','imaging_requests','patient_messages')
      group by 1 order by 1`)
    // Live column counts, 2026-11-17.
    expect(cols.rows).toEqual([
      { t: 'consultations', n: 17 }, { t: 'imaging_requests', n: 13 }, { t: 'lab_requests', n: 11 }, { t: 'lab_results', n: 11 },
      { t: 'patient_messages', n: 9 }, { t: 'patients', n: 16 }, { t: 'prescriptions', n: 14 }, { t: 'triage', n: 17 },
    ])
    const fks = await db.query(`select count(*)::int n from pg_constraint where contype = 'f' and conrelid::regclass::text in
      ('patients','triage','consultations','prescriptions','lab_requests','lab_results','imaging_requests','patient_messages')`)
    expect(fks.rows[0].n).toBe(19)
  })

  it('is a no-op when applied again (as it is on production)', async () => {
    const before = await db.query(`select count(*)::int n from pg_policies where tablename in ('patients','lab_results','patient_messages')`)
    await db.exec(MIGRATIONS.baseline)
    const after = await db.query(`select count(*)::int n from pg_policies where tablename in ('patients','lab_results','patient_messages')`)
    expect(after.rows).toEqual(before.rows)
    expect((await db.query('select count(*)::int n from patients')).rows[0].n).toBe(3)
  })

  it('reproduces A34: a Cashier reads every diagnosis and can delete a patient, taking their history with them', async () => {
    const r = await as(CASHIER, [
      `select primary_diagnosis from consultations`,
      `delete from patients where id = '${PT(1)}'`,
      `select count(*)::int n from consultations`,
    ])
    expect(r.out[0]).toEqual([{ primary_diagnosis: 'Malaria' }])
    expect(r.out[2]).toEqual([{ n: 0 }])
  })

  it('reproduces A35: a pharmacy keeps patients, and an owner can change their business type', async () => {
    const r = await as(STRANGER, [
      `insert into patients (business_id, reg_no, full_name) values ('${OTHER}', 'R', 'Walk-in') returning id`,
      `update businesses set business_type = 'hospital' where id = '${OTHER}' returning business_type`,
    ])
    expect(r.error).toBeUndefined()
    expect(r.out[1]).toEqual([{ business_type: 'hospital' }])
  })

  it('reproduces A37: anon holds every table privilege and members can TRUNCATE (not subject to RLS)', async () => {
    const g = await db.query(`select bool_and(has_table_privilege('anon', t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) ok from unnest(array[
      'patients','triage','consultations','prescriptions','lab_requests','lab_results','imaging_requests','patient_messages']) t`)
    expect(g.rows).toEqual([{ ok: true }])
    // anon's reads fail only because the live policy calls is_platform_admin(), which anon may not execute.
    expect((await as(null, `select count(*) from patients`)).error).toMatch(/permission denied for function/)
    const t = await as(OWNER, [`truncate patient_messages`, `select count(*)::int n from patient_messages where business_id = '${BIZ}'`])
    expect(t.out[1]).toEqual([{ n: 0 }])
  })
})
