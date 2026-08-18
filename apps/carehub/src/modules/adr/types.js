export const ADR_MODULE_TYPES = {
  COMMUNITY_PHARMACY: 'community_pharmacy',
  HOSPITAL: 'hospital',
  INDUSTRY: 'industry',
  SKINCARE: 'skincare',
}

export const ADR_MODULE_TYPE_LABELS = {
  [ADR_MODULE_TYPES.COMMUNITY_PHARMACY]: 'Community Pharmacy',
  [ADR_MODULE_TYPES.HOSPITAL]: 'Hospital',
  [ADR_MODULE_TYPES.INDUSTRY]: 'Industry',
  [ADR_MODULE_TYPES.SKINCARE]: 'Skincare',
}

export const ADR_MODULE_ICONS = {
  [ADR_MODULE_TYPES.COMMUNITY_PHARMACY]: 'Pill',
  [ADR_MODULE_TYPES.HOSPITAL]: 'Stethoscope',
  [ADR_MODULE_TYPES.INDUSTRY]: 'Factory',
  [ADR_MODULE_TYPES.SKINCARE]: 'Sparkles',
}

export const REPORT_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  EXPORTED: 'exported',
  FOLLOW_UP_REQUIRED: 'follow_up_required',
}

export const REPORT_STATUS_LABELS = {
  [REPORT_STATUS.DRAFT]: 'Draft',
  [REPORT_STATUS.SUBMITTED]: 'Submitted',
  [REPORT_STATUS.EXPORTED]: 'Exported',
  [REPORT_STATUS.FOLLOW_UP_REQUIRED]: 'Follow-up Required',
}

export const REACTION_SEVERITY = {
  MILD: 'mild',
  MODERATE: 'moderate',
  SEVERE: 'severe',
}

export const REACTION_SEVERITY_LABELS = {
  [REACTION_SEVERITY.MILD]: 'Mild',
  [REACTION_SEVERITY.MODERATE]: 'Moderate',
  [REACTION_SEVERITY.SEVERE]: 'Severe',
}

export const REACTION_OUTCOME = {
  RECOVERED: 'recovered',
  RECOVERING: 'recovering',
  NOT_RECOVERED: 'not_recovered',
  RECOVERED_WITH_SEQUELAE: 'recovered_with_sequelae',
  FATAL: 'fatal',
  UNKNOWN: 'unknown',
}

export const REACTION_OUTCOME_LABELS = {
  [REACTION_OUTCOME.RECOVERED]: 'Recovered',
  [REACTION_OUTCOME.RECOVERING]: 'Recovering',
  [REACTION_OUTCOME.NOT_RECOVERED]: 'Not recovered',
  [REACTION_OUTCOME.RECOVERED_WITH_SEQUELAE]: 'Recovered with sequelae',
  [REACTION_OUTCOME.FATAL]: 'Fatal',
  [REACTION_OUTCOME.UNKNOWN]: 'Unknown',
}

export const ACTION_TAKEN = {
  DOSE_REDUCED: 'dose_reduced',
  WITHDRAWN: 'withdrawn',
  NOT_CHANGED: 'not_changed',
  UNKNOWN: 'unknown',
}

export const ACTION_TAKEN_LABELS = {
  [ACTION_TAKEN.DOSE_REDUCED]: 'Dose reduced',
  [ACTION_TAKEN.WITHDRAWN]: 'Withdrawn',
  [ACTION_TAKEN.NOT_CHANGED]: 'Not changed',
  [ACTION_TAKEN.UNKNOWN]: 'Unknown',
}

export const DECHALLENGE = {
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  NOT_APPLICABLE: 'not_applicable',
}

export const DECHALLENGE_LABELS = {
  [DECHALLENGE.POSITIVE]: 'Positive',
  [DECHALLENGE.NEGATIVE]: 'Negative',
  [DECHALLENGE.NOT_APPLICABLE]: 'Not applicable',
}

export const RECHALLENGE = {
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  NOT_DONE: 'not_done',
}

export const RECHALLENGE_LABELS = {
  [RECHALLENGE.POSITIVE]: 'Positive',
  [RECHALLENGE.NEGATIVE]: 'Negative',
  [RECHALLENGE.NOT_DONE]: 'Not done',
}

export const CAUSALITY = {
  CERTAIN: 'certain',
  PROBABLE_LIKELY: 'probable_likely',
  POSSIBLE: 'possible',
  UNLIKELY: 'unlikely',
  CONDITIONAL_UNCLASSIFIED: 'conditional_unclassified',
  UNASSESSABLE: 'unassessable',
}

export const CAUSALITY_LABELS = {
  [CAUSALITY.CERTAIN]: 'Certain',
  [CAUSALITY.PROBABLE_LIKELY]: 'Probable / Likely',
  [CAUSALITY.POSSIBLE]: 'Possible',
  [CAUSALITY.UNLIKELY]: 'Unlikely',
  [CAUSALITY.CONDITIONAL_UNCLASSIFIED]: 'Conditional / Unclassified',
  [CAUSALITY.UNASSESSABLE]: 'Unassessable',
}

// reaction_expected is a boolean on the report row (DB column), not a string
// enum. These keys are booleans so callers can render the label for the stored
// value directly: REACTION_EXPECTED_LABELS[true] / REACTION_EXPECTED_LABELS[false].
export const REACTION_EXPECTED = {
  EXPECTED: true,
  UNEXPECTED: false,
}

export const REACTION_EXPECTED_LABELS = {
  [REACTION_EXPECTED.EXPECTED]: 'Expected',
  [REACTION_EXPECTED.UNEXPECTED]: 'Unexpected',
}

export const EVIDENCE_PHOTO_TYPE = {
  PRODUCT: 'product',
  PATIENT_EFFECT: 'patient_effect',
  OTHER: 'other',
}

export const EVIDENCE_PHOTO_TYPE_LABELS = {
  [EVIDENCE_PHOTO_TYPE.PRODUCT]: 'Product',
  [EVIDENCE_PHOTO_TYPE.PATIENT_EFFECT]: 'Patient effect',
  [EVIDENCE_PHOTO_TYPE.OTHER]: 'Other',
}

export const NIGERIAN_PHONE_REGEX = /^(?:(?:\+?234|0)?[1-9][0-9]{8}|(?:\+?234|0)[1-9][0-9]{8})$/

export const PHONE_ERROR = 'Invalid Nigerian phone number'

export const QUALIFICATIONS = {
  PHYSICIAN: 'physician',
  PHARMACIST: 'pharmacist',
  NURSE: 'nurse',
  OTHER_HCP: 'other_hcp',
  CONSUMER: 'consumer',
  CAREGIVER: 'caregiver',
  LAWYER: 'lawyer',
}

export const QUALIFICATION_LABELS = {
  [QUALIFICATIONS.PHYSICIAN]: 'Physician',
  [QUALIFICATIONS.PHARMACIST]: 'Pharmacist',
  [QUALIFICATIONS.NURSE]: 'Nurse',
  [QUALIFICATIONS.OTHER_HCP]: 'Other HCP',
  [QUALIFICATIONS.CONSUMER]: 'Consumer',
  [QUALIFICATIONS.CAREGIVER]: 'Caregiver',
  [QUALIFICATIONS.LAWYER]: 'Lawyer',
}

export const PATIENT_GENDER = {
  MALE: 'male',
  FEMALE: 'female',
  UNKNOWN: 'unknown',
}

export const PATIENT_GENDER_LABELS = {
  [PATIENT_GENDER.MALE]: 'Male',
  [PATIENT_GENDER.FEMALE]: 'Female',
  [PATIENT_GENDER.UNKNOWN]: 'Unknown',
}

export const PATIENT_AGE_GROUP = {
  NEONATE: 'neonate',
  INFANT: 'infant',
  CHILD: 'child',
  ADOLESCENT: 'adolescent',
  ADULT: 'adult',
  ELDERLY: 'elderly',
}

export const PATIENT_AGE_GROUP_LABELS = {
  [PATIENT_AGE_GROUP.NEONATE]: 'Neonate',
  [PATIENT_AGE_GROUP.INFANT]: 'Infant',
  [PATIENT_AGE_GROUP.CHILD]: 'Child',
  [PATIENT_AGE_GROUP.ADOLESCENT]: 'Adolescent',
  [PATIENT_AGE_GROUP.ADULT]: 'Adult',
  [PATIENT_AGE_GROUP.ELDERLY]: 'Elderly',
}