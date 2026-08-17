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

/**
 * Core validation service for ADR report submission.
 * This is the authoritative gate - client-side UI may allow incomplete drafts,
 * but submission is only permitted when all gates pass.
 */
export const adrValidation = {

  /**
   * Validates a report for submission.
   * Returns { valid: true } or { valid: false, missing: [...] }
   */
  async validateReportSubmit(report) {
    const missing = []

    // 1. Reporter qualification must be set
    if (!report.reporter_qualification) {
      missing.push('Reporter qualification')
    }

    // 2. Reporter name or anonymous confirmation
    const hasName = report.reporter_name && report.reporter_name.trim().length > 0
    const hasContact = report.reporter_phone && report.reporter_phone.trim().length > 0
    const hasEmail = report.reporter_email && report.reporter_email.trim().length > 0
    const licenseSet = report.reporter_license_number && report.reporter_license_number.trim().length > 0
    const anonymousConfirmed = report.reporter_anonymous_confirmed_by_facility === true

    if (!hasName && !anonymousConfirmed) {
      missing.push('Reporter name')
    }

    // If anonymous, facility confirmation must be true
    if (report.reporter_anonymous_confirmed_by_facility === true && !hasName) {
      // OK - name can be blank when anonymous confirmed by facility
    } else if (!hasName) {
      missing.push('Reporter name')
    }

    // 3. Reporter consent must be explicitly true or false
    if (report.reporter_consent_followup === undefined || report.reporter_consent_followup === null) {
      missing.push('Reporter consent for follow-up')
    }

    // 4. Patient identifier must be set
    if (!report.patient_identifier || report.patient_identifier.trim().length === 0) {
      missing.push('Patient identifier')
    }

    // 5. At least one of patient_age, patient_dob, patient_age_group must be set
    const hasPatientAge = report.patient_age && String(report.patient_age).trim().length > 0
    const hasPatientDob = report.patient_dob && String(report.patient_dob).trim().length > 0
    const hasPatientAgeGroup = report.patient_age_group && PATIENT_AGE_GROUP[report.patient_age_group] ? true : (report.patient_age_group && String(report.patient_age_group).trim().length > 0)

    if (!hasPatientAge && !hasPatientDob && !hasPatientAgeGroup) {
      missing.push('Patient age or DOB or age group')
    }

    // 6. Patient gender must be set
    if (!report.patient_gender || !PATIENT_GENDER[report.patient_gender]) {
      missing.push('Patient gender')
    }

    // 7. At least one suspect product exists
    const hasProducts = report.adr_products && Array.isArray(report.adr_products) && report.adr_products.length > 0
    if (!hasProducts) {
      missing.push('At least one suspect product')
    }

    // 8. At least one product must have a brand name
    if (hasProducts) {
      const hasBrandName = report.adr_products.some(p => p.product_brand_name && p.product_brand_name.trim().length > 0)
      if (!hasBrandName) {
        missing.push('Product brand name')
      }
    }

    // 9. At least one reaction exists
    const hasReactions = report.adr_reactions && Array.isArray(report.adr_reactions) && report.adr_reactions.length > 0
    if (!hasReactions) {
      missing.push('At least one adverse reaction')
    }

    // 10. Reaction description must be set (at least one)
    if (hasReactions) {
      const hasReactionDesc = report.adr_reactions.some(r => r.reaction_description && r.reaction_description.trim().length > 0)
      if (!hasReactionDesc) {
        missing.push('Reaction description')
      }
    }

    // 11. Severity must be set (at least one)
    if (hasReactions) {
      const hasSeverity = report.adr_reactions.some(r => r.severity && REACTION_SEVERITY[r.severity])
      if (!hasSeverity) {
        missing.push('Severity')
      }
    }

    // 12. All six seriousness fields must be non-null
    if (hasReactions) {
      const seriousnessFields = [
        'seriousness_death',
        'seriousness_life_threatening',
        'seriousness_hospitalization',
        'seriousness_disability',
        'seriousness_congenital_anomaly',
        'seriousness_other_medically_important'
      ]

      for (const field of seriousnessFields) {
        if (report.adr_reactions[0][field] === undefined || report.adr_reactions[0][field] === null) {
          missing.push(field.replace('seriousness_', 'Seriousness '))
        }
      }
    }

    // 13. Outcome must be set
    if (hasReactions) {
      const hasOutcome = report.adr_reactions[0].outcome && REACTION_OUTCOME[report.adr_reactions[0].outcome]
      if (!hasOutcome) {
        missing.push('Outcome')
      }
    }

    // Industry-specific validation
    if (report.module_type === ADR_MODULE_TYPES.INDUSTRY) {
      if (!report.batch_lot_number || report.batch_lot_number.trim().length === 0) {
        missing.push('Batch/lot number')
      }
      if (!report.causality_assessment || !CAUSALITY[report.causality_assessment]) {
        missing.push('Causality assessment')
      }
      if (!report.case_narrative_summary || report.case_narrative_summary.trim().length === 0) {
        missing.push('Case narrative summary')
      }
    }

    return {
      valid: missing.length === 0,
      missing,
    }
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
    if (report.reporter_phone && !NIGERIAN_PHONE_REGEX.test(reporter.reporter_phone)) {
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

    const hasAge = report.patient_age && String(report.patient_age).trim().length > 0
    const hasDob = report.patient_dob && String(report.patient_dob).trim().length > 0
    const hasAgeGroup = report.patient_age_group && PATIENT_AGE_GROUP[report.patient_age_group]

    if (!hasAge && !hasDob && !hasAgeGroup) {
      issues.push('Patient age or DOB or age group is required')
    }

    if (!report.patient_gender || !PATIENT_GENDER[report.patient_gender]) {
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
      issues.push('Products data is required')
      return { valid: true, issues: [] } // drafts can be saved without products
    }

    if (report.adr_products.length === 0) {
      // This is OK for drafts, but will block submission
      // issues.push('At least one suspect product is required')
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
      issues.push('Reactions data is required')
      return { valid: true, issues: [] } // drafts can be saved without reactions
    }

    if (report.adr_reactions.length === 0) {
      // OK for drafts
    }

    // Check reaction description (for submission)
    if (report.adr_reactions.length > 0) {
      const hasDesc = report.adr_reactions.some(r => r.reaction_description && r.reaction_description.trim().length > 0)
      if (!hasDesc) {
        issues.push('At least one reaction must have a description')
      }
    }

    // Check severity (for submission)
    if (report.adr_reactions.length > 0) {
      const hasSeverity = report.adr_reactions.some(r => r.severity && REACTION_SEVERITY[r.severity])
      if (!hasSeverity) {
        issues.push('Severity must be set')
      }
    }

    // Check all six seriousness fields are non-null (for submission)
    if (report.adr_reactions.length > 0) {
      const seriousnessFields = [
        'seriousness_death',
        'seriousness_life_threatening',
        'seriousness_hospitalization',
        'seriousness_disability',
        'seriousness_congenital_anomaly',
        'seriousness_other_medically_important'
      ]

      for (const field of seriousnessFields) {
        if (report.adr_reactions[0][field] === undefined || report.adr_reactions[0][field] === null) {
          issues.push(`Seriousness: ${field.replace('seriousness_', '')}`)
        }
      }
    }

    // Check outcome (for submission)
    if (report.adr_reactions.length > 0) {
      const hasOutcome = report.adr_reactions[0].outcome && REACTION_OUTCOME[report.adr_reactions[0].outcome]
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
    if (!report.causality_assessment || !CAUSALITY[report.causality_assessment]) {
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

    // Hospital fields are optional for drafts, but may be required for submission
    // based on the specification. For now, we note which are present.
    if (report.ward_department && report.ward_department.trim().length === 0) {
      issues.push('Ward/department')
    }
    if (report.attending_physician && report.attending_physician.trim().length === 0) {
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
   * Prefers deriving it rather than requiring user input.
   */
  computeIsSerious(reactions) {
    if (!reactions || reactions.length === 0) return false

    const r = reactions[0]
    return r.seriousness_death ||
      r.seriousness_life_threatening ||
      r.seriousness_hospitalization ||
      r.seriousness_disability ||
      r.seriousness_congenital_anomaly ||
      r.seriousness_other_medically_important
  },

  /**
   * Computes the deadline based on the report data.
   */
  computeDeadline(reportCreatedAt, isSerious, reactionExpected, newSafetySignal) {
    return calculateDeadline(reportCreatedAt, isSerious, reactionExpected, newSafetySignal)
  },

  /**
   * Gets the deadline status string.
   */
  getDeadlineStatus(deadlineMs) {
    return getDeadlineStatus(deadlineMs)
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
  PHOTOSensitivity: 'photosensitivity',
  BREAKOUT: 'breakout',
  OTHER: 'other',
}

const ONSET_TIMING_SKINCARE = ['immediate', 'delayed']

const REACTION_TYPE_LABELS_SKINCARE = {
  [REACTION_TYPE_SKINCARE.IRRITATION]: 'Irritation',
  [REACTION_TYPE_SKINCARE.ALLERGIC_CONTACT_DERMATITIS]: 'Allergic contact dermatitis',
  [REACTION_TYPE_SKINCARE.PHOTOSensitivity]: 'Photosensitivity',
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