// ── BusinessSearch / BusinessMatcher ──────────────────────────────────────────
// BusinessSearch powers Business Discovery. BusinessMatcher is the same lookup
// narrowed to "what could be right here" for the Live Field Report. Both are
// READ-ONLY: neither creates a field activity, a visit, a notification or
// attendance. That is the non-negotiable separation rule (spec §5/§24).

import { withDistance } from './distance'

export const SORTS = [
  ['nearest', 'Nearest'],
  ['farthest', 'Farthest'],
  ['alpha', 'Alphabetical'],
  ['recent', 'Recently added'],
  ['verified', 'Verified first'],
]

const byName = (a, b) => String(a.name_normalized || a.name).localeCompare(String(b.name_normalized || b.name))

export function sortResults(rows, sort) {
  const out = [...rows]
  const dist = (r) => (r.distance_km == null ? Infinity : r.distance_km)
  switch (sort) {
    case 'farthest':
      return out.sort((a, b) => (b.distance_km == null ? -1 : b.distance_km) - (a.distance_km == null ? -1 : a.distance_km) || byName(a, b))
    case 'alpha':
      return out.sort(byName)
    case 'recent':
      return out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || byName(a, b))
    case 'verified': {
      const rank = (r) => (r.verification_status === 'verified' ? 0 : r.verification_status === 'unverified' ? 1 : 2)
      return out.sort((a, b) => rank(a) - rank(b) || dist(a) - dist(b) || byName(a, b))
    }
    case 'nearest':
    default:
      return out.sort((a, b) => dist(a) - dist(b) || byName(a, b))
  }
}

/**
 * @param params {
 *   center?: {lat,lng}, radiusKm?: number, placeName?: string (text fallback),
 *   categoryId?, subcategoryId?, state?, lga?, verification?, source?, businessType?,
 *   quantity?: number, sort?: string }
 * @returns {{ results, total, truncated, mode: 'radius'|'place_text'|'filters' }}
 */
export async function searchBusinesses(repo, businessId, params) {
  const filters = {
    categoryId: params.categoryId, subcategoryId: params.subcategoryId, state: params.state, lga: params.lga,
    verification: params.verification, source: params.source, businessType: params.businessType, active: 'active',
  }
  let rows
  let mode
  if (params.center && Number.isFinite(params.center.lat) && Number.isFinite(params.center.lng)) {
    const radiusKm = params.radiusKm > 0 ? params.radiusKm : 5
    const box = await repo.searchWithinBox(businessId, { ...params.center, radiusKm }, filters)
    rows = withDistance(box, params.center.lat, params.center.lng).filter((r) => r.distance_km !== null && r.distance_km <= radiusKm)
    mode = 'radius'
  } else if (params.placeName) {
    rows = (await repo.searchByPlaceName(businessId, params.placeName, filters)).map((r) => ({ ...r, distance_km: null }))
    mode = 'place_text'
  } else {
    rows = (await repo.list(businessId, filters, { page: 0, pageSize: 500, order: 'name_normalized.asc' })).map((r) => ({ ...r, distance_km: null }))
    mode = 'filters'
  }
  const sorted = sortResults(rows, params.sort || (mode === 'radius' ? 'nearest' : 'alpha'))
  const cap = params.quantity > 0 ? params.quantity : sorted.length
  return { results: sorted.slice(0, cap), total: sorted.length, truncated: sorted.length > cap, mode }
}

// ── BusinessMatcher (Live Field Report) ───────────────────────────────────────
// Wording is part of the contract: GPS proximity is a hint, never proof of a visit.
export const NEARBY_LABELS = {
  candidate: 'Possible nearby business',
  detected: 'Detected nearby',
  captured: 'Location captured',
  selected: 'Selected business',
}

/** Search radius that honours the GPS fix's own uncertainty, within sane bounds. */
export function radiusForAccuracy(accuracyMeters) {
  const m = Number.isFinite(accuracyMeters) ? accuracyMeters * 1.5 : 0
  return Math.min(1, Math.max(0.2, m / 1000))
}

export async function findNearbyBusinesses(repo, businessId, { lat, lng, accuracy, limit = 5 }) {
  const radiusKm = radiusForAccuracy(accuracy)
  const box = await repo.searchWithinBox(businessId, { lat, lng, radiusKm }, { active: 'active' }, { limit: 300 })
  const near = withDistance(box, lat, lng).filter((r) => r.distance_km !== null && r.distance_km <= radiusKm)
  return { radiusKm, candidates: sortResults(near, 'nearest').slice(0, limit) }
}
