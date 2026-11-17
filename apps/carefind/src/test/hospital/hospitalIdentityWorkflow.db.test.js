// @vitest-environment node
// carehub_20270125_hospital_identity_and_workflow (CODE_AUDIT A36, A38) on PGlite, after the baseline and access
// migrations and the live client bulk delete. Clients are the patient identity (existing patients linked by phone
// digits, a visit's copy of the details kept by the database), and Reception, the Doctor and the Pharmacy save their
// work through functions that write everything or nothing.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import {
  createHospitalDb, actAs, BIZ, OTHER, OWNER, CASHIER, STRANGER, RECEPTION, NURSE, DOCTOR, LABTECH, PHARMACIST, PT, CL, USERS,
} from './hospitalFixture'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })

const RX = 'c4000000-0000-4000-8000-000000000001'
const LABREQ = 'c5000000-0000-4000-8000-000000000001'
const IMG = 'c6000000-0000-4000-8000-000000000001'

// A client who already exists with Ada's phone (other formatting) and no next of kin; and a plain client.
const BEFORE = `
  insert into clients (id, business_id, full_name, phone, gender) values
    ('${CL(1)}', '${BIZ}', 'Ada Obi-Okafor', '08011111111', 'Female'),
    ('${CL(2)}', '${BIZ}', 'Plain Client', '0700', null);
`

let db, as
beforeAll(async () => {
  db = await createHospitalDb({ upTo: 'identity', beforeIdentity: BEFORE })
  as = actAs(db)
})

const one = async (sql) => (await db.query(sql)).rows[0]

/** Run as a user inside a transaction, then read with the database owner before rolling back. */
async function thenRead(email, sql, read) {
  await db.exec('begin')
  try {
    await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: USERS[email], email, role: 'authenticated' })])
    await db.exec('set local role authenticated')
    let result, error
    try { result = (await db.query(sql)).rows } catch (e) { error = e.message }
    await db.exec('reset role')
    return { result, error, read: read ? (await db.query(read)).rows : undefined }
  } finally { await db.exec('rollback') }
}

describe('existing patients are linked to clients (A38)', () => {
  it('a patient whose phone digits match a client becomes that client; their next of kin and insurance fill the blanks', async () => {
    const p = await one(`select client_id, full_name, phone, next_of_kin, insurance from patients where id = '${PT(1)}'`)
    expect(p).toEqual({ client_id: CL(1), full_name: 'Ada Obi-Okafor', phone: '08011111111', next_of_kin: 'Obi Obi', insurance: 'NHIS' })
    expect(await one(`select gender, next_of_kin_name, next_of_kin_phone, insurance from clients where id = '${CL(1)}'`))
      .toEqual({ gender: 'Female', next_of_kin_name: 'Obi Obi', next_of_kin_phone: '0802', insurance: 'NHIS' })
    // What the visit held before is not lost: the refresh's previous values are in the audit trail.
    expect(await one(`select changed from clinical_audit_log where table_name = 'patients' and row_id = '${PT(1)}' and changed ? 'full_name'`))
      .toEqual({ changed: { full_name: 'Ada Obi', phone: '0801 111 1111' } })
  })

  it('a patient with no matching client gets one, in their own business; every patient now has a client', async () => {
    const b = await one(`select c.business_id, c.full_name, c.phone, c.gender from patients p join clients c on c.id = p.client_id where p.id = '${PT(2)}'`)
    expect(b).toEqual({ business_id: BIZ, full_name: 'Bayo Ade', phone: '0803', gender: 'Male' })
    expect((await one(`select c.business_id from patients p join clients c on c.id = p.client_id where p.id = '${PT(9)}'`)).business_id).toBe(OTHER)
    expect(await one(`select count(*)::int n from patients where client_id is null`)).toEqual({ n: 0 })
    expect(await one(`select is_nullable from information_schema.columns where table_name = 'patients' and column_name = 'client_id'`)).toEqual({ is_nullable: 'NO' })
  })
})

describe('the client is the one source of the patient\'s details', () => {
  it('a visit\'s copy cannot be edited directly; editing the client updates every visit', async () => {
    const r = await thenRead(RECEPTION, `update patients set full_name = 'Someone Else', phone = '0999' where id = '${PT(1)}'`,
      `select full_name, phone from patients where id = '${PT(1)}'`)
    expect(r.error).toBeUndefined()
    expect(r.read).toEqual([{ full_name: 'Ada Obi-Okafor', phone: '08011111111' }])
    // A Cashier can edit clients (Clients screen) without any clinical access; the visit follows.
    const c = await thenRead(CASHIER, `update clients set full_name = 'Ada Okafor', insurance = 'Hygeia' where id = '${CL(1)}'`,
      `select full_name, insurance from patients where id = '${PT(1)}'`)
    expect(c.error).toBeUndefined()
    expect(c.read).toEqual([{ full_name: 'Ada Okafor', insurance: 'Hygeia' }])
  })

  it('a visit cannot be moved to another client, nor linked to another business\'s client', async () => {
    expect((await as(RECEPTION, `update patients set client_id = '${CL(2)}' where id = '${PT(1)}'`)).error).toMatch(/cannot be moved to another patient/)
    const other = (await one(`select client_id from patients where id = '${PT(9)}'`)).client_id
    expect((await as(RECEPTION, `insert into patients (business_id, client_id, reg_no, full_name) values ('${BIZ}', '${other}', 'R', 'x')`)).error)
      .toMatch(/not a client of this business/)
  })

  it('the old Reception screen (no client) still registers: the patient is linked by phone, or a client is made', async () => {
    const r = await thenRead(RECEPTION,
      `insert into patients (business_id, reg_no, full_name, phone, next_of_kin, status) values
         ('${BIZ}', 'R1', 'Plain C.', '0700', 'Kin', 'at_triage'), ('${BIZ}', 'R2', 'Brand New', '0811', '', 'at_triage') returning reg_no, client_id`,
      `select p.reg_no, c.full_name, c.next_of_kin_name from patients p join clients c on c.id = p.client_id where p.reg_no in ('R1', 'R2') order by 1`)
    expect(r.error).toBeUndefined()
    expect(r.result[0].client_id).toBe(CL(2))
    expect(r.read).toEqual([{ reg_no: 'R1', full_name: 'Plain Client', next_of_kin_name: 'Kin' }, { reg_no: 'R2', full_name: 'Brand New', next_of_kin_name: null }])
  })

  it('a client with hospital visits is kept by delete_clients, with the reason', async () => {
    const r = await as(OWNER, `select delete_clients('${BIZ}', array['${CL(1)}', '${CL(2)}']::uuid[]) r`)
    expect(r.error).toBeUndefined()
    const out = r.out[0][0].r
    expect(out.deleted).toBe(1)
    expect(out.kept).toEqual([{ id: CL(1), name: 'Ada Obi-Okafor', reasons: ['hospital'] }])
  })
})

describe('register_hospital_visit (Reception)', () => {
  const client = (extra = {}) => JSON.stringify({ full_name: 'Chidi Eze', phone: '0812 345 6789', gender: 'Male', next_of_kin_name: 'Ngozi', insurance: 'NHIS', ...extra })
  const visit = JSON.stringify({ department: 'General OPD', pay_status: 'Paid' })

  it('registers a new patient as a client and opens a visit at triage, with a registration number', async () => {
    const r = await thenRead(RECEPTION, `select register_hospital_visit('${BIZ}', null, '${client()}', '${visit}') r`,
      `select p.status, p.full_name, p.next_of_kin, p.department, p.pay_status, c.phone, p.reg_no ~ '^REG-[0-9]{6}-[0-9A-F]{5}$' reg_ok
         from patients p join clients c on c.id = p.client_id where c.full_name = 'Chidi Eze'`)
    expect(r.error).toBeUndefined()
    expect(r.result[0].r).toMatchObject({ status: 'at_triage' })
    expect(r.read).toEqual([{ status: 'at_triage', full_name: 'Chidi Eze', next_of_kin: 'Ngozi', department: 'General OPD', pay_status: 'Paid', phone: '0812 345 6789', reg_ok: true }])
  })

  it('registers a returning client, updating only the details sent', async () => {
    // Bayo's visit is open (at_triage) in the seed: close it first.
    await db.exec('begin')
    try {
      await db.exec(`update patients set status = 'discharged' where id = '${PT(2)}'`)
      const bayo = (await db.query(`select client_id from patients where id = '${PT(2)}'`)).rows[0].client_id
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: USERS[RECEPTION], email: RECEPTION, role: 'authenticated' })])
      await db.exec('set local role authenticated')
      await db.query(`select register_hospital_visit('${BIZ}', '${bayo}', '{"insurance": "Leadway"}', '{"reg_no": "REG-B2"}')`)
      await db.exec('reset role')
      const rows = (await db.query(`select reg_no, status, full_name, insurance from patients where client_id = '${bayo}' order by created_at, reg_no`)).rows
      expect(rows).toEqual([
        { reg_no: 'REG-2', status: 'discharged', full_name: 'Bayo Ade', insurance: 'Leadway' },
        { reg_no: 'REG-B2', status: 'at_triage', full_name: 'Bayo Ade', insurance: 'Leadway' },
      ])
    } finally { await db.exec('rollback') }
  })

  it('refuses a second open visit, a phone another client has, missing details, and anyone but reception', async () => {
    const bayo = (await one(`select client_id from patients where id = '${PT(2)}'`)).client_id
    expect((await as(RECEPTION, `select register_hospital_visit('${BIZ}', '${bayo}', '{}', '{}')`)).error).toMatch(/already has an open visit \(at triage\)/)
    expect((await as(RECEPTION, `select register_hospital_visit('${BIZ}', null, '${client({ phone: '0801-111-1111' })}', '{}')`)).error)
      .toMatch(/already has that phone number/)
    expect((await as(RECEPTION, `select register_hospital_visit('${BIZ}', null, '{"full_name": "No Phone"}', '{}')`)).error).toMatch(/full name and phone/)
    expect((await as(RECEPTION, `select register_hospital_visit('${BIZ}', null, '${client({ phone: '12' })}', '{}')`)).error).toMatch(/7 to 15 digits/)
    expect((await as(NURSE, `select register_hospital_visit('${BIZ}', null, '${client()}', '{}')`)).error).toMatch(/Only reception/)
    expect((await as(STRANGER, `select register_hospital_visit('${OTHER}', null, '${client()}', '{}')`)).error).toMatch(/Only reception/)
    expect((await as(RECEPTION, `select register_hospital_visit('${BIZ}', '${CL(2)}', '{}', '{}')`)).error).toBeUndefined()
    expect((await as(null, `select register_hospital_visit('${BIZ}', null, '${client()}', '{}')`)).error).toMatch(/permission denied/)
  })
})

describe('complete_hospital_consultation (Doctor): everything or nothing (A36)', () => {
  const consult = (extra = {}) => JSON.stringify({ hpi: 'Fever 3 days', primary_diagnosis: 'Malaria', ...extra })
  const meds = JSON.stringify([{ name: 'Artemether', dose: '80mg', freq: 'BD', dur: '3 days', route: 'Oral' }])
  const lab = JSON.stringify({ tests: ['FBC', { name: 'Malaria RDT' }, ' '], priority: 'urgent' })
  const imaging = JSON.stringify([{ scan_type: 'Chest X-ray', body_part: 'Chest' }, { scan_type: '' }])

  it('saves the consultation, prescription, lab and imaging requests, status and message together', async () => {
    const r = await thenRead(DOCTOR, `select complete_hospital_consultation('${PT(1)}', '${consult()}', '${meds}', '${lab}', '${imaging}') r`,
      `select (select status from patients where id = '${PT(1)}') status,
              (select count(*)::int from consultations where patient_id = '${PT(1)}') consults,
              (select doctor_name from consultations where hpi = 'Fever 3 days') doctor,
              (select medicines from prescriptions where status = 'pending' and doctor_name = 'Dr Dayo') medicines,
              (select tests from lab_requests where priority = 'urgent') tests,
              (select requested_by_id::text from lab_requests where priority = 'urgent') requested_by_id,
              (select count(*)::int from imaging_requests where scan_type = 'Chest X-ray') scans,
              (select message from patient_messages where message_type = 'consultation') message,
              (select count(*)::int from clinical_audit_log where actor_name = 'Dr Dayo') audited`)
    expect(r.error).toBeUndefined()
    expect(r.result[0].r).toMatchObject({ status: 'at_lab', sent: ['pharmacy', 'lab', 'imaging'] })
    expect(r.read[0]).toEqual({
      status: 'at_lab', consults: 2, doctor: 'Dr Dayo',
      medicines: [{ name: 'Artemether', dose: '80mg', freq: 'BD', dur: '3 days', route: 'Oral' }],
      tests: [{ name: 'FBC' }, { name: 'Malaria RDT' }], requested_by_id: USERS[DOCTOR], scans: 1,
      message: 'Consultation complete. Diagnosis: Malaria. Sent to: pharmacy, lab, imaging.',
      // consultation, prescription, lab request, imaging request, patient status, message
      audited: 6,
    })
  })

  it('the disposition decides the outcome: Admit admits, whatever was requested', async () => {
    const r = await thenRead(DOCTOR, `select complete_hospital_consultation('${PT(1)}', '${consult({ disposition: 'Admit', ward: 'Ward A' })}', '${meds}', '{}', '[]') r`,
      `select status from patients where id = '${PT(1)}'`)
    expect(r.read).toEqual([{ status: 'admitted' }])
  })

  it('saves nothing when any part fails (the defect: a saved consultation with no requests)', async () => {
    await db.exec('begin')
    try {
      // Make the last step (the thread message) fail.
      await db.exec(`create function fail_message() returns trigger language plpgsql as $$ begin raise exception 'message store down'; end $$;
                     create trigger fail_message before insert on patient_messages for each row execute function fail_message();`)
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: USERS[DOCTOR], email: DOCTOR, role: 'authenticated' })])
      await db.exec('set local role authenticated')
      await db.exec('savepoint s')
      await expect(db.query(`select complete_hospital_consultation('${PT(1)}', '${consult()}', '${meds}', '${lab}', '${imaging}')`)).rejects.toThrow(/message store down/)
      await db.exec('rollback to savepoint s')
      await db.exec('reset role')
      expect((await db.query(`select (select count(*)::int from consultations) c, (select count(*)::int from prescriptions) p,
        (select count(*)::int from lab_requests) l, (select count(*)::int from imaging_requests) i, (select status from patients where id = '${PT(1)}') s`)).rows)
        .toEqual([{ c: 1, p: 1, l: 1, i: 1, s: 'at_doctor' }])
    } finally { await db.exec('rollback') }
  })

  it('cannot be saved twice, needs a diagnosis, and is for the doctor only', async () => {
    await db.exec('begin')
    try {
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: USERS[DOCTOR], email: DOCTOR, role: 'authenticated' })])
      await db.exec('set local role authenticated')
      await db.query(`select complete_hospital_consultation('${PT(1)}', '${consult()}', '[]', '{}', '[]')`)
      await expect(db.query(`select complete_hospital_consultation('${PT(1)}', '${consult()}', '[]', '{}', '[]')`)).rejects.toThrow(/not waiting for the doctor \(discharged\)/)
    } finally { await db.exec('rollback') }
    expect((await as(DOCTOR, `select complete_hospital_consultation('${PT(1)}', '${consult({ primary_diagnosis: ' ' })}', '[]', '{}', '[]')`)).error).toMatch(/primary diagnosis/)
    expect((await as(DOCTOR, `select complete_hospital_consultation('${PT(1)}', '${consult({ disposition: 'Home' })}', '[]', '{}', '[]')`)).error).toMatch(/Unknown disposition/)
    expect((await as(NURSE, `select complete_hospital_consultation('${PT(1)}', '${consult()}', '[]', '{}', '[]')`)).error).toMatch(/Only a doctor/)
    expect((await as(STRANGER, `select complete_hospital_consultation('${PT(9)}', '${consult()}', '[]', '{}', '[]')`)).error).toMatch(/Only a doctor/)
  })
})

describe('dispense_prescription (Pharmacy)', () => {
  it('dispenses with who and when; discharges only when nothing else is pending', async () => {
    // Seed: Ada (at_doctor) has a pending lab request and imaging request. Put her at the pharmacy.
    await db.exec('begin')
    try {
      await db.exec(`update patients set status = 'at_pharmacy' where id = '${PT(1)}'`)
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: USERS[PHARMACIST], email: PHARMACIST, role: 'authenticated' })])
      await db.exec('set local role authenticated')
      const r = (await db.query(`select dispense_prescription('${RX}') r`)).rows[0].r
      expect(r).toEqual({ prescription_id: RX, dispensed_by: 'Phebe Pharm', discharged: false, patient_status: 'at_pharmacy' })
      await db.exec('reset role')
      expect((await db.query(`select status, dispensed_by, dispensed_at is not null at from prescriptions where id = '${RX}'`)).rows)
        .toEqual([{ status: 'dispensed', dispensed_by: 'Phebe Pharm', at: true }])
    } finally { await db.exec('rollback') }

    await db.exec('begin')
    try {
      await db.exec(`update patients set status = 'at_lab' where id = '${PT(1)}';
                     update lab_requests set status = 'completed' where id = '${LABREQ}'; update imaging_requests set status = 'completed' where id = '${IMG}';`)
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: USERS[PHARMACIST], email: PHARMACIST, role: 'authenticated' })])
      await db.exec('set local role authenticated')
      expect((await db.query(`select dispense_prescription('${RX}') r`)).rows[0].r).toMatchObject({ discharged: true, patient_status: 'discharged' })
      await expect(db.query(`select dispense_prescription('${RX}')`)).rejects.toThrow(/already been dispensed/)
    } finally { await db.exec('rollback') }
  })

  it('an admitted patient is not discharged by the pharmacy; only the pharmacy dispenses', async () => {
    await db.exec('begin')
    try {
      await db.exec(`update patients set status = 'admitted' where id = '${PT(1)}';
                     update lab_requests set status = 'completed'; update imaging_requests set status = 'completed';`)
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: USERS[PHARMACIST], email: PHARMACIST, role: 'authenticated' })])
      await db.exec('set local role authenticated')
      expect((await db.query(`select dispense_prescription('${RX}') r`)).rows[0].r).toMatchObject({ discharged: false, patient_status: 'admitted' })
    } finally { await db.exec('rollback') }
    expect((await as(DOCTOR, `select dispense_prescription('${RX}')`)).error).toMatch(/Only the pharmacy/)
    expect((await as(LABTECH, `select dispense_prescription('${RX}')`)).error).toMatch(/Only the pharmacy/)
  })
})
