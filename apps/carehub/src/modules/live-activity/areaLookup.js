// Reverse geocoding: "what is this area called?" for the caption on a report.
//
// This uses OpenStreetMap's public Nominatim service, so it follows that service's
// usage policy: no more than one request per second, results cached, and the data
// attributed to OpenStreetMap wherever it is shown. The same conventions as the
// forward geocoder in business-directory/services/geocoding.js.
//
// The caption describes the area. It is never the place visited, and a failure here
// never stops a report from being logged.
//
// Outcomes:
//   { status: 'ok', label }     a name was found
//   { status: 'no_result' }     the service answered; there is no name for this spot
//   throws                      the service could not be reached or refused. Callers
//                               treat this differently from 'no_result'.
// A 'no_result' is cached; a failure is not, so it can be retried.

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse'
const MIN_GAP_MS = 1100
const TIMEOUT_MS = 8000

// A short caption from an OSM address: place, road, locality, town. Empty when there
// is nothing usable; a name is never invented.
export function areaLabelFromAddress(a) {
  if (!a) return ''
  const parts = []
  if (a.amenity) parts.push(a.amenity)
  else if (a.building) parts.push(a.building)
  else if (a.shop) parts.push(a.shop)
  if (a.road) parts.push(a.road)
  if (a.suburb) parts.push(a.suburb)
  else if (a.neighbourhood) parts.push(a.neighbourhood)
  if (a.city) parts.push(a.city)
  else if (a.town) parts.push(a.town)
  else if (a.state) parts.push(a.state)
  return parts.join(', ')
}

function validPoint(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

// ~110 m cells: the same spot, or a few steps away, is one request.
function cellKey(lat, lng) {
  return lat.toFixed(3) + ',' + lng.toFixed(3)
}

export function createAreaLookup({ fetchImpl, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = MIN_GAP_MS } = {}) {
  const cache = new Map() // key -> Promise<result> (resolved results only, once settled)
  let lastCall = 0
  let chain = Promise.resolve()

  async function request(lat, lng) {
    const wait = lastCall + gapMs - now()
    if (wait > 0) await sleep(wait)
    lastCall = now()
    const url = ENDPOINT + '?format=jsonv2&zoom=18&addressdetails=1&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng)
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = ctrl ? setTimeout(function () { ctrl.abort() }, TIMEOUT_MS) : null
    try {
      const res = await (fetchImpl || fetch)(url, { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
      if (!res.ok) throw new Error('Area lookup unavailable (' + res.status + ')')
      const data = await res.json()
      const label = data && !data.error ? (areaLabelFromAddress(data.address) || (data.display_name || '').trim()) : ''
      return label ? { status: 'ok', label } : { status: 'no_result' }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return function lookupArea(lat, lng) {
    const la = Number(lat)
    const ln = Number(lng)
    if (!validPoint(la, ln)) return Promise.resolve({ status: 'no_result' })
    const key = cellKey(la, ln)
    if (cache.has(key)) return cache.get(key)

    // Serialised: one at a time, spaced out. A failure must not poison the queue.
    const result = chain.then(function () { return request(la, ln) })
    chain = result.catch(function () {})
    cache.set(key, result)
    // A failure is not remembered, so the next attempt asks again.
    result.catch(function () { if (cache.get(key) === result) cache.delete(key) })
    return result
  }
}

export const lookupArea = createAreaLookup()
