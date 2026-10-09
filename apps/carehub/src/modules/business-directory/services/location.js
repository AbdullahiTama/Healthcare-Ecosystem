// ── LocationService ───────────────────────────────────────────────────────────
// A promise wrapper over the browser Geolocation API with human error messages.
// A position is a HINT about where the device is — it is never proof that a
// representative visited anywhere.

export function describeGeoError(err) {
  switch (err && err.code) {
    case 1: return 'Location permission was denied. Allow location for this site in your browser settings, or type a place instead.'
    case 2: return 'Your position could not be determined. Move to an open area or type a place instead.'
    case 3: return 'Finding your position took too long. Try again or type a place instead.'
    default: return 'Your location is not available on this device. Type a place instead.'
  }
}

/** @returns {Promise<{lat:number,lng:number,accuracy:number|null}>} */
export function getCurrentPosition({ timeout = 12000, highAccuracy = true } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error(describeGeoError(null)))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null }),
      (err) => reject(new Error(describeGeoError(err))),
      { enableHighAccuracy: highAccuracy, timeout, maximumAge: 30000 },
    )
  })
}
