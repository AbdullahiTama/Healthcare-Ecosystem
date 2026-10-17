// ── Safety Report constants (CareFind public ADR journey, Phase 2) ─────────
// Client-side twins of the server rules. Authority: supabase migration
// `carehub_20261103_adr_public_access.sql` (submit_adr_public_report) and the
// Phase 1 routing contract (apps/carehub/src/modules/adr/routing.js).
// Twin values must stay identical to those files; the RPC re-validates all.

export const WELCOME_HEADING = 'Report a suspected side effect'

export const PUBLIC_COMPANY_LABEL =
  'Company responsible for this medicine/product in your country (if known)'

export const ADDITIONAL_INFO_LABEL = 'Additional Information (Optional)'

export const STEPS = {
  WELCOME: 'welcome',
  REPORTER: 'reporter',
  PATIENT: 'patient',
  PRODUCTS: 'products',
  REACTIONS: 'reactions',
  ADDITIONAL: 'additional',
  REVIEW: 'review',
  SUCCESS: 'success',
}

export const STEP_ORDER = [
  STEPS.REPORTER,
  STEPS.PATIENT,
  STEPS.PRODUCTS,
  STEPS.REACTIONS,
  STEPS.ADDITIONAL,
  STEPS.REVIEW,
]

export const STEP_LABELS = {
  [STEPS.REPORTER]: 'About you',
  [STEPS.PATIENT]: 'About the person affected',
  [STEPS.PRODUCTS]: 'Medicine or product',
  [STEPS.REACTIONS]: 'What happened',
  [STEPS.ADDITIONAL]: 'Additional information',
  [STEPS.REVIEW]: 'Review and submit',
}

export const QUALIFICATIONS = [
  { value: 'physician', label: 'Doctor / physician' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'nurse', label: 'Nurse' },
  { value: 'other_hcp', label: 'Other health worker' },
  { value: 'consumer', label: 'Patient / member of the public' },
  { value: 'caregiver', label: 'Caregiver / family member' },
]

export const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unknown', label: 'Unknown' },
]

export const AGE_GROUPS = [
  { value: 'neonate', label: 'Newborn (0 to 28 days)' },
  { value: 'infant', label: 'Infant (under 1 year)' },
  { value: 'child', label: 'Child (1 to 11 years)' },
  { value: 'adolescent', label: 'Adolescent (12 to 17 years)' },
  { value: 'adult', label: 'Adult (18 to 64 years)' },
  { value: 'elderly', label: 'Elderly (65 years and above)' },
]

// The value is what gets recorded on the case. The label is only what the
// reporter reads, so this wording can be plain English without touching the
// stored severity.
export const SEVERITIES = [
  { value: 'mild', label: 'Mild. It did not interfere with daily activities.' },
  { value: 'moderate', label: 'Moderate. It interfered with daily activities.' },
  { value: 'severe', label: 'Severe. It prevented daily activities.' },
]

export const OUTCOMES = [
  { value: 'recovered', label: 'Recovered' },
  { value: 'recovering', label: 'Still recovering' },
  { value: 'not_recovered', label: 'Not recovered' },
  { value: 'recovered_with_sequelae', label: 'Recovered with lasting effects' },
  { value: 'fatal', label: 'Fatal' },
  { value: 'unknown', label: 'Unknown' },
]

// The six seriousness criteria, in plain language. Answers are ternary:
// yes / no / not_sure. Not-sure is stored distinctly (seriousness_unknown)
// and is never converted to No.
export const SERIOUSNESS_QUESTIONS = [
  { key: 'death', label: 'Did the person die?', help: 'Answer Yes if the reaction led to death.' },
  { key: 'life_threatening', label: 'Was it life-threatening?', help: 'The person was at immediate risk of death.' },
  { key: 'hospitalization', label: 'Did it cause hospital admission or a longer stay?', help: 'Admitted to hospital, or stayed longer, because of the reaction.' },
  { key: 'disability', label: 'Did it cause a lasting disability?', help: 'A significant, persistent loss of function.' },
  { key: 'congenital_anomaly', label: 'Did it cause a birth defect?', help: 'Only if the reaction involves pregnancy or a newborn.' },
  { key: 'other_medically_important', label: 'Was it medically important in another way?', help: 'A doctor judged it serious even if none of the above apply.' },
]

export const SERIOUSNESS_KEYS = SERIOUSNESS_QUESTIONS.map((q) => q.key)

export const COMPANY_KINDS = {
  VERIFIED: 'verified',
  UNKNOWN: 'unknown',
  UNVERIFIED_CANDIDATE: 'unverified_candidate',
}
