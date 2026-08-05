import { sbFetch } from '../../../services/supabase'

// ── Appointment repository ────────────────────────────────────────────────────
// A deep module over the `appointments` table. The interface is small
// (getAll/create/update/delete); the implementation owns the PostgREST query
// shape and tenant scoping — every read and write is filtered by business_id so
// one organisation can never touch another's rows.
//
// Its only outside dependency is `request`, a function with sbFetch's shape:
// (path, options) => Promise<rows>. Production binds the real PostgREST-backed
// sbFetch (the default); tests bind an in-memory adapter. That injected
// transport is the seam — one interface, two adapters.
//
// Worth knowing: this table is written by both apps. CareFind books into it
// with `source: 'carefind'`, so rows here did not necessarily originate in
// CareHub — which is exactly why the tenant filter belongs in one place.
export function createAppointmentRepository(request = sbFetch) {
  return {
    // Ordered by date ascending — the page shows a forward-looking schedule,
    // not a newest-first log like the other aggregates.
    async getAll(businessId) {
      return request(`appointments?business_id=eq.${businessId}&order=date.asc&select=*`)
    },

    async create(businessId, appointment) {
      return request('appointments', {
        method: 'POST',
        body: JSON.stringify({ ...appointment, business_id: businessId }),
      })
    },

    // Previously an id-only PATCH in services/supabase.js. Drives the
    // confirm/complete/cancel status buttons.
    async update(appointmentId, businessId, updates) {
      return request(`appointments?id=eq.${appointmentId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    // Previously an id-only DELETE with no business filter — the same unscoped
    // class as the PATCHes this rollout keeps finding, but destructive rather
    // than corrective, and the page offers it behind a permission check and a
    // confirm dialog that calls it permanent. Scoped to the tenant here.
    async delete(appointmentId, businessId) {
      return request(`appointments?id=eq.${appointmentId}&business_id=eq.${businessId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },
  }
}

export const appointmentRepository = createAppointmentRepository()
