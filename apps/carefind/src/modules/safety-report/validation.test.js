import { describe, it, expect } from 'vitest'
import { validatePublicReport, answerToRow } from './validation.js'
import { STEPS } from './constants.js'

const SERIOUS_ALL_NO = {
  death: 'no',
  life_threatening: 'no',
  hospitalization: 'no',
  disability: 'no',
  congenital_anomaly: 'no',
  other_medically_important: 'no',
}

const validDraft = {
  reporter: {
    name: 'A. Reporter',
    qualification: 'consumer',
    phone: '08012345678',
    email: '',
    consentFollowup: true,
    anonymousConfirmed: false,
    facilityName: '',
  },
  patient: { identifier: 'AB', gender: 'female', age: '34', dob: '', ageGroup: '' },
  products: [{ brandName: 'Ampiclox', company: { kind: 'unknown' } }],
  reactions: [
    {
      description: 'Whole-body rash after two tablets',
      severity: 'moderate',
      outcome: 'recovering',
      seriousness: { ...SERIOUS_ALL_NO },
    },
  ],
  meds: [],
}

describe('validatePublicReport', () => {
  it('passes a valid basic report', () => {
    const result = validatePublicReport(validDraft)
    expect(result.valid).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('requires reporter qualification', () => {
    const result = validatePublicReport({ ...validDraft, reporter: { ...validDraft.reporter, qualification: '' } })
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('Reporter qualification')
  })

  it('requires reporter name without facility anonymity', () => {
    const result = validatePublicReport({ ...validDraft, reporter: { ...validDraft.reporter, name: '  ' } })
    expect(result.missing).toContain('Reporter name')
  })

  it('accepts facility anonymity with facility name and facility contact', () => {
    const reporter = {
      ...validDraft.reporter,
      name: '',
      phone: '08099999999',
      anonymousConfirmed: true,
      facilityName: 'Lagos Health Centre',
    }
    expect(validatePublicReport({ ...validDraft, reporter }).valid).toBe(true)
  })

  it('rejects facility anonymity without a facility name', () => {
    const reporter = { ...validDraft.reporter, name: '', anonymousConfirmed: true, facilityName: '' }
    expect(validatePublicReport({ ...validDraft, reporter }).missing).toContain('Reporter name')
  })

  it('requires a usable contact route (phone or email)', () => {
    const reporter = { ...validDraft.reporter, phone: '', email: '' }
    expect(validatePublicReport({ ...validDraft, reporter }).missing).toContain('Reporter phone or email')
  })

  it('accepts email alone as the contact route', () => {
    const reporter = { ...validDraft.reporter, phone: '', email: 'a@example.com' }
    expect(validatePublicReport({ ...validDraft, reporter }).valid).toBe(true)
  })

  it('rejects a malformed email as the contact route', () => {
    const reporter = { ...validDraft.reporter, phone: '', email: 'not-an-email' }
    expect(validatePublicReport({ ...validDraft, reporter }).missing).toContain('Reporter phone or email')
  })

  it('requires explicit follow-up consent (never inferred)', () => {
    const reporter = { ...validDraft.reporter, consentFollowup: null }
    const result = validatePublicReport({ ...validDraft, reporter })
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('Reporter consent for follow-up')
  })

  it('requires patient identifier, gender and an age descriptor', () => {
    expect(validatePublicReport({ ...validDraft, patient: { ...validDraft.patient, identifier: '' } }).missing)
      .toContain('Patient identifier')
    expect(validatePublicReport({ ...validDraft, patient: { ...validDraft.patient, gender: '' } }).missing)
      .toContain('Patient gender')
    expect(validatePublicReport({ ...validDraft, patient: { ...validDraft.patient, age: '', dob: '', ageGroup: '' } }).missing)
      .toContain('Patient age or DOB or age group')
  })

  it('accepts age group alone as the age descriptor', () => {
    const patient = { ...validDraft.patient, age: '', dob: '', ageGroup: 'adult' }
    expect(validatePublicReport({ ...validDraft, patient }).valid).toBe(true)
  })

  it('requires at least one suspect product with a brand name', () => {
    expect(validatePublicReport({ ...validDraft, products: [] }).missing)
      .toContain('At least one suspect product')
    expect(validatePublicReport({ ...validDraft, products: [{ brandName: '  ' }] }).missing)
      .toContain('Product brand name')
  })

  it('requires a reaction description, severity and outcome', () => {
    const base = validDraft.reactions[0]
    expect(validatePublicReport({ ...validDraft, reactions: [] }).missing)
      .toContain('At least one adverse reaction')
    expect(validatePublicReport({ ...validDraft, reactions: [{ ...base, description: '' }] }).missing)
      .toContain('Reaction description')
    expect(validatePublicReport({ ...validDraft, reactions: [{ ...base, severity: '' }] }).missing)
      .toContain('Severity')
    expect(validatePublicReport({ ...validDraft, reactions: [{ ...base, outcome: '' }] }).missing)
      .toContain('Outcome')
  })

  it('requires all six seriousness answers', () => {
    const seriousness = { ...SERIOUS_ALL_NO, disability: '' }
    const reactions = [{ ...validDraft.reactions[0], seriousness }]
    expect(validatePublicReport({ ...validDraft, reactions }).missing).toContain('Seriousness answers')
  })

  it('keeps Not-sure distinct from No (never coerced)', () => {
    const seriousness = { ...SERIOUS_ALL_NO, hospitalization: 'not_sure' }
    const result = validatePublicReport({
      ...validDraft,
      reactions: [{ ...validDraft.reactions[0], seriousness }],
    })
    expect(result.valid).toBe(true)
    const row = answerToRow(seriousness)
    expect(row.seriousness_hospitalization).toBe(false)
    expect(row.seriousness_unknown).toContain('hospitalization')
  })

  it('maps yes to true and records no Not-sure entries', () => {
    const row = answerToRow({ ...SERIOUS_ALL_NO, death: 'yes' })
    expect(row.seriousness_death).toBe(true)
    expect(row.seriousness_unknown).toEqual([])
  })

  it('returns step anchors for edit links', () => {
    const result = validatePublicReport({ ...validDraft, products: [] })
    const ids = result.missingFields.map((f) => f.step)
    expect(ids).toContain(STEPS.PRODUCTS)
  })
})
