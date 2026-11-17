// Hospital Model: pure rules shared by the hospital screens (no data access; see ../repositories).
// docs/architecture/Hospital-Phase-0.md

/**
 * A jsonb list as the screens receive it. New rows hold a JSON array; rows written by the screens before Phase 0 hold a
 * JSON *string* of an array (they sent JSON.stringify(...) into a jsonb column). Both read as an array; anything
 * else reads as empty instead of throwing (CODE_AUDIT A36: JSON.parse on an array broke the Lab and Rx Inbox).
 */
export function asList(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** A lab test's display name, whether it was stored as { name } or a plain string. */
export const testName = (t) => (t && typeof t === 'object' ? t.name || '' : String(t ?? '')).trim()

/** The patient's name on a request row: the embedded patient (lab and imaging requests), else the stored name. */
export const patientNameOf = (row) => row?.patient?.full_name || row?.patient_name || 'Patient'

/**
 * A prescription line: only what the prescription needs. The Doctor screen builds lines from catalogue products,
 * which carry cost price, stock and supplier data that must not be copied into a clinical record.
 */
export function prescriptionLine(med) {
  return {
    id: med.id ?? null,
    name: med.name || '',
    generic_name: med.generic_name || '',
    dose: med.dose || '',
    freq: med.freq || '',
    dur: med.dur || '',
    route: med.route || '',
    instructions: med.instructions || '',
  }
}

/**
 * What the Doctor screen sends to complete_hospital_consultation, built from its form state. Destinations the
 * doctor did not tick send nothing, even if the form still holds medicines, tests or scans.
 */
export function consultationPayload({ consult = {}, meds = [], labTests = [], imagingRequests = [], destinations = {} }) {
  return {
    consultation: {
      hpi: consult.hpi || '',
      examination: consult.exam || '',
      primary_diagnosis: (consult.dx1 || '').trim(),
      secondary_diagnosis: consult.dx2 || '',
      clinical_notes: consult.notes || '',
      disposition: consult.disposition || 'Discharge',
      referral_dest: consult.refDest || '',
      referral_reason: consult.refReason || '',
      ward: consult.ward || '',
      counselling: consult.counselling || '',
      prescription_notes: consult.prescNotes || '',
    },
    medicines: destinations.pharmacy ? meds.map(prescriptionLine) : [],
    lab: destinations.lab
      ? { tests: labTests.map(testName).filter(Boolean), priority: consult.labPriority === 'urgent' ? 'urgent' : 'routine', notes: consult.labNotes || '' }
      : { tests: [] },
    imaging: destinations.imaging
      ? imagingRequests.filter((i) => (i.scan_type || '').trim()).map((i) => ({ scan_type: i.scan_type.trim(), body_part: i.body_part || '', clinical_info: i.clinical_info || '' }))
      : [],
  }
}

/** The reason the Doctor screen cannot send yet, or '' when it can. Mirrors the server's own checks. */
export function consultationProblem({ consult = {}, meds = [], labTests = [], imagingRequests = [], destinations = {} }) {
  if (!(consult.dx1 || '').trim()) return 'Please enter at least a primary diagnosis.'
  if (!destinations.pharmacy && !destinations.lab && !destinations.imaging) return 'Please select at least one destination: Pharmacy, Lab or Imaging.'
  if (destinations.pharmacy && meds.length === 0) return 'Add at least one medicine, or untick Pharmacy.'
  if (destinations.lab && !labTests.map(testName).some(Boolean)) return 'Add at least one lab test, or untick Lab.'
  if (destinations.imaging && !imagingRequests.some((i) => (i.scan_type || '').trim())) return 'Choose a scan type, or untick Imaging.'
  return ''
}

// Reception's form fields and the client columns they hold (clients are the patient identity, CODE_AUDIT A38).
const CLIENT_FIELDS = [
  ['patName', 'full_name'], ['phone', 'phone'], ['dob', 'date_of_birth'], ['gender', 'gender'], ['address', 'address'],
  ['nokName', 'next_of_kin_name'], ['nokPhone', 'next_of_kin_phone'], ['insurance', 'insurance'],
]
const clean = (v) => (v == null ? '' : String(v).trim())

/** Reception's form filled from an existing client. */
export function formFromClient(client) {
  const form = {}
  for (const [field, column] of CLIENT_FIELDS) form[field] = client?.[column] || ''
  return form
}

/**
 * The client details register_hospital_visit should save: every filled field for a new patient; for an existing
 * client, only the fields Reception changed (so a visit never blanks or rewrites what it did not touch).
 */
export function clientDetailsToSave(form, existing = null) {
  const out = {}
  for (const [field, column] of CLIENT_FIELDS) {
    const value = clean(form[field])
    if (existing) {
      if (value !== clean(existing[column])) out[column] = value
    } else if (value) {
      out[column] = value
    }
  }
  return out
}

/** The reason Reception cannot register yet, or ''. Mirrors register_hospital_visit's own checks. */
export function registrationProblem(form) {
  if (!clean(form.patName) || !clean(form.phone)) return 'Please enter the patient\'s full name and phone number.'
  if (!/^[0-9]{7,15}$/.test(clean(form.phone).replace(/[^0-9]/g, ''))) return 'Enter a phone number of 7 to 15 digits.'
  return ''
}

// The messages the hospital database functions raise on purpose (carehub_20270125_hospital_identity_and_workflow).
// They are written for staff and are shown as they are; any other failure gets the caller's fallback, so a raw
// database error never reaches the screen.
const STAFF_MESSAGES = [
  /^Only (reception|a doctor|the pharmacy) /,
  /^Enter /,
  /^Another patient of this business already has that phone number/,
  /^This patient already has an open visit/,
  /^This patient is not waiting for the doctor/,
  /^This prescription has already been dispensed/,
  /^That client is not a client of this business/,
  /^Unknown disposition/,
]

/** The staff-facing message for a failed hospital request. */
export function hospitalErrorMessage(error, fallback) {
  const raw = String(error?.message || '')
  const detail = raw.replace(/^Supabase error \(\d+\): /, '')
  if (detail === 'Session expired. Please log in again.') return detail
  return STAFF_MESSAGES.some((re) => re.test(detail)) ? detail : fallback
}

/** Plain-language status of a visit, for queues and toasts. */
export const VISIT_STATUS_LABEL = {
  at_reception: 'At reception',
  at_triage: 'At triage',
  at_doctor: 'Waiting for the doctor',
  at_lab: 'At the lab / imaging',
  at_pharmacy: 'At the pharmacy',
  admitted: 'Admitted',
  referred: 'Referred out',
  transferred: 'Emergency transfer',
  discharged: 'Discharged',
}
