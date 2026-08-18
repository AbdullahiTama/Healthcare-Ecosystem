import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { adrValidation } from './validation.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const completeReaction = {
  reaction_description: 'Anaphylaxis',
  severity: 'severe',
  outcome: 'recovered',
  seriousness_death: false,
  seriousness_life_threatening: true,
  seriousness_hospitalization: false,
  seriousness_disability: false,
  seriousness_congenital_anomaly: false,
  seriousness_other_medically_important: false,
}

const completeProduct = { product_brand_name: 'Ampiclox', product_generic_name: 'Ampicillin' }

// A fully valid report — every Section 7 gate passes.
const validReport = {
  module_type: 'community_pharmacy',
  reporter_qualification: 'pharmacist',
  reporter_name: 'A. Pharmacist',
  reporter_anonymous_confirmed_by_facility: false,
  reporter_consent_followup: true,
  patient_identifier: 'JS',
  patient_age: 45,
  patient_gender: 'female',
  adr_products: [completeProduct],
  adr_reactions: [completeReaction],
}

describe('adrValidation.validateForSubmit', () => {
  it('passes a fully valid report', async () => {
    const result = await adrValidation.validateForSubmit(validReport)
    expect(result.valid).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('requires reporter qualification', async () => {
    const result = await adrValidation.validateForSubmit({ ...validReport, reporter_qualification: '' })
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('Reporter qualification')
  })

  it('accepts a blank reporter name when anonymity is confirmed by the facility', async () => {
    const result = await adrValidation.validateForSubmit({
      ...validReport,
      reporter_name: '',
      reporter_anonymous_confirmed_by_facility: true,
    })
    expect(result.valid).toBe(true)
  })

  it('requires reporter name unless anonymity is confirmed', async () => {
    const result = await adrValidation.validateForSubmit({ ...validReport, reporter_name: '' })
    expect(result.missing).toContain('Reporter name')
  })

  it('requires explicit reporter consent for follow-up', async () => {
    const result = await adrValidation.validateForSubmit({ ...validReport, reporter_consent_followup: null })
    expect(result.missing).toContain('Reporter consent for follow-up')
  })

  it('requires patient identifier', async () => {
    const result = await adrValidation.validateForSubmit({ ...validReport, patient_identifier: '' })
    expect(result.missing).toContain('Patient identifier')
  })

  it('accepts DOB or age group when age is missing', async () => {
    const byDob = await adrValidation.validateForSubmit({ ...validReport, patient_age: null, patient_dob: '1990-01-01' })
    const byGroup = await adrValidation.validateForSubmit({ ...validReport, patient_age: null, patient_age_group: 'adult' })
    expect(byDob.valid).toBe(true)
    expect(byGroup.valid).toBe(true)
  })

  it('requires age, DOB or age group', async () => {
    const result = await adrValidation.validateForSubmit({ ...validReport, patient_age: null })
    expect(result.missing).toContain('Patient age or DOB or age group')
  })

  it('requires a valid patient gender', async () => {
    const result = await adrValidation.validateForSubmit({ ...validReport, patient_gender: 'other' })
    expect(result.missing).toContain('Patient gender')
  })

  it('requires at least one suspect product and one with a brand name', async () => {
    const none = await adrValidation.validateForSubmit({ ...validReport, adr_products: [] })
    expect(none.missing).toContain('At least one suspect product')

    const noBrand = await adrValidation.validateForSubmit({ ...validReport, adr_products: [{ product_generic_name: 'Generic only' }] })
    expect(noBrand.missing).toContain('Product brand name')
  })

  it('requires at least one reaction with description, severity and outcome', async () => {
    const none = await adrValidation.validateForSubmit({ ...validReport, adr_reactions: [] })
    expect(none.missing).toContain('At least one adverse reaction')

    const incomplete = await adrValidation.validateForSubmit({ ...validReport, adr_reactions: [{ reaction_description: 'Rash' }] })
    expect(incomplete.missing).toContain('Severity')
    expect(incomplete.missing).toContain('Outcome')
    expect(incomplete.missing).toContain('All six seriousness fields')
  })

  it('requires all six seriousness fields non-null on at least one reaction', async () => {
    const withNulls = await adrValidation.validateForSubmit({
      ...validReport,
      adr_reactions: [{ ...completeReaction, seriousness_other_medically_important: null }],
    })
    expect(withNulls.missing).toContain('All six seriousness fields')
  })

  it('enforces industry-specific gates for industry module type', async () => {
    const base = { ...validReport, module_type: 'industry' }
    const result = await adrValidation.validateForSubmit(base)
    expect(result.missing).toEqual(expect.arrayContaining(['Batch/lot number', 'Causality assessment', 'Case narrative summary']))

    const full = await adrValidation.validateForSubmit({
      ...base,
      batch_lot_number: 'LOT-1',
      causality_assessment: 'probable_likely',
      case_narrative_summary: 'Narrative',
    })
    expect(full.valid).toBe(true)
  })

  it('does not enforce industry gates for other module types', async () => {
    const result = await adrValidation.validateForSubmit(validReport)
    expect(result.missing).not.toContain('Batch/lot number')
    expect(result.missing).not.toContain('Causality assessment')
    expect(result.missing).not.toContain('Case narrative summary')
  })

  it('enforces hospital-specific gates for hospital module type', async () => {
    const base = { ...validReport, module_type: 'hospital' }
    const result = await adrValidation.validateForSubmit(base)
    expect(result.missing).toEqual(expect.arrayContaining(['Ward/department', 'Attending physician']))

    const full = await adrValidation.validateForSubmit({
      ...base,
      ward_department: 'Ward 4',
      attending_physician: 'Dr. Okon',
    })
    expect(full.valid).toBe(true)
  })

  it('does not enforce hospital gates for other module types', async () => {
    const result = await adrValidation.validateForSubmit(validReport)
    expect(result.missing).not.toContain('Ward/department')
    expect(result.missing).not.toContain('Attending physician')
  })
})

describe('adrValidation.validateHospitalFields', () => {
  it('flags missing or blank mandatory fields', () => {
    expect(adrValidation.validateHospitalFields({})).toEqual(['Ward/department', 'Attending physician'])
    expect(adrValidation.validateHospitalFields({ ward_department: '', attending_physician: '   ' }))
      .toEqual(['Ward/department', 'Attending physician'])
  })

  it('passes when both mandatory fields are present', () => {
    expect(adrValidation.validateHospitalFields({ ward_department: 'Ward 4', attending_physician: 'Dr. Okon' })).toEqual([])
  })
})

describe('adrValidation.computeIsSerious', () => {
  it('is false when no reactions exist', () => {
    expect(adrValidation.computeIsSerious([])).toBe(false)
    expect(adrValidation.computeIsSerious(null)).toBe(false)
  })

  it('is true when ANY reaction is serious', () => {
    const reactions = [
      { ...completeReaction, seriousness_death: false, seriousness_life_threatening: false, seriousness_hospitalization: false, seriousness_disability: false, seriousness_congenital_anomaly: false, seriousness_other_medically_important: false },
      { ...completeReaction, seriousness_hospitalization: true },
    ]
    expect(adrValidation.computeIsSerious(reactions)).toBe(true)
  })

  it('is false when every reaction is non-serious', () => {
    const reactions = [{ ...completeReaction, seriousness_death: false, seriousness_life_threatening: false, seriousness_hospitalization: false, seriousness_disability: false, seriousness_congenital_anomaly: false, seriousness_other_medically_important: false }]
    expect(adrValidation.computeIsSerious(reactions)).toBe(false)
  })
})

describe('deadline rules (Section 6 table)', () => {
  const base = new Date('2026-01-01T00:00:00Z').getTime()

  it('industry new safety signal forces +3 days regardless of seriousness', () => {
    expect(adrValidation.computeDeadline(base, true, false, true).getTime()).toBe(base + 3 * DAY)
    expect(adrValidation.computeDeadline(base, false, true, true).getTime()).toBe(base + 3 * DAY)
  })

  it('serious + unexpected = +72 hours', () => {
    expect(adrValidation.computeDeadline(base, true, false, false).getTime()).toBe(base + 72 * HOUR)
  })

  it('serious + expected = +15 days', () => {
    expect(adrValidation.computeDeadline(base, true, true, false).getTime()).toBe(base + 15 * DAY)
  })

  it('non-serious + unexpected = +15 days', () => {
    expect(adrValidation.computeDeadline(base, false, false, false).getTime()).toBe(base + 15 * DAY)
  })

  it('non-serious + expected = +90 days', () => {
    expect(adrValidation.computeDeadline(base, false, true, false).getTime()).toBe(base + 90 * DAY)
  })
})

describe('deadline status thresholds (percentage of window remaining)', () => {
  const createdAt = new Date('2026-01-01T00:00:00Z')
  const window = 10 * DAY // 10-day reporting window
  const deadline = new Date(createdAt.getTime() + window)

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('overdue once the deadline passes', () => {
    vi.setSystemTime(deadline.getTime() + HOUR)
    expect(adrValidation.getDeadlineStatus(deadline, createdAt)).toBe('overdue')
  })

  it('overdue below 20% of the window remaining', () => {
    vi.setSystemTime(createdAt.getTime() + 0.9 * window) // 10% remaining
    expect(adrValidation.getDeadlineStatus(deadline, createdAt)).toBe('overdue')
  })

  it('due_soon between 20% and 50% remaining', () => {
    vi.setSystemTime(createdAt.getTime() + 0.6 * window) // 40% remaining
    expect(adrValidation.getDeadlineStatus(deadline, createdAt)).toBe('due_soon')
  })

  it('on_track above 50% remaining', () => {
    vi.setSystemTime(createdAt.getTime() + 0.1 * window) // 90% remaining
    expect(adrValidation.getDeadlineStatus(deadline, createdAt)).toBe('on_track')
  })
})