// Loads the Google Maps JavaScript API once, on demand.
//
// The key is a BROWSER key and is therefore public by nature: restrict it in
// Google Cloud to this site's HTTP referrers and to the Maps JavaScript API
// only. It is read from VITE_GOOGLE_MAPS_BROWSER_KEY, never hardcoded. Server
// side web-service keys (Geocoding, Places) must never use a VITE_ variable.
//
// With no key the loader rejects with reason 'not_configured' and the screen
// falls back to the list, which stays fully usable. Nothing here pretends a map
// loaded.

let pending = null

export function mapsKey() {
  try { return (import.meta.env && import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY) || '' } catch (e) { return '' }
}

export function loadGoogleMaps({ key = mapsKey(), doc = typeof document !== 'undefined' ? document : null, win = typeof window !== 'undefined' ? window : null } = {}) {
  if (!key) return Promise.reject(Object.assign(new Error('Google Maps is not configured.'), { reason: 'not_configured' }))
  if (!doc || !win) return Promise.reject(Object.assign(new Error('No browser environment.'), { reason: 'unavailable' }))
  if (win.google && win.google.maps) return Promise.resolve(win.google.maps)
  if (pending) return pending
  pending = new Promise((resolve, reject) => {
    const cbName = '__carehubGoogleMapsReady'
    win[cbName] = () => { delete win[cbName]; resolve(win.google.maps) }
    const s = doc.createElement('script')
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&callback=' + cbName + '&loading=async'
    s.async = true
    s.onerror = () => { pending = null; reject(Object.assign(new Error('Google Maps could not be loaded.'), { reason: 'load_failed' })) }
    // Invalid or referrer-restricted keys call this instead of the callback.
    win.gm_authFailure = () => { pending = null; reject(Object.assign(new Error('Google Maps rejected the API key.'), { reason: 'auth_failed' })) }
    doc.head.appendChild(s)
  })
  return pending
}
