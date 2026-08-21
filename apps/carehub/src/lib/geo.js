// Pure geospatial helpers for the field-activity Place of Visit check.
// No dependencies, no I/O — the distance math is unit-tested in geo.test.js.

const EARTH_RADIUS_M = 6371000
const toRad = (d) => (d * Math.PI) / 180

/**
 * Great-circle distance between two { lat, lng } points, in metres.
 * Returns null when either point is missing or non-numeric — callers must
 * treat "cannot compute" as NOT verified rather than crashing the log flow.
 */
export function haversineMeters(a, b) {
  if (!a || !b) return null
  const lat1 = Number(a.lat)
  const lon1 = Number(a.lng)
  const lat2 = Number(b.lat)
  const lon2 = Number(b.lng)
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(s))
}

/**
 * Does the GPS fix sit within `radiusM` of the resolved place? The default
 * tolerance absorbs consumer-GPS drift (~20–100 m urban) without waving
 * through a rep logging from across town.
 */
export function verifyPlaceMatch(placeCoords, gpsCoords, radiusM = 500) {
  const d = haversineMeters(placeCoords, gpsCoords)
  return d != null && d <= radiusM
}
