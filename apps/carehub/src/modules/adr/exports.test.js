import { describe, it, expect } from 'vitest'
import { buildE2bXml, buildPdfHtml, exportFilename } from './exports.js'

const baseReport = {
  report_id: 'r1',
  report_number: 'ADR-2026-000001',
  module_type: 'industry',
  status: 'submitted',
  reporter_name: 'Ade Bello',
  reporter_qualification: 'pharmacist',
  reporter_facility_name: 'Bello Pharma Ltd',
  reporter_phone: '+2348012345678',
  reporter_email: 'ade@example.com',
  reporter_license_number: 'L-1234',
  reporter_consent_followup: true,
  patient_identifier: 'JS',
  patient_age: 45,
  patient_gender: 'female',
  patient_medical_history: 'Asthma',
  batch_lot_number: 'LOT-1',
  causality_assessment: 'probable_likely',
  case_narrative_summary: 'Patient experienced rash after dose.',
  submission_deadline: '2026-01-16T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
}

const baseProduct = {
  product_id: 'p1',
  product_brand_name: 'Ampiclox',
  product_generic_name: 'Ampicillin',
  batch_lot_number: 'LOT-A1',
  dose: '500mg',
  frequency: '3x daily',
  route: 'Oral',
  start_date: '2025-12-20',
  stop_date: '2025-12-22',
  indication: 'Infection',
}

const baseReaction = {
  reaction_id: 'rx1',
  reaction_description: 'Anaphylaxis',
  onset_date: '2025-12-22',
  severity: 'severe',
  outcome: 'recovered',
  seriousness_death: false,
  seriousness_life_threatening: true,
  seriousness_hospitalization: false,
  seriousness_disability: false,
  seriousness_congenital_anomaly: false,
  seriousness_other_medically_important: false,
}

describe('buildE2bXml', () => {
  it('returns empty string for a null report', () => {
    expect(buildE2bXml({ report: null })).toBe('')
  })

  it('produces well-formed XML with a message header and safety report', () => {
    const xml = buildE2bXml({ report: baseReport, products: [baseProduct], reactions: [baseReaction] })
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<ichicsr>')
    expect(xml).toContain('<ichicsrmessageheader>')
    expect(xml).toContain('<safetyreport>')
    expect(xml).toContain('<receiveridentifier>NAFDAC</receiveridentifier>')
    expect(xml).toContain('<safetyreportid>ADR-2026-000001</safetyreportid>')
    // Every opened element is closed (structural well-formedness check).
    expect((xml.match(/<reaction>/g) || []).length).toBe((xml.match(/<\/reaction>/g) || []).length)
    expect((xml.match(/<drug>/g) || []).length).toBe((xml.match(/<\/drug>/g) || []).length)
    expect(xml.endsWith('</ichicsr>\n')).toBe(true)
  })

  it('maps the E2B coded values (sex, outcome, qualification)', () => {
    const xml = buildE2bXml({ report: baseReport, products: [baseProduct], reactions: [baseReaction] })
    expect(xml).toContain('<patientsex>1</patientsex>') // female
    expect(xml).toContain('<reactionoutcome>1</reactionoutcome>') // recovered
    expect(xml).toContain('<qualification>2</qualification>') // pharmacist
  })

  it('marks a report serious when any reaction is serious', () => {
    const xml = buildE2bXml({ report: baseReport, products: [baseProduct], reactions: [baseReaction] })
    expect(xml).toContain('<serious>1</serious>')
    expect(xml).toContain('<seriousnesslifethreatening>1</seriousnesslifethreatening>')

    const nonSerious = buildE2bXml({
      report: baseReport,
      products: [baseProduct],
      reactions: [{ ...baseReaction, seriousness_life_threatening: false }],
    })
    expect(nonSerious).toContain('<serious>2</serious>')
    expect(nonSerious).not.toContain('<seriousnesslifethreatening>')
  })

  it('escapes user content so XML cannot be broken', () => {
    const xml = buildE2bXml({
      report: { ...baseReport, patient_medical_history: 'History <script>alert(1)</script> & notes' },
      products: [baseProduct],
      reactions: [{ ...baseReaction, reaction_description: 'Rash < & itch' }],
    })
    expect(xml).toContain('History &lt;script&gt;alert(1)&lt;/script&gt; &amp; notes')
    expect(xml).toContain('Rash &lt; &amp; itch')
    expect(xml).not.toContain('<script>')
  })

  it('omits unknown optional elements instead of emitting empties', () => {
    const xml = buildE2bXml({
      report: { ...baseReport, patient_dob: null, patient_medical_history: '' },
      products: [],
      reactions: [{ ...baseReaction, onset_date: '' }],
    })
    expect(xml).not.toContain('<patientbirthdate>')
    expect(xml).not.toContain('<patientmedicalhistory>')
    expect(xml).not.toContain('<reactionfirsttime>')
    expect(xml).not.toContain('<drug>')
  })
})

describe('buildPdfHtml', () => {
  it('returns empty string for a null report', () => {
    expect(buildPdfHtml({ report: null })).toBe('')
  })

  it('is a printable document including report number and module title', () => {
    const html = buildPdfHtml({ report: baseReport, products: [baseProduct], reactions: [baseReaction] })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('ADR-2026 Report #000001')
    expect(html).toContain('Industry')
    expect(html).toContain('Regulatory details')
  })

  it('includes the hospital clinical section for hospital reports', () => {
    const html = buildPdfHtml({
      report: { ...baseReport, module_type: 'hospital', ward_department: 'Ward 4', attending_physician: 'Dr Okon' },
      products: [baseProduct],
      reactions: [baseReaction],
    })
    expect(html).toContain('Clinical details')
    expect(html).toContain('Ward 4')
    expect(html).toContain('Dr Okon')
  })

  it('includes the skincare cosmetic section for skincare reports', () => {
    const html = buildPdfHtml({
      report: { ...baseReport, module_type: 'skincare', application_site: 'Face', resolution_status: 'resolved' },
      products: [baseProduct],
      reactions: [baseReaction],
    })
    expect(html).toContain('Cosmetic details')
    expect(html).toContain('Face')
  })

  it('escapes HTML in user content', () => {
    const html = buildPdfHtml({
      report: { ...baseReport, reporter_name: '<b>X</b>' },
      products: [baseProduct],
      reactions: [baseReaction],
    })
    expect(html).not.toContain('<b>X</b>')
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;')
  })
})

describe('exportFilename', () => {
  it('sanitizes the report number into a safe filename', () => {
    expect(exportFilename({ report_number: 'ADR-2026-000001' }, 'xml')).toBe('ADR-2026-000001.xml')
    expect(exportFilename({ report_id: 'r/1' }, 'xml')).toBe('r-1.xml')
    expect(exportFilename({}, 'xml')).toBe('adr-report.xml')
  })
})
