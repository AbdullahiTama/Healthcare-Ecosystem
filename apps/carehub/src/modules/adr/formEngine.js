import { ADR_MODULE_TYPES, ADR_MODULE_TYPE_LABELS, REPORT_STATUS, REACTION_SEVERITY, REACTION_OUTCOME, ACTION_TAKEN, DECHALLENGE, RECHALLENGE, CAUSALITY, REACTION_EXPECTED, EVIDENCE_PHOTO_TYPE, QUALIFICATIONS, PATIENT_GENDER, PATIENT_AGE_GROUP } from './types'
import { getDeadlineStatus } from './services'
import { adrValidation } from './validation'

/**
 * Shared ADR form engine - controls presentation and validation logic
 * used by all four module types (community_pharmacy, hospital, industry, skincare)
 *
 * Conceptual structure:
 * ADRForm
 *   ├── ReporterSection
 *   ├── PatientSection
 *   ├── ProductsSection
 *   ├── ConcomitantMedsSection
 *   ├── ReactionsSection
 *   ├── ActionCausalitySection
 *   ├── EvidenceSection
 *   └── ModuleSpecificSection
 */

export const ADR_FORM = {

  /**
   * Get the module type from a business type.
   * The existing CareHub business_type determines the ADR presentation.
   */
  getModuleType(businessType) {
    const typeMap = {
      pharmacy: ADR_MODULE_TYPES.COMMUNITY_PHARMACY,
      hospital: ADR_MODULE_TYPES.HOSPITAL,
      industry: ADR_MODULE_TYPES.INDUSTRY,
      skincare: ADR_MODULE_TYPES.SKINCARE,
    }
    return typeMap[businessType] || ADR_MODULE_TYPES.COMMUNITY_PHARMACY
  },

  /**
   * Get the business type label for display.
   */
  getBusinessTypeLabel(businessType) {
    const labels = {
      skincare: 'Skincare / Aesthetic Spa',
      pharmacy: 'Community Pharmacy',
      hospital: 'Hospital / Clinic',
      dental: 'Dental Clinic',
      optical: 'Optical / Eye Clinic',
      wellness: 'Wellness & Nutrition Center',
      manufacturer_importer: 'Manufacturer / Importer',
      wholesale: 'Wholesale / Distributor',
    }
    return labels[businessType] || 'Healthcare'
  },

  /**
   * Get initial visible sections for the given module type.
   * Controls progressive disclosure.
   */
  getInitialVisibleSections(moduleType) {
    switch (moduleType) {
      case ADR_MODULE_TYPES.COMMUNITY_PHARMACY:
        return ['reporter', 'patient', 'products', 'reactions', 'evidence']
      case ADR_MODULE_TYPES.HOSPITAL:
        return ['reporter', 'patient', 'products', 'concomitant', 'reactions', 'evidence', 'hospitalDetails']
      case ADR_MODULE_TYPES.INDUSTRY:
        return ['reporter', 'patient', 'products', 'concomitant', 'reactions', 'actionCausality', 'evidence', 'industryDetails']
      case ADR_MODULE_TYPES.SKINCARE:
        return ['reporter', 'patient', 'products', 'reactions', 'evidence', 'cosmeticDetails']
      default:
        return ['reporter', 'patient', 'products', 'reactions', 'evidence']
    }
  },

  /**
   * Get module-specific section title.
   */
  getModuleSectionTitle(moduleType) {
    switch (moduleType) {
      case ADR_MODULE_TYPES.COMMUNITY_PHARMACY:
        return 'Core details'
      case ADR_MODULE_TYPES.HOSPITAL:
        return 'Clinical details'
      case ADR_MODULE_TYPES.INDUSTRY:
        return 'Regulatory details'
      case ADR_MODULE_TYPES.SKINCARE:
        return 'Cosmetic details'
      default:
        return 'Details'
    }
  },

  /**
   * Get module-specific fields configuration.
   * Each module type defines which additional fields are shown/hidden.
   */
  getModuleConfig(moduleType) {
    switch (moduleType) {
      case ADR_MODULE_TYPES.COMMUNITY_PHARMACY:
        return this.communityPharmacyConfig()
      case ADR_MODULE_TYPES.HOSPITAL:
        return this.hospitalConfig()
      case ADR_MODULE_TYPES.INDUSTRY:
        return this.industryConfig()
      case ADR_MODULE_TYPES.SKINCARE:
        return this.skincareConfig()
      default:
        return this.communityPharmacyConfig()
    }
  },

  communityPharmacyConfig() {
    return {
      showExportNAFDAC: true,
      hideAdvanced: false,
      // Community pharmacy shows all core fields by default,
      // with "Add more detail (optional)" expander for extra fields
      additionalFields: {
        batchLotNumber: { show: false, mandatory: false },
        caseNarrative: { show: false, mandatory: false },
        naranjoScore: { show: false, mandatory: false },
      },
    }
  },

  hospitalConfig() {
    return {
      showAllClinicalDetails: true,
      fields: {
        wardDepartment: { mandatory: true },
        attendingPhysician: { mandatory: true },
        labInvestigationNotes: { mandatory: false },
        labAttachments: { mandatory: false, type: 'file' },
        comorbidities: { mandatory: false },
        icuAdmission: { mandatory: false },
        treatmentGivenForReaction: { mandatory: false },
        dischargeSummaryAttachment: { mandatory: false, type: 'file' },
      },
    }
  },

  industryConfig() {
    return {
      makeBatchLotMandatory: true,
      makeCausalityMandatory: true,
      makeCaseNarrativeMandatory: true,
      followUpVersionNumberAutoIncrement: true,
      deadlineCountdown: true,
      visualStates: {
        green: '>50% time remaining',
        amber: '20-50% time remaining',
        red: '<20% remaining or overdue',
      },
      fields: {
        batch_lot_number: { mandatory: true },
        causality_assessment: { mandatory: true },
        case_narrative_summary: { mandatory: true },
        naranjo_score: { mandatory: false },
        follow_up_version_number: { mandatory: true, autoIncrement: true },
        distribution_batch_trace_notes: { mandatory: false },
        new_safety_signal: { mandatory: false },
      },
    }
  },

  skincareConfig() {
    return {
      // Terminology: "Adverse Drug Reaction" -> "Adverse Cosmetic Event"
      terminology: {
        adrLabel: 'Adverse Cosmetic Event',
        adrDescriptionLabel: 'Adverse Cosmetic Event Description',
      },
      fields: {
        applicationSite: { mandatory: true },
        cosmeticReactionType: { mandatory: true },
        onsetTiming: { mandatory: true },
        discontinuedUse: { mandatory: true },
        resolutionStatus: { mandatory: true },
      },
    }
  },

  /**
   * Get the terminology for the module type.
   * Skincare changes "Adverse Drug Reaction" to "Adverse Cosmetic Event".
   */
  getTerminology(moduleType) {
    if (moduleType === ADR_MODULE_TYPES.SKINCARE) {
      return {
        adrLabel: 'Adverse Cosmetic Event',
        adrDescription: 'Adverse Cosmetic Event description',
        submitButton: 'Submit Cosmetic Event Report',
        exportButton: 'Export for NAFDAC',
      }
    }
    return {
      adrLabel: 'Adverse Drug Reaction',
      adrDescription: 'Adverse Drug Reaction description',
      submitButton: 'Submit ADR Report',
      exportButton: 'Export for NAFDAC',
    }
  },

  /**
   * Get the NAFDAC export configuration for the module type.
   */
  getExportConfig(moduleType) {
    return {
      [ADR_MODULE_TYPES.COMMUNITY_PHARMACY]: {
        format: 'pdf',
        title: 'NAFDAC ADR Export - Community Pharmacy',
        include: ['reporter', 'patient', 'products', 'reactions', 'seriousness', 'outcome', 'action', 'causality'],
      },
      [ADR_MODULE_TYPES.HOSPITAL]: {
        format: 'pdf',
        title: 'NAFDAC ADR Export - Hospital',
        include: ['reporter', 'patient', 'products', 'concomitant', 'reactions', 'seriousness', 'outcome', 'action', 'causality', 'hospitalDetails'],
      },
      [ADR_MODULE_TYPES.INDUSTRY]: {
        format: 'xml',
        title: 'E2B XML Export - Industry',
        include: ['allFields'],
        e2bVersion: 'configurable',
      },
      [ADR_MODULE_TYPES.SKINCARE]: {
        format: 'pdf',
        title: 'NAFDAC Cosmetic Event Export - Skincare',
        include: ['reporter', 'patient', 'products', 'reactions', 'seriousness', 'outcome', 'action', 'causality', 'cosmeticDetails'],
      },
    }[moduleType] || this.getExportConfig(ADR_MODULE_TYPES.COMMUNITY_PHARMACY)
  },

  /**
   * Check if a module type requires batch_lot_number to be mandatory.
   */
  isBatchLotMandatory(moduleType) {
    return moduleType === ADR_MODULE_TYPES.INDUSTRY
  },

  /**
   * Check if a module type requires causality_assessment to be mandatory.
   */
  isCausalityMandatory(moduleType) {
    return moduleType === ADR_MODULE_TYPES.INDUSTRY
  },

  /**
   * Check if a module type requires case_narrative_summary to be mandatory.
   */
  isCaseNarrativeMandatory(moduleType) {
    return moduleType === ADR_MODULE_TYPES.INDUSTRY
  },

  /**
   * Get Naranjo score field visibility.
   * Optional for industry, not used for other types.
   */
  getNaranjoVisibility(moduleType) {
    return moduleType === ADR_MODULE_TYPES.INDUSTRY ? 'optional' : 'hidden'
  },

  /**
   * Get follow-up version number configuration.
   * Must increment within a follow-up chain for industry.
   */
  getFollowUpConfig(moduleType) {
    if (moduleType === ADR_MODULE_TYPES.INDUSTRY) {
      return {
        autoIncrement: true,
        chainRelationship: 'follow_up_of_report_id',
        shouldNotOverwriteHistory: true,
      }
    }
    return { autoIncrement: false, chainRelationship: null, shouldNotOverwriteHistory: true }
  },

  /**
   * Get evidence photo type configuration.
   */
  getEvidencePhotoConfig(moduleType) {
    const baseConfig = {
      types: ['product', 'patient_effect', 'other'],
      labels: {
        product: 'Product photo',
        patient_effect: 'Patient effect photo',
        other: 'Other',
      },
      mobileCamera: true,
      desktopUpload: true,
      maxPhotos: 10,
    }

    if (moduleType === ADR_MODULE_TYPES.SKINCARE) {
      return {
        ...baseConfig,
        prominentlyEncouraged: true,
        // Skincare encourages evidence photos more strongly
        minPhotosRequired: 0, // Never required
      }
    }

    if (moduleType === ADR_MODULE_TYPES.INDUSTRY) {
      return {
        ...baseConfig,
        // Industry photos are separate from lab/discharge attachments
        separateFromLabDischarge: true,
      }
    }

    if (moduleType === ADR_MODULE_TYPES.HOSPITAL) {
      return {
        ...baseConfig,
        separateFromLabDischarge: true,
      }
    }

    // Community pharmacy
    return baseConfig
  },

  /**
   * Get the deadline engine inputs for the module type.
   */
  getDeadlineInputs(moduleType, reportCreatedAt, isSerious, reactionExpected, newSafetySignal) {
    return {
      is_serious: isSerious,
      reaction_expected: reactionExpected,
      new_safety_signal: newSafetySignal,
      report_created_at: reportCreatedAt,
      module_type: moduleType,
    }
  },

  /**
   * Get the module title for display.
   */
  getModuleTitle(moduleType) {
    return ADR_MODULE_TYPE_LABELS[moduleType] || moduleType || 'ADR Report'
  },

  /**
   * Compute deadline status string. Percentage-of-window based, matching the
   * shared service (on_track / due_soon / overdue).
   */
  computeDeadlineStatus(deadlineMs, createdAt) {
    return getDeadlineStatus(deadlineMs, createdAt)
  },

  /**
   * Get deadline status color/token reuse existing design system tokens.
   * Reuse existing semantic tokens rather than hard-coding colors.
   */
  getDeadlineStatusToken(status) {
    const tokens = {
      on_track: 'success',
      due_soon: 'warning',
      overdue: 'danger',
    }
    return tokens[status] || 'gray600'
  },

  /**
   * Validate a report is ready for submission.
   * Centralized validation - client UI may allow incomplete drafts,
   * but this gate prevents submission when ICSR validation fails.
   * Delegates to adrValidation — the single authoritative gate.
   */
  async validateForSubmit(report) {
    return adrValidation.validateForSubmit(report)
  },

  getSkincareReactionTypes() {
    return {
      irritation: 'irritation',
      allergic_contact_dermatitis: 'allergic_contact_dermatitis',
      photosensitivity: 'photosensitivity',
      breakout: 'breakout',
      other: 'other',
    }
  },

  /**
   * Get the evidence photo types that are prominently displayed
   * for each module type.
   */
  getProminentEvidenceTypes(moduleType) {
    if (moduleType === ADR_MODULE_TYPES.SKINCARE) {
      return ['product', 'patient_effect'] // Prominently encouraged for skincare
    }
    if (moduleType === ADR_MODULE_TYPES.INDUSTRY) {
      return ['product'] // Product photos are key for industry
    }
    if (moduleType === ADR_MODULE_TYPES.HOSPITAL) {
      return ['patient_effect'] // Patient effect photos for hospital
    }
    return ['product', 'patient_effect', 'other'] // Community pharmacy all types
  },

  /**
   * Format a report number human-readably.
   */
  formatReportNumber(reportNumber) {
    if (!reportNumber) return '—'
    // Expected format: ADR-2026-000123
    const match = reportNumber.match(/^ADR-(\d{4})-(\d{6})$/)
    if (match) {
      return `ADR-${match[1]} ${match[2] ? 'Report #' + match[2] : ''}`
    }
    return reportNumber
  },

  /**
   * Get status color token.
   */
  getStatusToken(status) {
    const tokens = {
      [REPORT_STATUS.DRAFT]: 'warning',
      [REPORT_STATUS.SUBMITTED]: 'success',
      [REPORT_STATUS.EXPORTED]: 'info',
      [REPORT_STATUS.FOLLOW_UP_REQUIRED]: 'warning',
    }
    return tokens[status] || 'gray600'
  },

  /**
   * Get status label.
   */
  getStatusLabel(status) {
    const labels = {
      [REPORT_STATUS.DRAFT]: 'Draft',
      [REPORT_STATUS.SUBMITTED]: 'Submitted',
      [REPORT_STATUS.EXPORTED]: 'Exported',
      [REPORT_STATUS.FOLLOW_UP_REQUIRED]: 'Follow-up Required',
    }
    return labels[status] || status
  },
}

export default ADR_FORM