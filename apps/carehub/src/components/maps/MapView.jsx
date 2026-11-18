import { useEffect, useRef, useState } from 'react'
import { openMap } from '@care-ecosystem/design-system/components/maps/mapEngine'
import { GOOGLE_MAPS_KEY, loadLeaflet } from './mapProvider'

// Concrete colours: map markers are drawn by the map library, which cannot read the theme's CSS variables. The
// legend uses the same values.
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

// CareHub's map: Google Maps when a key is configured, OpenStreetMap otherwise (mapEngine picks and falls back).
// The map library loads only when a map is shown, markers are circles coloured by tone, and the view fits the pins
// unless fit is off.
//   onPinClick(pin)                  a marker was clicked
//   onViewChange(bounds, zoom)       the visible area, when the map is ready and after every move
export default function MapView({ pins, height = 420, onPinClick, onViewChange, fit = true, label = 'Map', open = openMap }) {
  const handlers = useRef({ onPinClick, onViewChange })
  handlers.current = { onPinClick, onViewChange }
  const box = useRef(null)
  const map = useRef(null)
  const [status, setStatus] = useState('loading') // loading | ready | failed

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const handle = await open(box.current, { googleApiKey: GOOGLE_MAPS_KEY, loadLeaflet, zoom: 11 })
        if (cancelled) { handle.destroy(); return }
        map.current = handle
        handle.onViewChange((bounds, zoom) => { if (handlers.current.onViewChange) handlers.current.onViewChange(bounds, zoom) })
        setStatus('ready')
      } catch (e) {
        console.error('[maps] map could not be loaded', e)
        if (!cancelled) setStatus('failed')
      }
    })()
    return () => {
      cancelled = true
      if (map.current) { map.current.destroy(); map.current = null }
    }
  }, [open])

  useEffect(() => {
    const handle = map.current
    if (status !== 'ready' || !handle) return
    const list = pins || []
    handle.setMarkers(list.map((pin) => {
      const color = TONE_COLOR[pin.tone] || TONE_COLOR.visit
      return {
        lat: pin.lat, lng: pin.lng, color, title: pin.title,
        radius: pin.kind === 'rep' ? 9 : 7,
        fillOpacity: pin.kind === 'quiet' ? 0.25 : 0.7,
        popup: popupContent(pin),
        onClick: () => { if (handlers.current.onPinClick) handlers.current.onPinClick(pin) },
      }
    }))
    if (fit) handle.fitTo(list.map((p) => ({ lat: p.lat, lng: p.lng })), { padding: 30, maxZoom: 16, singleZoom: 15 })
  }, [pins, status, fit])

  if (status === 'failed') {
    return <div role='status' style={{ padding: '16px', fontSize: '13px' }}>The map could not be loaded. The list below shows the same information.</div>
  }
  return (
    <div style={{ position: 'relative' }}>
      <div ref={box} role='region' aria-label={label} aria-busy={status === 'loading'}
        style={{ height, width: '100%', borderRadius: '12px', overflow: 'hidden', zIndex: 0, position: 'relative' }} />
      {status === 'loading' && (
        <div role='status' style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: '#6b7280', pointerEvents: 'none' }}>
          Loading map…
        </div>
      )}
    </div>
  )
}
