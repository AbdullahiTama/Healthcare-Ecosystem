import { sbFetch } from '../../../services/supabase'

// Everything the Settings page is allowed to change about the business record
// itself. This list is the whitelist: `saveBusinessProfile` copies these keys
// and nothing else, so a field added to the form for display cannot reach the
// database by accident (CODE_AUDIT, Refactoring).
//
// This is a code-quality guard, NOT the security boundary. The real one is
// server-side: `guard_business_privileged_columns` (C18,
// 20260805_guard_business_privileged_columns.sql) rejects any change to
// is_platform_admin / status / plan / plan_expires_at / parent_business_id /
// referring_agent_id from a non-platform-admin. A client-side list stops
// nothing on its own — the attack that motivated the trigger never went
// through this page.
const BUSINESS_PROFILE_FIELDS = [
  'name', 'phone', 'whatsapp', 'address', 'state', 'city',
  'hours', 'website', 'logo_url', 'cover_url', 'description',
  'visible_on_carefind', 'show_prices', 'latitude', 'longitude',
]

// ── Settings repository ───────────────────────────────────────────────────────
// A deep module over `business_settings` — the per-business receipt/currency/tax
// configuration — plus the narrow slice of the `businesses` record that the
// Settings page owns.
//
// Its only outside dependency is `request`, a function with sbFetch's shape:
// (path, options) => Promise<rows>. Production binds the real PostgREST-backed
// sbFetch (the default); tests bind an in-memory adapter. That injected
// transport is the seam — one interface, two adapters.
//
// On the `businesses` boundary: that table has no owning module. It is the
// tenant record, written by this page (profile and booking config) and by
// AdminDashboard (approval status), which is a different concern and keeps its
// own path through `services/supabase.updateBusiness`. What lives here is only
// what the Settings *page* may change, expressed as an explicit field list
// rather than "whatever is in the form object".
export function createSettingsRepository(request = sbFetch) {
  return {
    async get(businessId) {
      const rows = await request(`business_settings?business_id=eq.${businessId}&select=*`)
      return rows[0] || null
    },

    // A true upsert, resolved by the database on business_settings' UNIQUE
    // (business_id) constraint.
    //
    // This replaces a read-then-PATCH-or-POST in services/supabase.js: it read
    // the row, then branched to PATCH if present and POST if not. Two users
    // saving settings for the first time simultaneously could both see "no
    // row" and both POST — the unique constraint means the loser got a 409
    // rather than a duplicate, so no data was ever corrupted, but one of them
    // saw a save fail for no reason they could act on. One round-trip now, and
    // the branch belongs to the database.
    async save(businessId, settings) {
      return request('business_settings', {
        method: 'POST',
        body: JSON.stringify({ ...settings, business_id: businessId }),
        prefer: 'resolution=merge-duplicates,return=representation',
      })
    },

    // The Settings page's business-profile form. Only BUSINESS_PROFILE_FIELDS
    // are sent, whatever else the caller passes.
    async saveBusinessProfile(businessId, form) {
      const updates = {}
      for (const key of BUSINESS_PROFILE_FIELDS) {
        if (form[key] !== undefined) updates[key] = form[key]
      }
      return request(`businesses?id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    // Online booking configuration, surfaced on the business's CareFind
    // profile. Kept separate from the profile save because it is its own form
    // with its own button, and because `booking_slots` needs parsing the
    // profile fields do not.
    //
    // Fees are stored in kobo (integer). NULL means "free" — a business can
    // charge for one appointment type and make the other free. The consultation
    // medium (ADR-005) is the default channel online consultations happen on;
    // it is snapshotted onto each appointment at booking time.
    async saveBookingConfig(businessId, { enabled, type, slots, onlineFee, physicalFee, consultationMedium, consultationMediumLink }) {
      return request(`businesses?id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          booking_enabled: !!enabled,
          booking_type: type,
          booking_slots: slots,
          online_consultation_fee: onlineFee,
          physical_consultation_fee: physicalFee,
          consultation_medium: consultationMedium || null,
          consultation_medium_link: consultationMediumLink || null,
        }),
        prefer: 'return=minimal',
      })
    },

    // ── Services — per-business service catalog for professional booking ─────
    async getServices(businessId) {
      try {
        return await request(`business_services?business_id=eq.${businessId}&order=name.asc&select=*`)
      } catch (e) {
        // Table not yet migrated — return empty so UI shows empty state, not error
        if (String(e.message).includes('business_services')) return []
        throw e
      }
    },

    async createService(businessId, service) {
      return request('business_services', {
        method: 'POST',
        body: JSON.stringify({ ...service, business_id: businessId }),
      })
    },

    async updateService(serviceId, businessId, updates) {
      return request(`business_services?id=eq.${serviceId}&business_id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        prefer: 'return=minimal',
      })
    },

    async deleteService(serviceId, businessId) {
      return request(`business_services?id=eq.${serviceId}&business_id=eq.${businessId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // Date-specific availability per service (optional override over daily slots)
    async getAvailability(businessId, serviceId) {
      try {
        const q = serviceId ? `&service_id=eq.${serviceId}` : ''
        return await request(`service_availability?business_id=eq.${businessId}${q}&order=date.asc,time.asc&select=*`)
      } catch (e) {
        if (String(e.message).includes('service_availability')) return []
        throw e
      }
    },

    async saveAvailability(businessId, rows) {
      // rows: [{service_id, date, time}]
      if (!rows || rows.length === 0) return
      return request('service_availability', {
        method: 'POST',
        body: JSON.stringify(rows.map(r => ({ business_id: businessId, service_id: r.service_id || null, date: r.date, time: r.time }))),
        prefer: 'return=minimal',
      })
    },

    async deleteAvailability(id, businessId) {
      return request(`service_availability?id=eq.${id}&business_id=eq.${businessId}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },
  }
}

export const settingsRepository = createSettingsRepository()
export { BUSINESS_PROFILE_FIELDS }
