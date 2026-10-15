import { STEPS, SERIOUSNESS_KEYS } from './constants.js'

// ── Public safety-report validator (CareFind, Phase 2) ─────────────────────
// Client twin of submit_adr_public_report (shared ICSR core + public extras).
// Returns { valid, missing, missingFields }; missing strings mirror the RPC
// where they overlap so server errors map onto the same step anchors.

const EMAIL_RE = /^\S+@\S+\.\S+$/

function blank(value) {
  return value === null || value === undefined || String(value).trim().length === 0
}

// Maps one ternary seriousness answer set onto a reaction row:
// yes -> true, no -> false, not_sure -> false + listed in seriousness_unknown
// (stored distinctly; never silently converted to No).
export function answerToRow(seriousness = {}) {
  const row = { seriousness_unknown: [] }
  for (const key of SERIOUSNESS_KEYS) {
    const column = `seriousness_${key}`
    if (seriousness[key] === 'yes') {
      row[column] = true
    } else {
      row[column] = false
      if (seriousness[key] === 'not_sure') row.seriousness_unknown.push(key)
    }
  }
  return row
}

function hasUsableContact(reporter) {
  if (!blank(reporter.phone)) return true
  return !blank(reporter.email) && EMAIL_RE.test(String(reporter.email).trim())
}

export function validatePublicReport(draft = {}) {
  const missing = []
  const missingFields = []
  const flag = (step, label) => {
    missing.push(label)
    missingFields.push({ step, label })
  }

  const reporter = draft.reporter || {}
  const patient = draft.patient || {}
  const products = Array.isArray(draft.products) ? draft.products : []
  const reactions = Array.isArray(draft.reactions) ? draft.reactions : []

  if (blank(reporter.qualification)) flag(STEPS.REPORTER, 'Reporter qualification')

  const anonymousOk =
    reporter.anonymousConfirmed === true && !blank(reporter.facilityName)
  if (blank(reporter.name) && !anonymousOk) flag(STEPS.REPORTER, 'Reporter name')

  if (reporter.consentFollowup !== true && reporter.consentFollowup !== false) {
    flag(STEPS.REPORTER, 'Reporter consent for follow-up')
  }

  if (!hasUsableContact(reporter)) flag(STEPS.REPORTER, 'Reporter phone or email')

  if (blank(patient.identifier)) flag(STEPS.PATIENT, 'Patient identifier')
  if (blank(patient.gender)) flag(STEPS.PATIENT, 'Patient gender')
  if (blank(patient.age) && blank(patient.dob) && blank(patient.ageGroup)) {
    flag(STEPS.PATIENT, 'Patient age or DOB or age group')
  }

  if (products.length === 0) {
    flag(STEPS.PRODUCTS, 'At least one suspect product')
  } else if (!products.some((p) => p && !blank(p.brandName))) {
    flag(STEPS.PRODUCTS, 'Product brand name')
  }

  if (reactions.length === 0) {
    flag(STEPS.REACTIONS, 'At least one adverse reaction')
  } else {
    if (!reactions.some((r) => r && !blank(r.description))) flag(STEPS.REACTIONS, 'Reaction description')
    if (!reactions.some((r) => r && !blank(r.severity))) flag(STEPS.REACTIONS, 'Severity')
    if (!reactions.some((r) => r && !blank(r.outcome))) flag(STEPS.REACTIONS, 'Outcome')
    const answered = reactions.some(
      (r) =>
        r &&
        r.seriousness &&
        SERIOUSNESS_KEYS.every((k) => ['yes', 'no', 'not_sure'].includes(r.seriousness[k]))
    )
    if (!answered) flag(STEPS.REACTIONS, 'Seriousness answers')
  }

  return { valid: missing.length === 0, missing, missingFields }
}

// Same normalization the server applies to manual candidate text.
export function normalizeCompanyName(name) {
  if (name === null || name === undefined) return ''
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase()
}

export function buildRouteKey({ reportId, productId, kind, businessId = '', candidateName = '' } = {}) {
  const normCandidate = kind === 'unverified_candidate' ? normalizeCompanyName(candidateName) : ''
  const normBusiness = kind === 'verified' ? String(businessId || '').toLowerCase() : ''
  return [reportId, productId, kind, normBusiness, normCandidate].join(':')
}
