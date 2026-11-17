import { describe, it, expect } from 'vitest'
import {
  asList, testName, patientNameOf, prescriptionLine, consultationPayload, consultationProblem, hospitalErrorMessage, VISIT_STATUS_LABEL,
  formFromClient, clientDetailsToSave, registrationProblem,
} from './index.js'

describe('Reception and the client record', () => {
  const ada = { id: 'c1', full_name: 'Ada Obi', phone: '0801 111 1111', date_of_birth: '1990-01-02', gender: 'Female', address: null,
    next_of_kin_name: 'Obi', next_of_kin_phone: null, insurance: 'NHIS', total_spend: 5000 }

  it('fills the form from a client, blanks for missing details', () => {
    expect(formFromClient(ada)).toEqual({ patName: 'Ada Obi', phone: '0801 111 1111', dob: '1990-01-02', gender: 'Female', address: '',
      nokName: 'Obi', nokPhone: '', insurance: 'NHIS' })
  })

  it('a new patient saves every filled detail', () => {
    expect(clientDetailsToSave({ patName: ' Chidi ', phone: '0812', gender: 'Male', address: '', insurance: 'None / Self-pay' }))
      .toEqual({ full_name: 'Chidi', phone: '0812', gender: 'Male', insurance: 'None / Self-pay' })
  })

  it('an existing client saves only what Reception changed, including a cleared field', () => {
    const form = { ...formFromClient(ada), insurance: 'Hygeia', nokName: '' }
    expect(clientDetailsToSave(form, ada)).toEqual({ insurance: 'Hygeia', next_of_kin_name: '' })
    expect(clientDetailsToSave(formFromClient(ada), ada)).toEqual({})
  })

  it('needs a name and a phone of 7 to 15 digits', () => {
    expect(registrationProblem({ patName: 'Ada', phone: '0801 111 1111' })).toBe('')
    expect(registrationProblem({ patName: ' ', phone: '0801' })).toMatch(/full name and phone/)
    expect(registrationProblem({ patName: 'Ada', phone: '0801' })).toMatch(/7 to 15 digits/)
  })
})

describe('asList (jsonb lists, old and new)', () => {
  it('reads a JSON array (live rows) and a JSON string of an array (rows the old screens wrote)', () => {
    expect(asList([{ name: 'FBC' }])).toEqual([{ name: 'FBC' }])
    expect(asList('[{"name":"FBC"}]')).toEqual([{ name: 'FBC' }])
  })

  it('reads anything else as empty instead of throwing (the Lab and Rx Inbox crashed on arrays)', () => {
    for (const v of [null, undefined, '', '  ', 'not json', '{"a":1}', 7, { a: 1 }]) expect(asList(v)).toEqual([])
  })
})

describe('names', () => {
  it('a test is { name } or a string', () => {
    expect(testName({ name: ' FBC ' })).toBe('FBC')
    expect(testName('Malaria RDT')).toBe('Malaria RDT')
    expect(testName(null)).toBe('')
  })

  it('a request shows the embedded patient, then the stored name, then "Patient"', () => {
    expect(patientNameOf({ patient: { full_name: 'Ada' }, patient_name: 'Old' })).toBe('Ada')
    expect(patientNameOf({ patient_name: 'Old' })).toBe('Old')
    expect(patientNameOf({})).toBe('Patient')
  })
})

describe('prescriptionLine', () => {
  it('keeps only the prescription fields: no cost price, stock or supplier from the catalogue product', () => {
    const product = { id: 'p1', name: 'Amoxicillin', generic_name: 'amoxicillin', cost_price: 120, price: 300, stock: 40, supplier: 'X', dose: '500mg', freq: 'TDS', dur: '5 days', route: 'Oral', instructions: '' }
    expect(prescriptionLine(product)).toEqual({ id: 'p1', name: 'Amoxicillin', generic_name: 'amoxicillin', dose: '500mg', freq: 'TDS', dur: '5 days', route: 'Oral', instructions: '' })
  })
})

describe('consultation payload and checks', () => {
  const form = {
    consult: { hpi: 'Fever', exam: 'Warm', dx1: ' Malaria ', dx2: '', disposition: 'Discharge', labPriority: 'urgent', labNotes: 'Fasting' },
    meds: [{ id: 'p1', name: 'Artemether', cost_price: 50, dose: '80mg' }],
    labTests: ['FBC', ' '],
    imagingRequests: [{ scan_type: 'X-ray', body_part: 'Chest' }, { scan_type: '' }],
    destinations: { pharmacy: true, lab: true, imaging: true },
  }

  it('maps the form to the function\'s arguments', () => {
    const p = consultationPayload(form)
    expect(p.consultation).toMatchObject({ hpi: 'Fever', examination: 'Warm', primary_diagnosis: 'Malaria', disposition: 'Discharge' })
    expect(p.medicines).toEqual([{ id: 'p1', name: 'Artemether', generic_name: '', dose: '80mg', freq: '', dur: '', route: '', instructions: '' }])
    expect(p.lab).toEqual({ tests: ['FBC'], priority: 'urgent', notes: 'Fasting' })
    expect(p.imaging).toEqual([{ scan_type: 'X-ray', body_part: 'Chest', clinical_info: '' }])
  })

  it('sends nothing to a destination the doctor did not tick', () => {
    const p = consultationPayload({ ...form, destinations: { pharmacy: true } })
    expect(p.lab).toEqual({ tests: [] })
    expect(p.imaging).toEqual([])
    expect(p.medicines).toHaveLength(1)
  })

  it('explains what is missing before sending', () => {
    expect(consultationProblem(form)).toBe('')
    expect(consultationProblem({ ...form, consult: { dx1: ' ' } })).toMatch(/primary diagnosis/)
    expect(consultationProblem({ ...form, destinations: {} })).toMatch(/at least one destination/)
    expect(consultationProblem({ ...form, meds: [] })).toMatch(/at least one medicine/)
    expect(consultationProblem({ ...form, labTests: [' '] })).toMatch(/at least one lab test/)
    expect(consultationProblem({ ...form, imagingRequests: [{ scan_type: '' }] })).toMatch(/scan type/)
  })
})

describe('hospitalErrorMessage', () => {
  it('shows the database functions\' own messages, without the transport prefix', () => {
    const e = new Error('Supabase error (400): This patient is not waiting for the doctor (at lab). Their consultation may already have been saved.')
    expect(hospitalErrorMessage(e, 'fallback')).toBe('This patient is not waiting for the doctor (at lab). Their consultation may already have been saved.')
    expect(hospitalErrorMessage(new Error('Supabase error (409): Another patient of this business already has that phone number. Search for them.'), 'x'))
      .toMatch(/^Another patient/)
    expect(hospitalErrorMessage(new Error('Session expired. Please log in again.'), 'x')).toBe('Session expired. Please log in again.')
  })

  it('never shows a raw database error', () => {
    const raw = new Error('Supabase error (400): column "patient_name" of relation "lab_requests" does not exist')
    expect(hospitalErrorMessage(raw, 'Could not save the consultation.')).toBe('Could not save the consultation.')
    expect(hospitalErrorMessage(new Error('Failed to fetch'), 'Check your connection.')).toBe('Check your connection.')
    expect(hospitalErrorMessage(undefined, 'x')).toBe('x')
  })

  it('labels every visit status the database can set', () => {
    for (const s of ['at_reception', 'at_triage', 'at_doctor', 'at_lab', 'at_pharmacy', 'admitted', 'referred', 'transferred', 'discharged']) {
      expect(VISIT_STATUS_LABEL[s]).toBeTruthy()
    }
  })
})
