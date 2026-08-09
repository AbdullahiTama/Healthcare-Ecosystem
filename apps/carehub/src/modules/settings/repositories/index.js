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
    async saveBookingConfig(businessId, { enabled, type, slots }) {
      return request(`businesses?id=eq.${businessId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          booking_enabled: !!enabled,
          booking_type: type,
          booking_slots: slots,
        }),
        prefer: 'return=minimal',
      })
    },
  }
}

export const settingsRepository = createSettingsRepository()
export { BUSINESS_PROFILE_FIELDS }
