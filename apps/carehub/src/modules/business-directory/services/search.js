// ── BusinessMatcher (Live Field Report) ───────────────────────────────────────
// "What could be right here" for the Live Field Report: a short, bounded suggestion list from the
// platform registry. READ-ONLY: it never creates a field activity, a visit, a notification or
// attendance. That is the non-negotiable separation rule (spec §5/§24).
//
// The Business Directory itself is platform-admin only (Admin console > Directory). A company can
// no longer read directory tables, so the suggestion comes from nearby_directory_businesses(), which
// returns a handful of verified listings with no contact details (carehub_20261208).

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

export async function findNearbyBusinesses(repo, { lat, lng, accuracy, limit = 5 }) {
  const radiusKm = radiusForAccuracy(accuracy)
  const rows = await repo.nearbyBusinesses({ lat, lng, radiusKm, limit })
  return { radiusKm, candidates: sortResults(Array.isArray(rows) ? rows : [], 'nearest').slice(0, limit) }
}
