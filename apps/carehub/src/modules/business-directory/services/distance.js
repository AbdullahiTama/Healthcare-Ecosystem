// ── DistanceCalculator ────────────────────────────────────────────────────────
// Great-circle distance and the bounding box used to make radius searches
// index-friendly: the database filters on a lat/lng rectangle (cheap, uses the
// (business_id, latitude, longitude) index) and the exact haversine distance is
// applied afterwards to trim the rectangle's corners.

const EARTH_RADIUS_KM = 6371.0088
const toRad = (d) => (d * Math.PI) / 180

export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Rectangle that fully contains the circle of `radiusKm` around the point. */
export function boundingBox(lat, lng, radiusKm) {
  const dLat = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI)
  const cos = Math.max(Math.cos(toRad(lat)), 0.01)
  const dLng = dLat / cos
  return {
    minLat: Math.max(-90, lat - dLat),
    maxLat: Math.min(90, lat + dLat),
    minLng: Math.max(-180, lng - dLng),
    maxLng: Math.min(180, lng + dLng),
  }
}

export function formatDistance(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return ''
  if (km < 1) return Math.max(10, Math.round(km * 100) * 10) + ' m'
  return (km < 10 ? km.toFixed(1) : Math.round(km)) + ' km'
}

/** Attach `distance_km` to rows with coordinates; rows without are left without one. */
export function withDistance(rows, lat, lng) {
  return rows.map((r) => {
    if (r.latitude == null || r.longitude == null) return { ...r, distance_km: null }
    return { ...r, distance_km: haversineKm(lat, lng, Number(r.latitude), Number(r.longitude)) }
  })
}
