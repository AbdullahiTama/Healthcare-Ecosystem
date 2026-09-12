import { ADR_FORM } from './formEngine'
import {
  ADR_MODULE_TYPES,
  ACTION_TAKEN_LABELS,
  CAUSALITY_LABELS,
  DECHALLENGE_LABELS,
  QUALIFICATION_LABELS,
  REACTION_OUTCOME_LABELS,
  REACTION_SEVERITY_LABELS,
  RECHALLENGE_LABELS,
  PATIENT_GENDER_LABELS,
  PATIENT_AGE_GROUP_LABELS,
} from './types'

/**
 * ADR export services (Phase 2, Item 2).
 *
 * Two transports, both pure and unit-testable:
 *  - NAFDAC PDF: a self-contained printable HTML document (browser print ->
 *    Save as PDF). Used by pharmacy / hospital / skincare.
 *  - E2B XML: an ICH E2B-flavoured XML message for the industry module.
 *
 * The DOM-only steps (opening the print window, downloading a file) are kept
 * behind two tiny wrappers so every builder stays testable in isolation.
 */

// ── XML helpers ───────────────────────────────────────────────────────────────

function xmlEscape(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ISO-8601 date (YYYY-MM-DD) for E2B date elements; falls back to the raw value.
function isoDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toISOString().slice(0, 10)
}

function isoDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toISOString()
}

// E2B coded values — patient sex (0 unknown / 1 female / 2 male)
const E2B_SEX = { male: '2', female: '1', unknown: '0' }

// E2B reaction outcome codes (1 recovered ... 6 unknown)
const E2B_OUTCOME = {
  recovered: '1',
  recovering: '2',
  not_recovered: '3',
  recovered_with_sequelae: '4',
  fatal: '5',
  unknown: '6',
}

// E2B reporter qualification codes (1 physician ... 6 other)
const E2B_QUALIFICATION = {
  physician: '1',
  pharmacist: '2',
  nurse: '3',
  other_hcp: '3',
  lawyer: '4',
  consumer: '5',
  caregiver: '5',
}

// Emits a single XML element, escaping content. Empty/unknown values are
// omitted entirely — E2B only requires elements you actually know.
function tag(name, content) {
  if (content === undefined || content === null || content === '') return ''
  return `  <${name}>${xmlEscape(content)}</${name}>\n`
}

// ── E2B XML (industry) ─────────────────────────────────────────────────────────

/**
 * Builds an ICH E2B-flavoured XML message for an ICSR. Never throws on missing
 * data — optional elements are simply omitted, matching the E2B "send only what
 * you know" rule. Never emits unescaped user content.
 */
export function buildE2bXml({ report, products = [], reactions = [] }) {
  if (!report) return ''

  const seriousFlags = reactions.reduce((acc, r) => {
    acc.seriousnessdeath = acc.seriousnessdeath || !!r.seriousness_death
    acc.seriousnesslifethreatening = acc.seriousnesslifethreatening || !!r.seriousness_life_threatening
    acc.seriousnesshospitalization = acc.seriousnesshospitalization || !!r.seriousness_hospitalization
    acc.seriousnessdisabling = acc.seriousnessdisabling || !!r.seriousness_disability
    acc.seriousnesscongenitalanomali = acc.seriousnesscongenitalanomali || !!r.seriousness_congenital_anomaly
    acc.seriousnessother = acc.seriousnessother || !!r.seriousness_other_medically_important
    return acc
  }, {})
  const serious = Object.values(seriousFlags).some(Boolean)

  const nameParts = (report.patient_identifier || '').split(/\s+/).filter(Boolean)
  const reporterParts = (report.reporter_name || '').split(/\s+/).filter(Boolean)

  const reactionXml = reactions
    .map(r => {
      const relatedness = report.causality_assessment
        ? CAUSALITY_LABELS[report.causality_assessment]
        : r.causality_assessment
          ? CAUSALITY_LABELS[r.causality_assessment]
          : ''
      return (
        `  <reaction>\n` +
        tag('primarysourcereaction', r.reaction_description) +
        tag('reactionmeddrapt', r.reaction_description) +
        tag('reactionoutcome', E2B_OUTCOME[r.outcome]) +
        tag('reactionfirsttime', isoDate(r.onset_date)) +
        tag('reactionlasttime', isoDate(r.onset_date)) +
        tag('reactionrelatedness', relatedness) +
        `  </reaction>\n`
      )
    })
    .join('')

  const drugXml = products
    .map(p =>
      `  <drug>\n` +
      tag('drugcharacterization', '1') +
      tag('medicinalproduct', p.product_brand_name) +
      tag('drugbatchnumb', p.batch_lot_number) +
      tag('drugdosagetext', [p.dose, p.frequency].filter(Boolean).join(' ')) +
      tag('drugadministrationroute', p.route) +
      tag('drugstartdate', isoDate(p.start_date)) +
      tag('drugenddate', isoDate(p.stop_date)) +
      tag('drugindication', p.indication) +
      tag('drugrecurreadministration', p.rechallenge_result ? RECHALLENGE_LABELS[p.rechallenge_result] : '') +
      tag('drugreactionrelatedness', p.causality_assessment ? CAUSALITY_LABELS[p.causality_assessment] : '') +
      `  </drug>\n`
    )
    .join('')

  const medicalHistory = report.patient_medical_history
    ? `  <patientmedicalhistory>\n${tag('medicalhistorytext', report.patient_medical_history)}  </patientmedicalhistory>\n`
    : ''

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ichicsr>\n` +
    `  <ichicsrmessageheader>\n` +
    tag('messagetype', 'ICSR') +
    tag('messageformatversion', '3.0') +
    tag('messagenumber', report.report_number || report.report_id) +
    tag('messageformat', 'ICHICSR') +
    tag('senderidentifier', report.reporter_facility_name || report.reporter_name || 'CareHub') +
    tag('receiveridentifier', 'NAFDAC') +
    tag('datecreated', isoDateTime(new Date())) +
    `  </ichicsrmessageheader>\n` +
    `  <ichicsrbody>\n` +
    `    <safetyreport>\n` +
    tag('safetyreportversion', report.follow_up_version_number || '1') +
    tag('safetyreportid', report.report_number || report.report_id) +
    tag('reporttype', '1') +
    tag('reportduedate', isoDate(report.submission_deadline)) +
    tag('serious', serious ? '1' : '2') +
    Object.entries(seriousFlags)
      .filter(([, v]) => v)
      .map(([k]) => tag(k, '1'))
      .join('') +
    `      <primarysource>\n` +
    tag('reportergivenname', reporterParts[0]) +
    tag('reporterfamilyname', reporterParts.slice(1).join(' ')) +
    tag('reporterorganization', report.reporter_facility_name) +
    tag('reportercountry', 'NG') +
    tag('qualification', E2B_QUALIFICATION[report.reporter_qualification]) +
    `      </primarysource>\n` +
    `      <sender>\n` +
    tag('senderidentifier', report.reporter_facility_name || 'CareHub') +
    tag('sendertype', '1') +
    `      </sender>\n` +
    `      <patient>\n` +
    (nameParts.length > 0
      ? `        <patientname>\n` +
        tag('patientgivenname', nameParts[0]) +
        (nameParts.length > 1 ? tag('patientfamilyname', nameParts.slice(1).join(' ')) : '') +
        `        </patientname>\n`
      : '') +
    tag('patientinitial', report.patient_identifier) +
    tag('patientbirthdate', isoDate(report.patient_dob)) +
    tag('patientage', report.patient_age != null ? String(report.patient_age) : '') +
    tag('patientagegroup', report.patient_age_group) +
    tag('patientsex', E2B_SEX[report.patient_gender]) +
    medicalHistory +
    reactionXml +
    drugXml +
    `      </patient>\n` +
    `    </safetyreport>\n` +
    `  </ichicsrbody>\n` +
    `</ichicsr>\n`
  )
}

// ── NAFDAC PDF (print HTML) ───────────────────────────────────────────────────

function row(name, value) {
  if (value === undefined || value === null || value === '') return ''
  const safe = String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<tr><th>${name}</th><td>${safe}</td></tr>`
}

function fmtExportDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * Builds a self-contained HTML document formatted for NAFDAC submission. The
 * browser's Print -> Save as PDF is the delivery mechanism (no server renderer
 * is involved). Module-aware: includes the industry / skincare / hospital
 * detail sections that apply to the report's module type.
 */
export function buildPdfHtml({ report, products = [], meds = [], reactions = [], reactionExpected = null }) {
  if (!report) return ''

  const moduleType = report.module_type || ADR_MODULE_TYPES.COMMUNITY_PHARMACY
  const isIndustry = moduleType === ADR_MODULE_TYPES.INDUSTRY
  const isSkincare = moduleType === ADR_MODULE_TYPES.SKINCARE
  const isHospital = moduleType === ADR_MODULE_TYPES.HOSPITAL
  const terminology = ADR_FORM.getTerminology(moduleType)

  const seriousnessOf = r =>
    ['seriousness_death', 'seriousness_life_threatening', 'seriousness_hospitalization',
      'seriousness_disability', 'seriousness_congenital_anomaly', 'seriousness_other_medically_important']
      .filter(k => r[k])
      .map(k => k.replace(/^seriousness_/, '').replace(/_/g, ' '))
      .join(', ')

  const reactionsHtml = reactions.length === 0
    ? '<p>None recorded</p>'
    : reactions.map(r => (
        `<table>${row('Reaction', r.reaction_description)}${row('Onset', r.onset_date)}${row('Duration', r.duration)}` +
        `${row('Severity', r.severity && REACTION_SEVERITY_LABELS[r.severity])}${row('Outcome', r.outcome && REACTION_OUTCOME_LABELS[r.outcome])}` +
        `${row('Action taken', r.action_taken && ACTION_TAKEN_LABELS[r.action_taken])}${row('Causality', r.causality_assessment && CAUSALITY_LABELS[r.causality_assessment])}` +
        `${row('De-challenge', r.dechallenge_result && DECHALLENGE_LABELS[r.dechallenge_result])}${row('Re-challenge', r.rechallenge_result && RECHALLENGE_LABELS[r.rechallenge_result])}` +
        `${row('Seriousness', seriousnessOf(r))}</table>`
      )).join('')

  const productsHtml = products.length === 0
    ? '<p>None recorded</p>'
    : products.map(p => (
        `<table>${row('Brand', p.product_brand_name)}${row('Generic', p.product_generic_name)}${row('Manufacturer', p.manufacturer)}` +
        `${row('Batch/lot', p.batch_lot_number)}${row('Expiry', p.expiry_date)}${row('Dose', p.dose)}${row('Route', p.route)}${row('Indication', p.indication)}</table>`
      )).join('')

  const medsHtml = meds.length === 0
    ? '<p>None recorded</p>'
    : `<table>${meds.map(m => `<tr><th>${m.name}</th><td>${m.dose || ''}</td></tr>`).join('')}</table>`

  const expectedHtml = reactionExpected === null
    ? ''
    : row('Expected / Unexpected', reactionExpected ? 'Expected' : 'Unexpected')

  const industryHtml = isIndustry
    ? `<div class="section"><h2>Regulatory details</h2><table>${row('Batch/lot', report.batch_lot_number)}${row('Causality', report.causality_assessment && CAUSALITY_LABELS[report.causality_assessment])}${row('Naranjo', report.naranjo_score)}${row('Case narrative', report.case_narrative_summary)}${row('Distribution notes', report.distribution_batch_trace_notes)}${row('New safety signal', report.new_safety_signal ? 'Yes' : 'No')}</table></div>`
    : ''

  const skincareHtml = isSkincare
    ? `<div class="section"><h2>Cosmetic details</h2><table>${row('Application site', report.application_site)}${row('Reaction type', report.cosmetic_reaction_type)}${row('Onset timing', report.onset_timing)}${row('Resolution status', report.resolution_status)}${row('Discontinued use', report.discontinued_use === null ? '' : report.discontinued_use ? 'Yes' : 'No')}</table></div>`
    : ''

  const hospitalHtml = isHospital
    ? `<div class="section"><h2>Clinical details</h2><table>${row('Ward/department', report.ward_department)}${row('Attending physician', report.attending_physician)}${row('Lab investigation notes', report.lab_investigation_notes)}${row('Comorbidities', report.comorbidities)}${row('ICU admission', report.icu_admission ? 'Yes' : 'No')}${row('Treatment given', report.treatment_given_for_reaction)}${row('Lab attachment', report.lab_attachment_url)}${row('Discharge summary', report.discharge_summary_attachment_url)}</table></div>`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"><title>${ADR_FORM.formatReportNumber(report.report_number)}</title>
    <style>
      body { font-family: Georgia, serif; color: #182722; margin: 40px; line-height: 1.5; }
      h1 { font-size: 20px; margin: 0 0 4px; } .meta { color: #8B978F; font-size: 12px; margin-bottom: 24px; }
      h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #0E6F5A; margin: 28px 0 8px; border-bottom: 1px solid #ECEAE0; padding-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; width: 210px; color: #5B6B63; font-weight: 600; vertical-align: top; padding: 3px 0; }
      td { vertical-align: top; padding: 3px 0; }
      .section { page-break-inside: avoid; }
    </style></head><body>
    <h1>${ADR_FORM.formatReportNumber(report.report_number)}</h1>
    <div class="meta">${ADR_FORM.getModuleTitle(moduleType)} · Status: ${ADR_FORM.getStatusLabel(report.status)} · Generated ${new Date().toLocaleString('en-NG')}</div>

    <div class="section"><h2>Reporter</h2><table>
      ${row('Name', report.reporter_name)}${row('Qualification', report.reporter_qualification && QUALIFICATION_LABELS[report.reporter_qualification])}
      ${row('Facility', report.reporter_facility_name)}${row('Phone', report.reporter_phone)}${row('Email', report.reporter_email)}
      ${row('License', report.reporter_license_number)}</table></div>

    <div class="section"><h2>Patient</h2><table>
      ${row('Identifier', report.patient_identifier)}${row('Age', report.patient_age)}
      ${row('DOB', report.patient_dob)}${row('Age group', report.patient_age_group && PATIENT_AGE_GROUP_LABELS[report.patient_age_group])}
      ${row('Gender', report.patient_gender && PATIENT_GENDER_LABELS[report.patient_gender])}${row('Weight (kg)', report.patient_weight_kg)}
      ${row('Medical history', report.patient_medical_history)}</table></div>

    <div class="section"><h2>Suspect products</h2>${productsHtml}</div>

    <div class="section"><h2>Concomitant medications</h2>${medsHtml}</div>

    <div class="section"><h2>${terminology.adrLabel}</h2>
      <table>${expectedHtml}</table>
      ${reactionsHtml}</div>

    ${industryHtml}${skincareHtml}${hospitalHtml}

    <div class="section"><h2>Deadline</h2><table>${row('Submission deadline', fmtExportDate(report.submission_deadline))}</table></div>
    </body></html>`
}

// ── DOM wrappers (used by the form page; kept tiny so builders stay pure) ────

/** Opens the printable document in a new window and triggers the print dialog. */
export function openPrintView(html) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 300)
  return true
}

/** Triggers a browser download for a generated file (e.g. the E2B XML). */
export function downloadTextFile(filename, content, mimeType = 'application/xml') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Builds a safe filename for an export from the report number. */
export function exportFilename(report, ext) {
  const base = (report.report_number || report.report_id || 'adr-report').replace(/[^A-Za-z0-9._-]/g, '-')
  return `${base}.${ext}`
}

