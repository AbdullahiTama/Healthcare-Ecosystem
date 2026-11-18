// Map engine shared by CareHub and CareFind.
//
// One small interface over two providers, so a screen draws its map once:
//   - Google Maps (Maps JavaScript API), used when the app has a browser key;
//   - Leaflet with OpenStreetMap tiles, the fallback when there is no key, Google fails to load, or Google
//     rejects the key after loading (gm_authFailure: key not allowed for this site, API not enabled, billing off).
//
// handle = await openMap(element, options)
//   handle.provider                        'google' | 'leaflet' (changes to 'leaflet' if Google rejects the key;
//                                          'none' if the fallback then cannot load either)
//   handle.setMarkers(markers)              replaces every marker
//   handle.fitTo(points, { padding, maxZoom, singleZoom })
//   handle.onViewChange(fn)                 fn({ south, west, north, east }, zoom) when ready and after every move
//   handle.destroy()
//
// marker: { lat, lng, color, radius, fillOpacity, title, popup, onClick }
//   popup is a DOM node (never an HTML string): names and addresses are typed by people, and an HTML string would
//   run a planted <img onerror> in the viewer's session.
//
// No dependencies: the app passes its own Leaflet loader (this package has no node_modules), and the Google script is
// injected from maps.googleapis.com only when a key is given.

const DEFAULT_CENTER = { lat: 6.5244, lng: 3.3792 } // Lagos
const GOOGLE_TIMEOUT_MS = 12000
const CALLBACK = '__careEcosystemGoogleMapsReady'

// Leaflet is a CommonJS bundle: depending on the bundler, import('leaflet') yields the library under .default or its
// functions directly.
export function resolveLeaflet(mod) {
  return mod && mod.default && typeof mod.default.map === 'function' ? mod.default : mod
}

// ── Google script loading ──────────────────────────────────────────────────────
let googlePromise = null
let googlePromiseKey = null
const authFailureListeners = new Set()

function installAuthFailureHook(win) {
  if (win.__careEcosystemAuthHook) return
  win.__careEcosystemAuthHook = true
  const previous = win.gm_authFailure
  // Google calls this global once when it rejects the key. It is the only signal; the map otherwise shows a grey
  // "Oops! Something went wrong" panel.
  win.gm_authFailure = function () {
    if (typeof previous === 'function') { try { previous() } catch (e) { /* keep notifying */ } }
    googlePromise = null
    authFailureListeners.forEach((fn) => { try { fn() } catch (e) { console.error('[maps] fallback failed', e) } })
  }
}

/** Loads the Maps JavaScript API once per page. Resolves to window.google.maps; rejects on error or timeout. */
export function loadGoogleMaps(apiKey, { win = typeof window !== 'undefined' ? window : null, timeoutMs = GOOGLE_TIMEOUT_MS } = {}) {
  if (!win || !apiKey) return Promise.reject(new Error('Google Maps is not configured'))
  if (win.google && win.google.maps && typeof win.google.maps.Map === 'function') return Promise.resolve(win.google.maps)
  if (googlePromise && googlePromiseKey === apiKey) return googlePromise
  installAuthFailureHook(win)
  googlePromiseKey = apiKey
  googlePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { fail(new Error('Google Maps took too long to load')) }, timeoutMs)
    function fail(err) {
      clearTimeout(timer)
      googlePromise = null
      reject(err)
    }
    win[CALLBACK] = () => {
      clearTimeout(timer)
      if (win.google && win.google.maps && typeof win.google.maps.Map === 'function') resolve(win.google.maps)
      else fail(new Error('Google Maps loaded without its library'))
    }
    const script = win.document.createElement('script')
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) +
      '&v=weekly&loading=async&callback=' + CALLBACK
    script.async = true
    script.defer = true
    script.onerror = () => fail(new Error('Google Maps could not be downloaded'))
    win.document.head.appendChild(script)
  })
  return googlePromise
}

/** Test seam: forget the cached script promise. */
export function resetGoogleMapsLoader() { googlePromise = null; googlePromiseKey = null }

// ── Google engine ──────────────────────────────────────────────────────────────
export function createGoogleEngine(gm, el, { center = DEFAULT_CENTER, zoom = 11, zoomControl = true, scrollWheelZoom = true } = {}) {
  const map = new gm.Map(el, {
    center, zoom,
    zoomControl,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
    // Without wheel zoom a page that scrolls past the map keeps scrolling; two fingers / ctrl+wheel zoom the map.
    gestureHandling: scrollWheelZoom ? 'auto' : 'cooperative',
  })
  const info = new gm.InfoWindow()
  let markers = []
  let viewListener = null

  return {
    provider: 'google',
    setMarkers(list) {
      markers.forEach((m) => m.setMap(null))
      info.close()
      markers = (list || []).map((spec) => {
        const marker = new gm.Marker({
          map,
          position: { lat: spec.lat, lng: spec.lng },
          title: spec.title || '',
          icon: {
            path: gm.SymbolPath.CIRCLE,
            scale: spec.radius || 7,
            fillColor: spec.color,
            fillOpacity: spec.fillOpacity == null ? 0.8 : spec.fillOpacity,
            strokeColor: spec.color,
            strokeWeight: 2,
          },
        })
        marker.addListener('click', () => {
          if (spec.popup) { info.setContent(spec.popup); info.open({ anchor: marker, map }) }
          if (spec.onClick) spec.onClick()
        })
        return marker
      })
    },
    fitTo(points, { padding = 30, maxZoom = 16, singleZoom = 15 } = {}) {
      if (!points || !points.length) return
      if (points.length === 1) { map.setCenter(points[0]); map.setZoom(singleZoom); return }
      const bounds = new gm.LatLngBounds()
      points.forEach((p) => bounds.extend(p))
      map.fitBounds(bounds, padding)
      gm.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > maxZoom) map.setZoom(maxZoom) })
    },
    onViewChange(fn) {
      if (viewListener) viewListener.remove()
      const report = () => {
        const b = map.getBounds()
        if (!b) return
        const sw = b.getSouthWest()
        const ne = b.getNorthEast()
        fn({ south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() }, map.getZoom())
      }
      // 'idle' fires once the map has settled: after the first render and after every pan or zoom.
      viewListener = map.addListener('idle', report)
      report()
    },
    destroy() {
      markers.forEach((m) => m.setMap(null))
      markers = []
      info.close()
      if (viewListener) viewListener.remove()
      gm.event.clearInstanceListeners(map)
      el.innerHTML = ''
    },
  }
}

// ── Leaflet engine (OpenStreetMap tiles) ───────────────────────────────────────
export function createLeafletEngine(L, el, { center = DEFAULT_CENTER, zoom = 11, zoomControl = true, scrollWheelZoom = true } = {}) {
  const map = L.map(el, { center: [center.lat, center.lng], zoom, zoomControl, scrollWheelZoom })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>',
  }).addTo(map)
  const layer = L.layerGroup().addTo(map)
  let viewHandler = null

  return {
    provider: 'leaflet',
    setMarkers(list) {
      layer.clearLayers()
      ;(list || []).forEach((spec) => {
        const m = L.circleMarker([spec.lat, spec.lng], {
          radius: spec.radius || 7, color: spec.color, weight: 2, fillColor: spec.color,
          fillOpacity: spec.fillOpacity == null ? 0.8 : spec.fillOpacity,
        })
        if (spec.popup) m.bindPopup(spec.popup)
        m.on('click', () => { if (spec.onClick) spec.onClick() })
        m.addTo(layer)
      })
    },
    fitTo(points, { padding = 30, maxZoom = 16, singleZoom = 15 } = {}) {
      if (!points || !points.length) return
      if (points.length === 1) { map.setView([points[0].lat, points[0].lng], singleZoom); return }
      map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [padding, padding], maxZoom })
    },
    onViewChange(fn) {
      if (viewHandler) map.off('moveend', viewHandler)
      viewHandler = () => {
        const b = map.getBounds()
        fn({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, map.getZoom())
      }
      map.on('moveend', viewHandler)
      viewHandler()
    },
    destroy() { map.remove() },
  }
}

// ── openMap: pick the provider, fall back when Google is unavailable ───────────
/**
 * @param {HTMLElement} el
 * @param {{ googleApiKey?: string, loadLeaflet: () => Promise<any>, center?, zoom?, zoomControl?, scrollWheelZoom?,
 *           win?: Window, loadGoogle?: typeof loadGoogleMaps }} options
 */
export async function openMap(el, options) {
  const { googleApiKey, loadLeaflet, win = typeof window !== 'undefined' ? window : null, loadGoogle = loadGoogleMaps, ...mapOptions } = options
  const toLeaflet = async () => createLeafletEngine(resolveLeaflet(await loadLeaflet()), el, mapOptions)

  let engine = null
  if (googleApiKey) {
    try {
      engine = createGoogleEngine(await loadGoogle(googleApiKey, { win }), el, mapOptions)
    } catch (e) {
      console.warn('[maps] Google Maps unavailable, using OpenStreetMap:', e && e.message)
    }
  }
  if (!engine) engine = await toLeaflet()

  // Remember what the screen asked for, so a late switch to Leaflet redraws the same map.
  const last = { markers: null, fit: null, view: null }
  let destroyed = false
  const handle = {
    provider: engine.provider,
    setMarkers(m) { last.markers = m; engine.setMarkers(m) },
    fitTo(points, opts) { last.fit = [points, opts]; engine.fitTo(points, opts) },
    onViewChange(fn) { last.view = fn; engine.onViewChange(fn) },
    destroy() {
      destroyed = true
      authFailureListeners.delete(onAuthFailure)
      engine.destroy()
    },
  }

  async function onAuthFailure() {
    authFailureListeners.delete(onAuthFailure)
    if (destroyed || engine.provider !== 'google') return
    console.warn('[maps] Google rejected the API key (check its allowed websites, enabled APIs and billing); using OpenStreetMap')
    engine.destroy()
    try {
      engine = await toLeaflet()
    } catch (e) {
      // Nothing left to draw with: leave the empty map rather than throw out of Google's callback.
      console.error('[maps] OpenStreetMap fallback could not be loaded', e)
      engine = { provider: 'none', setMarkers() {}, fitTo() {}, onViewChange() {}, destroy() {} }
    }
    handle.provider = engine.provider
    if (destroyed) { engine.destroy(); return }
    if (last.markers) engine.setMarkers(last.markers)
    if (last.fit) engine.fitTo(last.fit[0], last.fit[1])
    if (last.view) engine.onViewChange(last.view)
  }
  if (engine.provider === 'google') authFailureListeners.add(onAuthFailure)

  return handle
}

/** Test seam: simulate Google calling gm_authFailure. */
export function notifyGoogleAuthFailure() {
  authFailureListeners.forEach((fn) => fn())
}
