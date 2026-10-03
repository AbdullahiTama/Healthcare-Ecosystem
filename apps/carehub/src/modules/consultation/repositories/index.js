import { sbFetch } from '../../../services/supabase'

// ── Consultation repository ──────────────────────────────────────────────────
// A deep module over the `consultation_forms` table — the shared skincare &
// pharmacy consultation store.  Discriminated by `consultation_type`; the
// hospital module owns a separate `consultations` table (patient_id-linked) so
// the two workflows never share a table.
//
// Server-side filters mirror the shapes the UI already emits:
//   clientId, type, query, from, to
// `query` matches the client-name snapshot via ilike.
//
// Two collaborators are injected so the aggregate is the test surface:
//   clientRepository — for per-client history reads (getByClient delegates to
//                      its getConsultations method).
//   saleRepository   — only needed by PharmacyForm when creating a linked
//                      dispense sale; injected here so the form constructor
//                      stays thin.
//
// Production binds the real PostgREST-backed sbFetch (the default) and the
// real client/sale singletons; tests bind in-memory adapters.
export function createConsultationRepository({
  request = sbFetch,
  clientRepository,
  saleRepository,
} = {}) {
  return {
    async getAll(businessId, filters = {}) {
      let query = `consultation_forms?business_id=eq.${businessId}&order=consultation_date.desc&select=*`
      if (filters.clientId) query += `&client_id=eq.${filters.clientId}`
      if (filters.type) query += `&consultation_type=eq.${filters.type}`
      if (filters.query) query += `&client_name=ilike.*${encodeURIComponent(filters.query)}*`
      if (filters.from) query += `&consultation_date=gte.${filters.from}`
      if (filters.to) query += `&consultation_date=lte.${filters.to}`
      return request(query)
    },

    // Per-client consultations — delegates to the client repository's history
    // read, which scopes by both client_id and business_id.
    async getByClient(clientId, businessId) {
      if (clientRepository) {
        return clientRepository.getConsultations(clientId, businessId)
      }
      // Fallback: direct query scoped by client_id alone (legacy shape).
      // Used only when no client repository is injected — tests can verify
      // both paths.
      return request(`consultation_forms?client_id=eq.${clientId}&order=consultation_date.desc&select=*`)
    },

    // Latest consultation for a client — used by POS to detect whether a
    // client already has an active consultation.  Returns the most recent
    // row or null.
    async getLatest(clientId, businessId) {
      const data = await this.getByClient(clientId, businessId)
      return Array.isArray(data) && data.length ? data[0] : null
    },

    async create(data) {
      return request('consultation_forms', { method: 'POST', body: JSON.stringify(data) })
    },

    async update(id, data) {
      return request(`consultation_forms?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
        prefer: 'return=minimal',
      })
    },
  }
}

export const consultationRepository = createConsultationRepository()
