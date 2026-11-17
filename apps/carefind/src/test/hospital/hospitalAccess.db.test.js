// @vitest-environment node
// carehub_20270124_hospital_access (CODE_AUDIT A34, A35, A37) on PGlite with the live helpers, their live EXECUTE
// grants and the baseline tables. Clinical work is limited to hospital businesses and to the role that does it; the
// business type is CareHub's to change; clinical history survives; every write is in an append-only audit trail;
// and every write the app makes today is still allowed for the role that makes it.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import {
  createHospitalDb, actAs, BIZ, OTHER, LAB, OWNER, MANAGER, CASHIER, STRANGER, RECEPTION, NURSE, DOCTOR, LABTECH,
  PHARMACIST, RADIOGRAPHER, LAB_OWNER, ADMIN, PT,
} from './hospitalFixture'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })

const CONSULT = 'c3000000-0000-4000-8000-000000000001'
const RX = 'c4000000-0000-4000-8000-000000000001'
const LABREQ = 'c5000000-0000-4000-8000-000000000001'
const IMG = 'c6000000-0000-4000-8000-000000000001'

let db, as
beforeAll(async () => {
  db = await createHospitalDb()
  as = actAs(db)
})

const count = (t) => `select count(*)::int n from ${t}`
const n = (r, i = 0) => r.out?.[i]?.[0]?.n

describe('who has which clinical modules', () => {
  it('mirrors the app: the Owner has all, each preset its own, a custom role its ticked modules, others none', async () => {
    const mods = async (email, biz = BIZ) => (await as(email, `select hospital_clinical_modules('${biz}') m`)).out[0][0].m
    expect(await mods(OWNER)).toEqual(['reception', 'triage', 'doctor', 'rx_inbox', 'lab', 'imaging'])
    expect(await mods(RECEPTION)).toEqual(['reception'])
    expect(await mods(NURSE)).toEqual(['triage'])
    expect(await mods(DOCTOR)).toEqual(['doctor'])
    expect(await mods(LABTECH)).toEqual(['lab'])
    expect(await mods(PHARMACIST)).toEqual(['rx_inbox'])
    expect(await mods(RADIOGRAPHER)).toEqual(['imaging'])
    expect(await mods(MANAGER)).toEqual([])
    expect(await mods(CASHIER)).toEqual([])
  })

  it('only hospitals have clinical modules; a laboratory has the lab bench only; nobody answers for another business', async () => {
    expect((await as(STRANGER, `select hospital_clinical_modules('${OTHER}') m`)).out[0][0].m).toEqual([])
    expect((await as(LAB_OWNER, `select hospital_clinical_modules('${LAB}') m`)).out[0][0].m).toEqual(['lab'])
    expect((await as(STRANGER, `select hospital_clinical_modules('${BIZ}') m`)).out[0][0].m).toEqual([])
    expect((await as(DOCTOR, `select hospital_clinical_modules('${OTHER}') m`)).out[0][0].m).toEqual([])
  })
})

describe('reads are limited to the role that needs them (A34)', () => {
  it('a Cashier and a Manager of the hospital see no clinical data at all', async () => {
    for (const who of [CASHIER, MANAGER]) {
      const r = await as(who, ['patients', 'triage', 'consultations', 'prescriptions', 'lab_requests', 'imaging_requests', 'patient_messages'].map(count))
      expect(r.out.map(x => x[0].n)).toEqual([0, 0, 0, 0, 0, 0, 0])
    }
  })

  it('each department reads only its own work, and every department can find the patient', async () => {
    const tables = ['patients', 'triage', 'consultations', 'prescriptions', 'lab_requests', 'imaging_requests', 'patient_messages']
    const seen = async (who) => (await as(who, tables.map(t => `select count(*)::int n from ${t} where business_id = '${BIZ}'`))).out.map(x => x[0].n)
    //                                  pat tri con rx  lab img msg
    expect(await seen(RECEPTION)).toEqual([2, 0, 0, 0, 0, 0, 1])
    expect(await seen(NURSE)).toEqual([2, 1, 0, 0, 0, 0, 1])
    expect(await seen(DOCTOR)).toEqual([2, 1, 1, 1, 1, 1, 1])
    expect(await seen(PHARMACIST)).toEqual([2, 0, 0, 1, 0, 0, 1])
    expect(await seen(LABTECH)).toEqual([2, 0, 0, 0, 1, 0, 1])
    expect(await seen(RADIOGRAPHER)).toEqual([2, 0, 0, 0, 0, 1, 1])
    expect(await seen(OWNER)).toEqual([2, 1, 1, 1, 1, 1, 1])
  })

  it('platform admins can read but no longer write', async () => {
    expect(n(await as(ADMIN, `select count(*)::int n from consultations`))).toBe(1)
    const w = await as(ADMIN, `update patients set status = 'discharged' where id = '${PT(1)}' returning id`)
    expect(w.out[0]).toEqual([])
  })
})

describe('the Hospital Model boundary (A35)', () => {
  it('a non-hospital business can neither read nor create patient records', async () => {
    expect(n(await as(STRANGER, count('patients')))).toBe(0)
    expect((await as(STRANGER, `insert into patients (business_id, reg_no, full_name) values ('${OTHER}', 'R', 'Walk-in')`)).error)
      .toMatch(/row-level security/)
  })

  it('an owner cannot change their business type; platform staff can, and it is recorded', async () => {
    expect((await as(STRANGER, `update businesses set business_type = 'hospital' where id = '${OTHER}'`)).error)
      .toMatch(/can only be changed by CareHub/)
    expect((await as(OWNER, `update businesses set business_type = 'pharmacy' where id = '${BIZ}'`)).error)
      .toMatch(/can only be changed by CareHub/)
    // Other columns of their own row are unchanged for the owner.
    expect((await as(OWNER, `update businesses set name = 'City Hospital' where id = '${BIZ}' returning name`)).out[0]).toEqual([{ name: 'City Hospital' }])
    // The platform admin's change, then the log read by the database owner in the same (rolled-back) transaction.
    await db.exec('begin')
    try {
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: '20000000-0000-4000-8000-000000000008', email: ADMIN, role: 'authenticated' })])
      await db.exec('set local role authenticated')
      const u = await db.query(`update businesses set business_type = 'clinic' where id = '${OTHER}' returning business_type`)
      expect(u.rows).toEqual([{ business_type: 'clinic' }])
      await db.exec('reset role')
      const log = await db.query(`select actor_admin_id, action, target_id, before, after from admin_audit_log`)
      expect(log.rows).toEqual([{ actor_admin_id: '20000000-0000-4000-8000-000000000008', action: 'business.business_type_changed',
        target_id: OTHER, before: { business_type: 'pharmacy' }, after: { business_type: 'clinic' } }])
    } finally { await db.exec('rollback') }
  })

  it('the audit helper cannot be used by a non-admin to forge an entry', async () => {
    expect((await as(OWNER, `select log_business_type_change('${BIZ}', 'a', 'b')`)).error).toMatch(/Only platform staff/)
  })
})

describe('writes are limited to the role that does the work', () => {
  it('only reception registers a patient', async () => {
    const ins = (who) => as(who, `insert into patients (business_id, reg_no, full_name, status) values ('${BIZ}', 'R9', 'New', 'at_triage') returning id`)
    expect((await ins(RECEPTION)).error).toBeUndefined()
    expect((await ins(OWNER)).error).toBeUndefined()
    for (const who of [NURSE, DOCTOR, CASHIER]) expect((await ins(who)).error, who).toMatch(/row-level security/)
  })

  it('only the doctor records consultations, prescriptions and requests; nobody edits a consultation', async () => {
    expect((await as(NURSE, `insert into consultations (patient_id, business_id, primary_diagnosis) values ('${PT(1)}', '${BIZ}', 'x')`)).error).toMatch(/row-level security/)
    expect((await as(LABTECH, `insert into lab_requests (patient_id, business_id) values ('${PT(1)}', '${BIZ}')`)).error).toMatch(/row-level security/)
    expect((await as(DOCTOR, `update consultations set primary_diagnosis = 'Typhoid' where id = '${CONSULT}' returning id`)).out[0]).toEqual([])
    expect((await as(OWNER, `update consultations set primary_diagnosis = 'Typhoid' where id = '${CONSULT}' returning id`)).out[0]).toEqual([])
  })

  it('only the pharmacy dispenses, the lab works lab requests, imaging reports scans', async () => {
    expect((await as(DOCTOR, `update prescriptions set status = 'dispensed' where id = '${RX}' returning id`)).out[0]).toEqual([])
    expect((await as(PHARMACIST, `update prescriptions set status = 'dispensed' where id = '${RX}' returning status`)).out[0]).toEqual([{ status: 'dispensed' }])
    expect((await as(PHARMACIST, `update lab_requests set status = 'completed' where id = '${LABREQ}' returning id`)).out[0]).toEqual([])
    expect((await as(LABTECH, `update lab_requests set status = 'completed' where id = '${LABREQ}' returning status`)).out[0]).toEqual([{ status: 'completed' }])
    expect((await as(DOCTOR, `update imaging_requests set report = 'x' where id = '${IMG}' returning id`)).out[0]).toEqual([])
    expect((await as(RADIOGRAPHER, `update imaging_requests set report = 'Clear' where id = '${IMG}' returning report`)).out[0]).toEqual([{ report: 'Clear' }])
  })
})

describe('clinical history is kept (A34, A37)', () => {
  it('no member can delete or truncate clinical records, the Owner included; anon has nothing', async () => {
    for (const t of ['patients', 'consultations', 'prescriptions', 'lab_requests', 'patient_messages']) {
      expect((await as(OWNER, `delete from ${t}`)).error, t).toMatch(/permission denied/)
      expect((await as(OWNER, `truncate ${t}`)).error, t).toMatch(/permission denied/)
    }
    expect((await as(null, count('patients'))).error).toMatch(/permission denied/)
    expect((await as(null, `insert into patient_messages (patient_id, business_id, message) values ('${PT(1)}', '${BIZ}', 'x')`)).error).toMatch(/permission denied/)
  })

  it('a patient with clinical records cannot be deleted even by the database owner; deleting the whole business still can', async () => {
    await db.exec('begin')
    try {
      await expect(db.exec(`delete from patients where id = '${PT(1)}'`)).rejects.toThrow(/foreign key/)
    } finally { await db.exec('rollback') }
    await db.exec('begin')
    try {
      await db.exec(`delete from businesses where id = '${BIZ}'`)
      expect((await db.query(`select count(*)::int n from consultations`)).rows[0].n).toBe(0)
    } finally { await db.exec('rollback') }
  })

  it('a clinical row must belong to its patient\'s business, and cannot be moved', async () => {
    expect((await as(DOCTOR, `insert into lab_requests (patient_id, business_id) values ('${PT(9)}', '${BIZ}')`)).error).toMatch(/not a patient of this business/)
    expect((await as(DOCTOR, `insert into lab_requests (business_id) values ('${BIZ}')`)).error).toMatch(/must name its patient/)
    expect((await as(DOCTOR, `insert into prescriptions (patient_id, business_id, consultation_id) values ('${PT(2)}', '${BIZ}', '${CONSULT}')`)).error)
      .toMatch(/consultation is not this patient/)
    expect((await as(LABTECH, `insert into lab_results (lab_request_id, patient_id, business_id) values ('${LABREQ}', '${PT(2)}', '${BIZ}')`)).error)
      .toMatch(/lab request is not this patient/)
    expect((await as(LABTECH, `update lab_requests set patient_id = '${PT(2)}' where id = '${LABREQ}'`)).error).toMatch(/cannot be moved/)
    expect((await as(RECEPTION, `update patients set business_id = '${OTHER}' where id = '${PT(2)}'`)).error).toMatch(/cannot be moved to another business/)
  })
})

describe('the clinical audit trail', () => {
  it('records who created and changed a clinical record, with the previous values', async () => {
    // The nurse's writes, then the trail read by the database owner in the same (rolled-back) transaction.
    await db.exec('begin')
    try {
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: '20000000-0000-4000-8000-000000000002', email: NURSE, role: 'authenticated' })])
      await db.exec('set local role authenticated')
      await db.exec(`insert into triage (patient_id, business_id, bp) values ('${PT(2)}', '${BIZ}', '110/70')`)
      await db.exec(`update patients set status = 'at_doctor' where id = '${PT(2)}'`)
      await db.exec('reset role')
      const log = await db.query(`select table_name, action, patient_id, actor_name, changed from clinical_audit_log order by id`)
      expect(log.rows).toEqual([
        { table_name: 'triage', action: 'insert', patient_id: PT(2), actor_name: 'Nkem Nurse', changed: null },
        { table_name: 'patients', action: 'update', patient_id: PT(2), actor_name: 'Nkem Nurse', changed: { status: 'at_triage' } },
      ])
    } finally { await db.exec('rollback') }
  })

  it('only the Owner (and platform staff) can read it; nobody can change, delete or truncate it', async () => {
    await db.exec(`insert into clinical_audit_log (business_id, table_name, row_id, action) values ('${BIZ}', 'patients', '${PT(1)}', 'update')`)
    expect(n(await as(OWNER, count('clinical_audit_log')))).toBe(1)
    expect(n(await as(ADMIN, count('clinical_audit_log')))).toBe(1)
    expect(n(await as(DOCTOR, count('clinical_audit_log')))).toBe(0)
    expect((await as(OWNER, `insert into clinical_audit_log (business_id, table_name, row_id, action) values ('${BIZ}', 'x', '${PT(1)}', 'insert')`)).error).toMatch(/permission denied/)
    expect((await as(OWNER, `delete from clinical_audit_log`)).error).toMatch(/permission denied/)
    await expect(db.exec(`update clinical_audit_log set actor_name = 'x'`)).rejects.toThrow(/cannot be changed or deleted/)
    await expect(db.exec(`delete from clinical_audit_log`)).rejects.toThrow(/cannot be changed or deleted/)
    await expect(db.exec(`truncate clinical_audit_log`)).rejects.toThrow(/cannot be changed or deleted/)
  })
})

describe('the app in production keeps working (every write it makes today)', () => {
  it('Reception registers, Triage records and moves on, the Doctor consults, the Pharmacist dispenses, the Lab reports', async () => {
    const steps = [
      [RECEPTION, `insert into patients (business_id, reg_no, full_name, phone, status) values ('${BIZ}', 'REG-7', 'Chidi', '0805', 'at_triage') returning id`],
      [NURSE, `insert into triage (patient_id, business_id, bp, status) values ('${PT(2)}', '${BIZ}', '120/80', 'done') returning id`],
      [NURSE, `update patients set status = 'at_doctor' where id = '${PT(2)}'`],
      [DOCTOR, `insert into consultations (patient_id, business_id, primary_diagnosis, status) values ('${PT(1)}', '${BIZ}', 'Malaria', 'completed') returning id`],
      [DOCTOR, `insert into prescriptions (patient_id, business_id, patient_name, medicines, status) values ('${PT(1)}', '${BIZ}', 'Ada Obi', '"[]"', 'pending') returning id`],
      [DOCTOR, `update patients set status = 'at_pharmacy' where id = '${PT(1)}'`],
      [DOCTOR, `insert into patient_messages (patient_id, business_id, sender_name, message) values ('${PT(1)}', '${BIZ}', 'Dr Dayo', 'Done') returning id`],
      [PHARMACIST, `update prescriptions set status = 'dispensed' where id = '${RX}'`],
      [PHARMACIST, `update patients set status = 'discharged' where id = '${PT(1)}'`],
      [LABTECH, `insert into lab_results (lab_request_id, patient_id, business_id, results, status) values ('${LABREQ}', '${PT(1)}', '${BIZ}', '[]', 'completed') returning id`],
      [LABTECH, `update lab_requests set status = 'completed' where id = '${LABREQ}'`],
    ]
    for (const [who, sql] of steps) expect((await as(who, sql)).error, `${who}: ${sql}`).toBeUndefined()
  })
})
