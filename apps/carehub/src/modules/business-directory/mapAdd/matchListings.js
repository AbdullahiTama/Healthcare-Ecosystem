import { createDedupIndex, classify, DUP_STATUS } from '../services/deduplication'
import { deriveNormalized } from '../services/normalize'
import { suggestCategory } from './osmBusinesses.js'

// How a listing added from the map records where it came from (directory_businesses.source_detail).
export const OSM_SOURCE_PREFIX = 'OpenStreetMap '

// Each OpenStreetMap business with its platform category and whether the directory already has it:
//   listed     the same OpenStreetMap place was added before (by reference, whatever it is called now), or the
//              directory's duplicate engine is sure it is the same business
//   duplicate  the engine thinks it may be (the admin is warned before adding)
//   new        neither
// Businesses of a kind the platform does not manage are left out.
export function matchToDirectory(osmBusinesses, existingListings, categories) {
  const listings = existingListings || []
  const byRef = new Map()
  listings.forEach((l) => {
    const detail = String(l.source_detail || '')
    if (detail.startsWith(OSM_SOURCE_PREFIX)) byRef.set(detail.slice(OSM_SOURCE_PREFIX.length), l)
  })
  const index = createDedupIndex(listings)
  return (osmBusinesses || []).reduce((out, b) => {
    const category = suggestCategory(b.tags, categories)
    if (!category) return out
    const sameRef = byRef.get(b.ref)
    if (sameRef) { out.push({ ...b, category, status: 'listed', match: sameRef }); return out }
    const candidate = {
      name: b.name, latitude: b.lat, longitude: b.lng, category_id: category.id,
      ...deriveNormalized({ name: b.name, address: b.address, phone: b.phone, website: b.website }),
    }
    const res = classify(candidate, index)
    const status = res.status === DUP_STATUS.CONFIRMED ? 'listed' : res.status === DUP_STATUS.POSSIBLE ? 'duplicate' : 'new'
    out.push({ ...b, category, status, match: res.match || null })
    return out
  }, [])
}
