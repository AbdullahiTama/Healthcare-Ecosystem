import { 
  ADR_MODULE_TYPES, 
  REPORT_STATUS, 
  REACTION_SEVERITY, 
  REACTION_OUTCOME, 
  ACTION_TAKEN, 
  DECHALLENGE, 
  RECHALLENGE, 
  CAUSALITY, 
  REACTION_EXPECTED, 
  EVIDENCE_PHOTO_TYPE,
  QUALIFICATIONS,
  PATIENT_GENDER,
  PATIENT_AGE_GROUP
} from './types'
import { calculateDeadline, getDeadlineStatus, getModuleTypeFromBusinessType } from './services'

/**
 * Core validation service for ADR report submission.
 * This is the authoritative client-side gate - drafts may be incomplete, but
 * submission is only permitted when all gates pass. It is the client-side twin
 * of the server-side submit_adr_report RPC (see sql/20260818_adr_reports_phase1.sql);
 * the two must stay in lockstep.
 */

const SERIOUSNESS_FIELDS = [
  'seriousness_death',
  'seriousness_life_threatening',
  'seriousness_hospitalization',
  'seriousness_disability',
  'seriousness_congenital_anomaly',
  'seriousness_other_medically_important',
]

// The canonical submission validator, shared by both entry points below.
//
// Every gate records its gap twice: as a human-readable label in `missing`
// (the legacy shape, kept for backward compatibility) and as a structured
// { id, label } in `missingFields`. The ids are stable DOM anchors — the form
// page tags its inputs with matching data-adr-field attributes so a banner
// item can scroll to and focus the exact field it names.
function validateReportSubmit(report) {
  const missing = []
  const missingFields = []
  // flag() keeps the two lists in lockstep — never push to one without the
  // other. `missing` mirrors the server RPC's strings verbatim (the two must
  // stay interchangeable); a third argument overrides only the banner label
  // where the page needs to disambiguate same-named fields.
  function flag(id, label, bannerLabel) {
    missing.push(label)
    missingFields.push({ id, label: bannerLabel || label })
  }

  // 1. Reporter qualification must be set
  if (!report.reporter_qualification) {
    flag('reporter_qualification', 'Reporter qualification')
  }

  // 2. Reporter name or anonymous confirmation
  const hasName = report.reporter_name && report.reporter_name.trim().length > 0
  const anonymousConfirmed = report.reporter_anonymous_confirmed_by_facility === true

  if (!hasName && !anonymousConfirmed) {
    flag('reporter_name', 'Reporter name')
  }

  // 3. Reporter consent must be explicitly true or false
  if (report.reporter_consent_followup === undefined || report.reporter_consent_followup === null) {
    flag('reporter_consent_followup', 'Reporter consent for follow-up')
  }

  // 4. Patient identifier must be set
  if (!report.patient_identifier || report.patient_identifier.trim().length === 0) {
    flag('patient_identifier', 'Patient identifier')
  }

  // 5. At least one of patient_age, patient_dob, patient_age_group must be set.
  // Age is checked against null/undefined explicitly, NOT truthiness: 0 is a
  // valid age (neonate) and was previously flagged as missing.
  const hasPatientAge = report.patient_age !== null && report.patient_age !== undefined && String(report.patient_age).trim().length > 0
  const hasPatientDob = report.patient_dob && String(report.patient_dob).trim().length > 0
  const hasPatientAgeGroup = report.patient_age_group && String(report.patient_age_group).trim().length > 0

  if (!hasPatientAge && !hasPatientDob && !hasPatientAgeGroup) {
    flag('patient_age', 'Patient age or DOB or age group')
  }

  // 6. Patient gender must be set
  if (!report.patient_gender || !Object.values(PATIENT_GENDER).includes(report.patient_gender)) {
    flag('patient_gender', 'Patient gender')
  }

  // 7. At least one suspect product exists
  const hasProducts = report.adr_products && Array.isArray(report.adr_products) && report.adr_products.length > 0
  if (!hasProducts) {
    flag('products_section', 'At least one suspect product')
  }

  // 8. At least one product must have a brand name
  if (hasProducts) {
    const hasBrandName = report.adr_products.some(p => p.product_brand_name && p.product_brand_name.trim().length > 0)
    if (!hasBrandName) {
      flag('products_section', 'Product brand name')
    }
  }

  // 9. At least one reaction exists
  const hasReactions = report.adr_reactions && Array.isArray(report.adr_reactions) && report.adr_reactions.length > 0
  if (!hasReactions) {
    flag('reactions_section', 'At least one adverse reaction')
  }

  // 10. Reaction description must be set (at least one)
  if (hasReactions) {
    const hasReactionDesc = report.adr_reactions.some(r => r.reaction_description && r.reaction_description.trim().length > 0)
    if (!hasReactionDesc) {
      flag('reaction_description', 'Reaction description')
    }
  }

  // 11. Severity must be set (at least one)
  if (hasReactions) {
    const hasSeverity = report.adr_reactions.some(r => r.severity && Object.values(REACTION_SEVERITY).includes(r.severity))
    if (!hasSeverity) {
      flag('severity', 'Severity')
    }
  }

  // 12. All six seriousness fields must be non-null on at least one reaction
  if (hasReactions) {
    const complete = report.adr_reactions.some(r =>
      SERIOUSNESS_FIELDS.every(f => r[f] !== undefined && r[f] !== null)
    )
    if (!complete) {
      flag('seriousness_fields', 'All six seriousness fields')
    }
  }

  // 13. Outcome must be set (at least one)
  if (hasReactions) {
    const hasOutcome = report.adr_reactions.some(r => r.outcome && Object.values(REACTION_OUTCOME).includes(r.outcome))
    if (!hasOutcome) {
      flag('outcome', 'Outcome')
    }
  }

  // Industry-specific validation. The regulatory batch/causality anchors are
  // deliberately distinct from the per-product batch field and the per-reaction
  // causality field — same subject matter, different inputs on the page.
  if (report.module_type === ADR_MODULE_TYPES.INDUSTRY) {
    if (!report.batch_lot_number || report.batch_lot_number.trim().length === 0) {
      flag('regulatory_batch_lot_number', 'Batch/lot number', 'Batch/lot number (Regulatory details)')
    }
    if (!report.causality_assessment || !Object.values(CAUSALITY).includes(report.causality_assessment)) {
      flag('regulatory_causality_assessment', 'Causality assessment', 'Causality assessment (Regulatory details)')
    }
    if (!report.case_narrative_summary || report.case_narrative_summary.trim().length === 0) {
      flag('case_narrative_summary', 'Case narrative summary')
    }
  }

  // Hospital-specific validation
  if (report.module_type === ADR_MODULE_TYPES.HOSPITAL) {
    if (!report.ward_department || report.ward_department.trim().length === 0) {
      flag('ward_department', 'Ward/department')
    }
    if (!report.attending_physician || report.attending_physician.trim().length === 0) {
      flag('attending_physician', 'Attending physician')
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    missingFields,
  }
}

// Date and DB-CHECK enum keys on the child rows (products / reactions). The
// drafts hold '' while the form is empty; Postgres rejects '' for date columns
// and CHECK enums alike, so both families coerce to null before persistence.
const CHILD_DATE_KEYS = ['expiry_date', 'start_date', 'stop_date', 'onset_date']
const CHILD_ENUM_KEYS = ['severity', 'outcome', 'causality_assessment', 'action_taken', 'dechallenge_result', 'rechallenge_result']

/**
 * Normalises a child-row draft (suspect product / adverse reaction) for
 * persistence: blank strings on date and enum columns become null so the row
 * no longer trips the database CHECK constraints. Free-text columns are left
 * untouched ('' is valid there). Pure — returns a copy, never mutates.
 */
export function normalizeChildRow(row) {
  if (row === null || row === undefined || typeof row !== 'object') return row
  const out = { ...row }
  for (const key of [...CHILD_DATE_KEYS, ...CHILD_ENUM_KEYS]) {
    if (out[key] === '') out[key] = null
  }
  return out
}

export const adrValidation = {

  /**
   * Validates a report for submission.
   * Returns { valid: true } or { valid: false, missing: [...] }
   */
  async validateReportSubmit(report) {
    return validateReportSubmit(report)
  },

  /**
   * The name the form page calls. Delegates to the canonical validator so there
   * is exactly one gate, not two drift-prone copies.
   */
  async validateForSubmit(report) {
    return validateReportSubmit(report)
  },

  /**
   * Validates reporter data alone (for draft persistence check).
   * Does NOT block saving drafts - only submission validation.
   */
  validateReporterData(report) {
    const issues = []

    if (!report.reporter_qualification) {
      issues.push('Reporter qualification is required')
    }

    const hasName = report.reporter_name && report.reporter_name.trim().length > 0
    const anonymousConfirmed = report.reporter_anonymous_confirmed_by_facility === true

    if (!hasName && !anonymousConfirmed) {
      issues.push('Reporter name is required unless anonymous confirmed by facility')
    }

    if (report.reporter_consent_followup === undefined || report.reporter_consent_followup === null) {
      issues.push('Reporter consent for follow-up must be true or false')
    }

    // Nigerian phone validation if provided
    if (report.reporter_phone && !/^(?:\+?234|0)?[1-9][0-9]{8}$/.test(report.reporter_phone)) {
      issues.push('Invalid Nigerian phone number format')
    }

    // Email validation if provided
    if (report.reporter_email && !report.reporter_email.includes('@')) {
      issues.push('Valid reporter email required')
    }

    return { valid: issues.length === 0, issues }
  },

  /**
   * Validates patient data alone (for draft persistence check).
   * Does NOT block saving drafts - only submission validation.
   */
  validatePatientData(report) {
    const issues = []

    if (!report.patient_identifier || report.patient_identifier.trim().length === 0) {
      issues.push('Patient identifier is required')
    }

    // Same explicit null/undefined check as the submit gate: 0 is a valid age.
    const hasAge = report.patient_age !== null && report.patient_age !== undefined && String(report.patient_age).trim().length > 0
    const hasDob = report.patient_dob && String(report.patient_dob).trim().length > 0
    const hasAgeGroup = report.patient_age_group && Object.values(PATIENT_AGE_GROUP).includes(report.patient_age_group)

    if (!hasAge && !hasDob && !hasAgeGroup) {
      issues.push('Patient age or DOB or age group is required')
    }

    if (!report.patient_gender || !Object.values(PATIENT_GENDER).includes(report.patient_gender)) {
      issues.push('Patient gender is required')
    }

    return { valid: issues.length === 0, issues }
  },

  /**
   * Validates products data alone (for draft persistence check).
   * Does NOT block saving drafts - only submission validation.
   */
  validateProductsData(report) {
    const issues = []

    if (!report.adr_products || !Array.isArray(report.adr_products)) {
      return { valid: true, issues: [] } // drafts can be saved without products
    }

    // Check that at least one has a brand name (for submission)
    const hasBrandName = report.adr_products.some(p => p.product_brand_name && p.product_brand_name.trim().length > 0)
    if (!hasBrandName && report.adr_products.length > 0) {
      issues.push('At least one product must have a brand name')
    }

    return { valid: true, issues } // always valid for drafts
  },

  /**
   * Validates reactions data alone (for draft persistence check).
   * Does NOT block saving drafts - only submission validation.
   */
  validateReactionsData(report) {
    const issues = []

    if (!report.adr_reactions || !Array.isArray(report.adr_reactions)) {
      return { valid: true, issues: [] } // drafts can be saved without reactions
    }

    if (report.adr_reactions.length > 0) {
      // Check reaction description (for submission)
      const hasDesc = report.adr_reactions.some(r => r.reaction_description && r.reaction_description.trim().length > 0)
      if (!hasDesc) {
        issues.push('At least one reaction must have a description')
      }

      // Check severity (for submission)
      const hasSeverity = report.adr_reactions.some(r => r.severity && Object.values(REACTION_SEVERITY).includes(r.severity))
      if (!hasSeverity) {
        issues.push('Severity must be set')
      }

      // Check all six seriousness fields are non-null (for submission)
      const complete = report.adr_reactions.some(r =>
        SERIOUSNESS_FIELDS.every(f => r[f] !== undefined && r[f] !== null)
      )
      if (!complete) {
        issues.push('All six seriousness fields must be set')
      }

      // Check outcome (for submission)
      const hasOutcome = report.adr_reactions.some(r => r.outcome && Object.values(REACTION_OUTCOME).includes(r.outcome))
      if (!hasOutcome) {
        issues.push('Outcome must be set')
      }
    }

    return { valid: true, issues } // always valid for drafts
  },

  /**
   * Validates industry-specific fields.
   * Returns missing fields or empty array.
   */
  validateIndustryFields(report) {
    const issues = []

    if (!report.batch_lot_number || report.batch_lot_number.trim().length === 0) {
      issues.push('Batch/lot number')
    }
    if (!report.causality_assessment || !Object.values(CAUSALITY).includes(report.causality_assessment)) {
      issues.push('Causality assessment')
    }
    if (!report.case_narrative_summary || report.case_narrative_summary.trim().length === 0) {
      issues.push('Case narrative summary')
    }

    return issues
  },

  /**
   * Validates hospital-specific fields.
   * Returns missing fields or empty array.
   */
  validateHospitalFields(report) {
    const issues = []

    if (!report.ward_department || report.ward_department.trim().length === 0) {
      issues.push('Ward/department')
    }
    if (!report.attending_physician || report.attending_physician.trim().length === 0) {
      issues.push('Attending physician')
    }

    return issues
  },

  /**
   * Validates skincare-specific fields.
   * Returns missing fields or empty array.
   */
  validateSkincareFields(report) {
    const issues = []

    if (report.application_site && report.application_site.trim().length === 0) {
      issues.push('Application site')
    }
    if (report.cosmetic_reaction_type && !Object.values(REACTION_TYPE_SKINCARE).includes(report.cosmetic_reaction_type)) {
      issues.push('Cosmetic reaction type')
    }
    if (report.onset_timing && !ONSET_TIMING_SKINCARE.includes(report.onset_timing)) {
      issues.push('Onset timing')
    }
    if (report.discontinued_use === undefined) {
      issues.push('Discontinued use')
    }
    if (report.resolution_status && !Object.values(RESOLUTION_STATUS_SKINCARE).includes(report.resolution_status)) {
      issues.push('Resolution status')
    }

    return issues
  },

  /**
   * Computes the is_serious flag from the six seriousness booleans.
   * Serious if ANY reaction is serious — mirrors the RPC's bool_or across
   * every reaction row, not just the first.
   */
  computeIsSerious(reactions) {
    if (!reactions || reactions.length === 0) return false

    return reactions.some(r =>
      r.seriousness_death ||
      r.seriousness_life_threatening ||
      r.seriousness_hospitalization ||
      r.seriousness_disability ||
      r.seriousness_congenital_anomaly ||
      r.seriousness_other_medically_important
    )
  },

  /**
   * Computes the deadline based on the report data.
   */
  computeDeadline(reportCreatedAt, isSerious, reactionExpected, newSafetySignal) {
    return calculateDeadline(reportCreatedAt, isSerious, reactionExpected, newSafetySignal)
  },

  /**
   * Gets the deadline status string. Requires both the deadline and the report
   * creation time — the status is a percentage of the reporting window elapsed.
   */
  getDeadlineStatus(deadlineMs, createdAt) {
    return getDeadlineStatus(deadlineMs, createdAt)
  },

  /**
   * Gets the module type from business type.
   */
  getModuleType(businessType) {
    return getModuleTypeFromBusinessType(businessType)
  },
}

// Helper constants for skincare validation
const REACTION_TYPE_SKINCARE = {
  IRRITATION: 'irritation',
  ALLERGIC_CONTACT_DERMATITIS: 'allergic_contact_dermatitis',
  PHOTOSENSITIVITY: 'photosensitivity',
  BREAKOUT: 'breakout',
  OTHER: 'other',
}

const ONSET_TIMING_SKINCARE = ['immediate', 'delayed']

const REACTION_TYPE_LABELS_SKINCARE = {
  [REACTION_TYPE_SKINCARE.IRRITATION]: 'Irritation',
  [REACTION_TYPE_SKINCARE.ALLERGIC_CONTACT_DERMATITIS]: 'Allergic contact dermatitis',
  [REACTION_TYPE_SKINCARE.PHOTOSENSITIVITY]: 'Photosensitivity',
  [REACTION_TYPE_SKINCARE.BREAKOUT]: 'Breakout',
  [REACTION_TYPE_SKINCARE.OTHER]: 'Other',
}

const RESOLUTION_STATUS_SKINCARE = {
  RESOLVED: 'resolved',
  IMPROVING: 'improving',
  PERSISTENT: 'persistent',
  CHRONIC: 'chronic',
}

export default adrValidation