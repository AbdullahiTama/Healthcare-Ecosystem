// ── GeocodingService ──────────────────────────────────────────────────────────
// Forward geocoding ("Surulere" -> coordinates) via OpenStreetMap Nominatim.
//
// Nominatim's usage policy: at most one request per second, an identifiable
// client, and caching of results. This module therefore serialises and spaces
// its requests and caches every answer (including "not found") for the session.
// There is NO built-in gazetteer of coordinates: the project's data-integrity
// rule is that a coordinate is never made up, so a place the service cannot
// resolve is reported as unresolved and the caller falls back to text matching.

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const MIN_GAP_MS = 1100

const cache = new Map()
let lastCall = 0
let chain = Promise.resolve()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @returns {Promise<{lat:number,lng:number,label:string}|null>} null = not found
 * @throws on network failure (callers distinguish "not found" from "service down")
 */
export function geocodePlace(query, { country = 'ng', fetchImpl, now = Date.now } = {}) {
  const key = String(query || '').trim().toLowerCase()
  if (!key) return Promise.resolve(null)
  if (cache.has(key)) return Promise.resolve(cache.get(key))

  const run = async () => {
    if (cache.has(key)) return cache.get(key)
    const wait = lastCall + MIN_GAP_MS - now()
    if (wait > 0 && !fetchImpl) await sleep(wait)
    lastCall = now()
    const url = ENDPOINT + '?format=jsonv2&limit=1&addressdetails=0&countrycodes=' + encodeURIComponent(country) +
      '&q=' + encodeURIComponent(query)
    const res = await (fetchImpl || fetch)(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error('Location service unavailable (' + res.status + ')')
    const data = await res.json()
    const first = Array.isArray(data) ? data[0] : null
    const lat = first ? parseFloat(first.lat) : NaN
    const lng = first ? parseFloat(first.lon) : NaN
    const out = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, label: first.display_name || query } : null
    cache.set(key, out)
    return out
  }
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}

export function clearGeocodeCache() {
  cache.clear()
  lastCall = 0
}
