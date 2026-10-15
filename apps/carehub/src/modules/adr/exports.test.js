import { describe, it, expect } from 'vitest'
import {
  buildE2bXml, buildPdfHtml, exportFilename,
  buildAdrCsv, buildBulkPdfHtml, buildAnalyticsHtml, E2B_FORMAT_NOTE,
  csvRowsFromCases,
} from './exports.js'
import { logBulkExport } from './pvWorkflow.js'

describe('logBulkExport', () => {
  it('logs one audited event per report and reports partial failures', async () => {
    const calls = []
    const logEvent = async (id, type, meta) => {
      calls.push({ id, type, meta })
      if (id === 'bad') throw new Error('denied')
      return { event_id: id }
    }
    const result = await logBulkExport(logEvent, ['a', 'bad', 'c'], { format: 'csv', filters: 'All' })
    expect(result).toEqual({ total: 3, failed: 1 })
    expect(calls[0].meta.batch).toBe(calls[2].meta.batch)
    expect(calls[0].type).toBe('exported')
  })
})

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

describe('phase7 export builders', () => {
  const csvRow = {
    report_number: 'ADR-1',
    report_source: 'public',
    status: 'submitted',
    reporter_name: 'Ada',
    reporter_phone: '0801',
    patient_identifier: 'AB',
    patient_age: 34,
    patient_gender: 'female',
    product_brand_name: 'Ampiclox',
    product_generic_name: '',
    batch_lot_number: '',
    reaction_description: 'Rash',
    severity: 'severe',
    outcome: 'recovering',
    serious: false,
  }

  it('buildAdrCsv escapes cells and masks reporter data in tracker mode', () => {
    const tricky = { ...csvRow, product_brand_name: 'Amp, "Complex"', reaction_description: 'Line one\nLine two' }
    const rows = buildAdrCsv([tricky], { includeReporter: false })
    expect(rows[0]).toContain('report_number')
    expect(rows[1]).not.toContain('Ada')
    expect(rows[1]).not.toContain('0801')
    expect(rows[1]).not.toContain('AB')
    expect(rows[1]).toContain('"Amp, ""Complex"""')
  })

  it('buildAdrCsv includes reporter context in hub mode', () => {
    const rows = buildAdrCsv([csvRow], { includeReporter: true })
    expect(rows[1]).toContain('Ada')
  })

  it('buildBulkPdfHtml covers counts, filters, timestamp and truncation', () => {
    const full = Array.from({ length: 5 }, (_, i) => ({
      report: { report_number: `ADR-${i}`, report_source: 'public', status: 'submitted', module_type: 'community_pharmacy' },
      products: [],
      meds: [],
      reactions: [],
    }))
    const doc = buildBulkPdfHtml({ cases: full, filtersLabel: 'All sources', orgName: 'Acme', cap: 3 })
    expect(doc).toContain('Acme')
    expect(doc).toMatch(/5 cases selected|of 5/i)
    expect(doc).toContain('All sources')
    expect(doc).toMatch(/truncat/i)
  })

  it('buildBulkPdfHtml states empty explicitly instead of crashing', () => {
    expect(buildBulkPdfHtml({ cases: [], filtersLabel: 'All', orgName: 'Acme', cap: 200 })).toMatch(/no cases/i)
  })

  it('buildAnalyticsHtml carries disclaimer, period, filters and denominators', () => {
    const doc = buildAnalyticsHtml({
      figures: { total: 7, serious: 2, outcomes: { recovering: 7 }, terms: [{ label: 'rash', count: 7, suppressed: false }] },
      filtersLabel: 'All',
      periodLabel: 'Last 6 months',
      orgName: 'Acme',
    })
    expect(doc).toMatch(/suspected/i)
    expect(doc).toContain('Last 6 months')
    expect(doc).toContain('Acme')
    expect(doc).toMatch(/n = 7/)
  })

  it('marks the E2B output as preparation-only with its format note', () => {
    expect(E2B_FORMAT_NOTE).toMatch(/preparation|not.*submission/i)
    const xml = buildE2bXml({ report: { ...baseReport }, products: [], reactions: [] })
    expect(xml).toContain('E2B')
  })

  it('csvRowsFromCases flattens one row per reaction with case columns repeated', () => {
    const rows = csvRowsFromCases([
      {
        report_number: 'ADR-1', report_source: 'public', status: 'submitted',
        patient_age: 34, patient_gender: 'female',
        adr_products: [{ product_brand_name: 'Ampiclox', batch_lot_number: 'L1' }],
        adr_reactions: [
          { reaction_description: 'Rash', severity: 'severe', outcome: 'recovering', seriousness_death: false, seriousness_life_threatening: false, seriousness_hospitalization: false, seriousness_disability: false, seriousness_congenital_anomaly: false, seriousness_other_medically_important: false },
          { reaction_description: 'Fever', severity: 'mild', outcome: 'recovered', seriousness_death: false, seriousness_life_threatening: false, seriousness_hospitalization: false, seriousness_disability: false, seriousness_congenital_anomaly: false, seriousness_other_medically_important: true },
        ],
      },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].product_brand_name).toBe('Ampiclox')
    expect(rows[0].serious).toBe(false)
    expect(rows[1].serious).toBe(true)
  })

  it('csvRowsFromCases keeps reaction-less cases as a single blank-reaction row', () => {
    const rows = csvRowsFromCases([{ report_number: 'ADR-9', status: 'draft', adr_products: [], adr_reactions: [] }])
    expect(rows).toHaveLength(1)
    expect(rows[0].reaction_description).toBe('')
  })
})

describe('buildPdfHtml report source', () => {
  it('prints the recorded report source on the NAFDAC document', () => {
    const pub = buildPdfHtml({ report: { ...baseReport, report_source: 'public' }, products: [], meds: [], reactions: [] })
    expect(pub).toContain('Public report')
    const unknown = buildPdfHtml({ report: { ...baseReport, report_source: 'unknown' }, products: [], meds: [], reactions: [] })
    expect(unknown).toMatch(/not recorded/i)
  })
})

