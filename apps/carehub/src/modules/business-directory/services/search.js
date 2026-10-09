// ── BusinessSearch / BusinessMatcher ──────────────────────────────────────────
// BusinessSearch powers Business Discovery. BusinessMatcher is the same lookup
// narrowed to "what could be right here" for the Live Field Report. Both are
// READ-ONLY: neither creates a field activity, a visit, a notification or
// attendance. That is the non-negotiable separation rule (spec §5/§24).

import { withDistance } from './distance'
import { PLATFORM } from './constants'

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
 *   quantity?: number, sort?: string, includePlatform?: boolean }
 * @returns {{ results, total, truncated, mode: 'radius'|'place_text'|'filters', platformUnavailable: boolean }}
 *
 * With `includePlatform`, the platform registry (verified businesses curated by
 * platform admins) is searched as well. Every row is tagged `origin: 'own' |
 * 'platform'`, and a platform business the company has already copied into its
 * own directory is shown once, as the company's own record.
 */
export async function searchBusinesses(repo, businessId, params) {
  const filters = {
    categoryId: params.categoryId, subcategoryId: params.subcategoryId, state: params.state, lga: params.lga,
    verification: params.verification, source: params.source, businessType: params.businessType, active: 'active',
  }
  const hasCenter = params.center && Number.isFinite(params.center.lat) && Number.isFinite(params.center.lng)
  const radiusKm = params.radiusKm > 0 ? params.radiusKm : 5
  const mode = hasCenter ? 'radius' : params.placeName ? 'place_text' : 'filters'

  const fetchScope = async (id) => {
    if (mode === 'radius') {
      const box = await repo.searchWithinBox(id, { ...params.center, radiusKm }, filters)
      return withDistance(box, params.center.lat, params.center.lng).filter((r) => r.distance_km !== null && r.distance_km <= radiusKm)
    }
    if (mode === 'place_text') return (await repo.searchByPlaceName(id, params.placeName, filters)).map((r) => ({ ...r, distance_km: null }))
    return (await repo.list(id, filters, { page: 0, pageSize: 500, order: 'name_normalized.asc' })).map((r) => ({ ...r, distance_km: null }))
  }

  const own = (await fetchScope(businessId)).map((r) => ({ ...r, origin: 'own' }))
  let platform = []
  let platformUnavailable = false
  if (params.includePlatform) {
    try {
      // Looked up directly (not inferred from the filtered results) so an inactive or
      // edited copy that a filter hides still suppresses its platform duplicate.
      const [copied, shared] = await Promise.all([repo.getPlatformCopyIds(businessId), fetchScope(PLATFORM)])
      platform = shared.filter((r) => !copied.has(String(r.id))).map((r) => ({ ...r, origin: 'platform' }))
    } catch (e) {
      // The registry is a bonus source: its failure must not take the company's own results down with it.
      platformUnavailable = true
    }
  }
  const rows = own.concat(platform)

  // "Show me 20 …" means the 20 NEAREST (or, without a location, the first 20 by name);
  // the requested display sort is then applied to that selection.
  const ranked = sortResults(rows, mode === 'radius' ? 'nearest' : 'alpha')
  const cap = params.quantity > 0 ? params.quantity : ranked.length
  const picked = ranked.slice(0, cap)
  return { results: sortResults(picked, params.sort || (mode === 'radius' ? 'nearest' : 'alpha')), total: ranked.length, truncated: ranked.length > cap, mode, platformUnavailable }
}

// ── BusinessMatcher (Live Field Report) ───────────────────────────────────────
// Wording is part of the contract: GPS proximity is a hint, never proof of a visit.
export const NEARBY_LABELS = {
  candidate: 'Possible nearby business',
  candidates: 'Possible nearby businesses',
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
