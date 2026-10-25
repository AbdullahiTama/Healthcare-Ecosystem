import { useEffect, useRef, useState } from 'react'
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL } from '../../modules/live-activity/areaLookup'

// Concrete colours: Leaflet draws markers as SVG attributes, which cannot read the theme's CSS variables. The legend
// uses the same values.
export const TONE_COLOR = {
  current: '#16a34a', // checked in within the hour
  earlier: '#d97706', // checked in earlier today
  out: '#6b7280', // checked out
  visit: '#0f766e', // a visit
  quiet: '#dc2626', // a customer not visited in 30 days
  new: '#0f766e', // directory map: not in the directory yet
  listed: '#6b7280', // directory map: already in the directory
  duplicate: '#d97706', // directory map: possibly already in the directory
}

const LAGOS = [6.5244, 3.3792]

// Leaflet is a CommonJS bundle: depending on the bundler, import('leaflet') yields the library under .default or its
// functions directly (CareFind's maps use the latter).
export function resolveLeaflet(mod) {
  return mod && mod.default && typeof mod.default.map === 'function' ? mod.default : mod
}

// A pin's popup, built from text nodes. Names and places are typed by people; an HTML string here would let a name
// like <img onerror=...> run in the manager's session.
export function popupContent(pin) {
  const box = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = pin.title || ''
  box.appendChild(title)
  ;(pin.lines || []).forEach((line) => {
    const div = document.createElement('div')
    div.textContent = line
    box.appendChild(div)
  })
  return box
}

// A thin wrapper: Leaflet is loaded only when the map is shown (as CareFind's ResultsMap does), markers are circles
// (no image assets), and the view fits the pins unless fit is off.
//   onPinClick(pin)                  a marker was clicked
//   onViewChange(bounds, zoom)       the visible area, when the map is ready and after every move
export default function LeafletMap({ pins, height = 420, onPinClick, onViewChange, fit = true }) {
  const handlers = useRef({ onPinClick, onViewChange })
  handlers.current = { onPinClick, onViewChange }
  const box = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  const lib = useRef(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const L = resolveLeaflet(await import('leaflet'))
        await import('leaflet/dist/leaflet.css')
        if (cancelled || !box.current) return
        lib.current = L
        map.current = L.map(box.current, { center: LAGOS, zoom: 11 })
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '<a href="' + OSM_COPYRIGHT_URL + '" target="_blank" rel="noopener noreferrer">' + OSM_ATTRIBUTION + '</a>',
        }).addTo(map.current)
        layer.current = L.layerGroup().addTo(map.current)
        const report = () => {
          const b = map.current.getBounds()
          if (handlers.current.onViewChange) handlers.current.onViewChange({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, map.current.getZoom())
        }
        map.current.on('moveend', report)
        report()
        setReady(true)
      } catch (e) {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      if (map.current) { map.current.remove(); map.current = null }
    }
  }, [])

  useEffect(() => {
    const L = lib.current
    if (!ready || !L || !layer.current) return
    layer.current.clearLayers()
    const points = []
    ;(pins || []).forEach((pin) => {
      const color = TONE_COLOR[pin.tone] || TONE_COLOR.visit
      L.circleMarker([pin.lat, pin.lng], { radius: pin.kind === 'rep' ? 9 : 7, color, weight: 2, fillColor: color, fillOpacity: pin.kind === 'quiet' ? 0.25 : 0.7 })
        .bindPopup(popupContent(pin))
        .on('click', () => { if (handlers.current.onPinClick) handlers.current.onPinClick(pin) })
        .addTo(layer.current)
      points.push([pin.lat, pin.lng])
    })
    if (!fit) return
    if (points.length === 1) map.current.setView(points[0], 15)
    else if (points.length > 1) map.current.fitBounds(points, { padding: [30, 30], maxZoom: 16 })
  }, [pins, ready, fit])

  if (failed) {
    return <div role='status' style={{ padding: '16px', fontSize: '13px' }}>The map could not be loaded. The list below shows the same information.</div>
  }
  return <div ref={box} role='region' aria-label='Team map' style={{ height, width: '100%', borderRadius: '12px', overflow: 'hidden', zIndex: 0, position: 'relative' }} />
}
