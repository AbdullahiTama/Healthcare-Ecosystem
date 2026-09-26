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

    // Spec §9: confirm pending appointment — flips pending→confirmed.
    // Funds are released from held→available only on completion.
    async confirm(appointmentId, businessId) {
      try {
        const result = await request('rpc/confirm_appointment', {
          method: 'POST',
          body: JSON.stringify({ p_appointment_id: appointmentId }),
        })
        // RPC returns 'ok' or error string; service-role version returns string directly, so check
        if (Array.isArray(result) && result[0] === 'ok') return result
        if (result === 'ok') return result
        // If RPC not available or returned not ok, fall back to patch (still scoped)
        if (result !== 'ok' && typeof result === 'string' && result !== 'ok') {
          throw new Error(result)
        }
        return result
      } catch (e) {
        const msg = String(e.message || '')
        if (msg.includes('does not exist') || msg.includes('confirm_appointment')) {
          // Fallback to simple patch for environments where migration not yet applied
          return request(`appointments?id=eq.${appointmentId}&business_id=eq.${businessId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'confirmed', confirmed_at: new Date().toISOString() }),
            prefer: 'return=minimal',
          })
        }
        throw e
      }
    },

    // Complete appointment and release held funds to available balance.
    async complete(appointmentId, businessId) {
      try {
        const result = await request('rpc/complete_appointment_and_release', {
          method: 'POST',
          body: JSON.stringify({ p_appointment_id: appointmentId }),
        })
        if (Array.isArray(result) && result[0] === 'ok') return result
        if (result === 'ok') return result
        if (result !== 'ok' && typeof result === 'string' && result !== 'ok') {
          throw new Error(result)
        }
        return result
      } catch (e) {
        const msg = String(e.message || '')
        if (msg.includes('does not exist') || msg.includes('complete_appointment_and_release')) {
          return request(`appointments?id=eq.${appointmentId}&business_id=eq.${businessId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString() }),
            prefer: 'return=minimal',
          })
        }
        throw e
      }
    },

    // Manual POS/Transfer confirmation — single channel, no split, staff attest
    async confirmPos(appointmentId, businessId, posReference) {
      try {
        const result = await request('rpc/confirm_pos_payment', {
          method: 'POST',
          body: JSON.stringify({ p_appointment_id: appointmentId, p_pos_reference: posReference || null }),
        })
        if (result === 'ok' || (Array.isArray(result) && result[0] === 'ok')) return 'ok'
        if (typeof result === 'string' && result) throw new Error(result)
        return result
      } catch (e) {
        const msg = String(e.message || '')
        if (msg.includes('does not exist') || msg.includes('confirm_pos_payment')) {
          // Fallback to direct patch when migration not yet applied (dev/local)
          return request(`appointments?id=eq.${appointmentId}&business_id=eq.${businessId}`, {
            method: 'PATCH',
            body: JSON.stringify({ payment_status: 'paid', pos_reference: posReference || null }),
            prefer: 'return=minimal',
          })
        }
        throw e
      }
    },

    async confirmTransfer(appointmentId, businessId, proofUrl) {
      try {
        const result = await request('rpc/confirm_transfer_payment', {
          method: 'POST',
          body: JSON.stringify({ p_appointment_id: appointmentId, p_proof_url: proofUrl || null }),
        })
        if (result === 'ok' || (Array.isArray(result) && result[0] === 'ok')) return 'ok'
        if (typeof result === 'string' && result) throw new Error(result)
        return result
      } catch (e) {
        const msg = String(e.message || '')
        if (msg.includes('does not exist') || msg.includes('confirm_transfer_payment')) {
          return request(`appointments?id=eq.${appointmentId}&business_id=eq.${businessId}`, {
            method: 'PATCH',
            body: JSON.stringify({ payment_status: 'paid', transfer_proof_url: proofUrl || null }),
            prefer: 'return=minimal',
          })
        }
        throw e
      }
    },

    async initiatePaystack(appointmentId, businessId) {
      // Proxies to /api/initiate-appointment-payment (service-role Paystack init)
      // The repository seam is PostgREST-only; this helper is for symmetry — the
      // page calls fetch() directly to the Vercel function so the paystack secret stays server-side.
      // Kept here so tests can mock it if needed.
      return request(`rpc/initiate_appointment_paystack`, {
        method: 'POST',
        body: JSON.stringify({ p_appointment_id: appointmentId }),
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
