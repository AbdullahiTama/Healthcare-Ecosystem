// Which map provider CareHub uses, and how it loads Leaflet for the fallback.
//
// Google Maps is used when the build has a browser key. Vite inlines VITE_* variables at build time, so the key is
// public by design: restrict it in Google Cloud to this site's addresses (HTTP referrers) and to the Maps JavaScript
// API only. A Vercel change to the key takes effect at the next deployment.
// Without a key, or if Google refuses it, maps fall back to OpenStreetMap (see packages/design-system mapEngine.js).
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}
export const GOOGLE_MAPS_KEY = env.VITE_GOOGLE_MAPS_BROWSER_KEY || env.VITE_GOOGLE_MAPS_API_KEY || ''

export async function loadLeaflet() {
  const mod = await import('leaflet')
  await import('leaflet/dist/leaflet.css')
  return mod
}
