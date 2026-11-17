import { sbFetch } from '../../../services/supabase'

// ── Hospital repository ───────────────────────────────────────────────────────
// Data access for the Hospital Model screens (pages/dashboard/hospital). The clinical writes that must happen
// together go through the database functions of carehub_20270125_hospital_identity_and_workflow, which check the
// caller's clinical role and write all-or-nothing; reads stay plain PostgREST, scoped by business and by the
// role policies of carehub_20270124_hospital_access. docs/architecture/Hospital-Phase-0.md
//
// The only outside dependency is `request`, with sbFetch's shape: (path, options) => Promise<rows>. Tests bind a
// recording transport.
export function createHospitalRepository(request = sbFetch) {
  const rpc = (name, args) => request('rpc/' + name, { method: 'POST', body: JSON.stringify(args) })
  const PATIENT = 'patient:patients(full_name,reg_no,status)'

  return {
    /** Clients of the business matching a name or phone (Reception's "existing patient" search). */
    async searchClients(businessId, term, limit = 8) {
      const q = String(term || '').trim()
      if (q.length < 2) return []
      // PostgREST or=() takes comma-separated conditions: commas, parentheses and the ilike wildcards (* and %) are
      // stripped from the user's text so it cannot change the filter.
      const safe = encodeURIComponent(q.replace(/[,()*%]+/g, ' ').replace(/\s+/g, ' ').trim())
      return request(
        `clients?business_id=eq.${businessId}&or=(full_name.ilike.*${safe}*,phone.ilike.*${safe}*)` +
        `&select=id,full_name,phone,email,date_of_birth,gender,address,next_of_kin_name,next_of_kin_phone,insurance` +
        `&order=full_name.asc&limit=${limit}`,
      )
    },

    /** Opens a visit at triage for an existing client (clientId) or a new one (client details). */
    registerVisit({ businessId, clientId = null, client = {}, visit = {} }) {
      return rpc('register_hospital_visit', { p_business_id: businessId, p_client_id: clientId, p_client: client, p_visit: visit })
    },

    /** Saves a consultation with its prescription, lab and imaging requests, all or nothing. */
    completeConsultation({ patientId, consultation, medicines, lab, imaging }) {
      return rpc('complete_hospital_consultation', {
        p_patient_id: patientId, p_consultation: consultation, p_medicines: medicines, p_lab: lab, p_imaging: imaging,
      })
    },

    /** Marks a prescription dispensed; the database decides whether the patient is discharged. */
    dispensePrescription(prescriptionId) {
      return rpc('dispense_prescription', { p_prescription_id: prescriptionId })
    },

    /** Lab requests of the business, newest first, with the patient's name and number. */
    labRequests(businessId) {
      return request(`lab_requests?business_id=eq.${businessId}&order=created_at.desc&select=*,${PATIENT}`)
    },

    /** Imaging requests of the business, newest first, with the patient's name and number. */
    imagingRequests(businessId) {
      return request(`imaging_requests?business_id=eq.${businessId}&order=created_at.desc&select=*,${PATIENT}`)
    },
  }
}

export const hospitalRepository = createHospitalRepository()
