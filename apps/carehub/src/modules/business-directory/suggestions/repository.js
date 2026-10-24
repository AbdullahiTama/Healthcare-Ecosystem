import { sbFetch } from '../../../services/supabase'

// Businesses reps suggest for the CareHub directory, reviewed by the platform team (directory_suggestions, draft
// carehub_20261027_directory_field_link). The database sets who suggested it, the status and the review fields,
// caps a company at 20 a day, and lets only the platform admin review; the client sends what was suggested.

export const SUGGESTION_TYPES = [
  ['pharmacy', 'Pharmacy'], ['hospital', 'Hospital'], ['clinic', 'Clinic'], ['laboratory', 'Laboratory'],
  ['distributor', 'Distributor'], ['retail', 'Retail shop'], ['other', 'Other'],
]

function coded(message, code) {
  const err = new Error(message)
  err.code = code
  return err
}

function translate(e) {
  const text = String(e && e.message ? e.message : e)
  if (/PGRST205|42P01|Could not find the table|relation .*directory_suggestions.* does not exist/i.test(text)) {
    return coded('Suggesting a business is not available yet.', 'NOT_AVAILABLE')
  }
  if (/Too many suggestions today/i.test(text)) return coded('Too many suggestions today', 'TOO_MANY')
  return e
}

const blankToNull = (v) => {
  const t = typeof v === 'string' ? v.trim() : v
  return t === '' || t === undefined ? null : t
}

export function createSuggestionRepository({ request = sbFetch } = {}) {
  async function call(path, opts) {
    try {
      return await request(path, opts)
    } catch (e) {
      throw translate(e)
    }
  }

  // A review that matched no row was either already handled or not the caller's to make.
  async function review(id, patch) {
    const rows = await call('directory_suggestions?id=eq.' + id, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=representation' })
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('This suggestion has already been handled, or you cannot review it.')
    return rows[0]
  }

  return {
    async create(businessId, { name, business_type, address, latitude, longitude, note }) {
      const rows = await call('directory_suggestions', {
        method: 'POST',
        prefer: 'return=representation',
        body: JSON.stringify({
          business_id: businessId, name: String(name || '').trim(), business_type,
          address: blankToNull(address), latitude, longitude, note: blankToNull(note),
        }),
      })
      return Array.isArray(rows) ? rows[0] : rows
    },

    // The signed-in person's own suggestions (a field manager can read the company's, but this list is personal).
    async listMine(email) {
      if (!email) return []
      const rows = await call('directory_suggestions?suggested_by_email=eq.' + encodeURIComponent(email) + '&order=created_at.desc&select=id,name,business_type,status,review_note,created_at')
      return Array.isArray(rows) ? rows : []
    },

    async listPending() {
      const rows = await call('directory_suggestions?status=eq.pending&order=created_at.asc&select=*,businesses(name)')
      return Array.isArray(rows) ? rows : []
    },

    markAccepted(id, directoryBusinessId) {
      return review(id, { status: 'accepted', directory_business_id: directoryBusinessId })
    },

    reject(id, reviewNote) {
      return review(id, { status: 'rejected', review_note: blankToNull(reviewNote || '') })
    },
  }
}

export const suggestionRepository = createSuggestionRepository()
