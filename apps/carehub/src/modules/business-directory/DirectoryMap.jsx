import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from './googleMapsLoader'

// Google map for Business Discovery. Presentation only: the parent owns the
// results and the selected id, so list and map cannot drift apart.
//
//   markers     [{ id, lat, lng, name }]  directory businesses with valid coordinates
//   origin      { lat, lng } | null       the search origin, drawn as a blue dot
//   selectedId  string | null
//   onSelect    (id) => void              marker click
//   onPick      ({lat,lng}) => void       map click, used to choose a location manually
//
// If Google Maps is unavailable it renders a plain message. The list remains
// the source of truth and keeps working.
export default function DirectoryMap({ markers, origin, selectedId, onSelect, onPick }) {
  const box = useRef(null)
  const state = useRef({ map: null, markers: new Map(), originMarker: null })
  const [status, setStatus] = useState('loading') // loading | ready | unavailable
  const [reason, setReason] = useState('')
  const cb = useRef({ onSelect, onPick })
  useEffect(() => { cb.current = { onSelect, onPick } })

  useEffect(() => {
    let alive = true
    loadGoogleMaps().then((maps) => {
      if (!alive || !box.current) return
      state.current.maps = maps
      state.current.map = new maps.Map(box.current, { center: { lat: 9.082, lng: 8.6753 }, zoom: 6, mapTypeControl: false, streetViewControl: false })
      state.current.map.addListener('click', (e) => { if (cb.current.onPick && e.latLng) cb.current.onPick({ lat: e.latLng.lat(), lng: e.latLng.lng() }) })
      setStatus('ready')
    }).catch((e) => { if (alive) { setReason(e.reason || 'unavailable'); setStatus('unavailable') } })
    return () => { alive = false }
  }, [])

  // Markers follow the results.
  useEffect(() => {
    const { map, maps } = state.current
    if (status !== 'ready' || !map) return
    const live = state.current.markers
    live.forEach((m) => m.setMap(null)); live.clear()
    const bounds = new maps.LatLngBounds()
    markers.forEach((p) => {
      const m = new maps.Marker({ map, position: { lat: p.lat, lng: p.lng }, title: p.name })
      m.addListener('click', () => cb.current.onSelect && cb.current.onSelect(p.id))
      live.set(p.id, m); bounds.extend(m.getPosition())
    })
    if (state.current.originMarker) { state.current.originMarker.setMap(null); state.current.originMarker = null }
    if (origin) {
      state.current.originMarker = new maps.Marker({
        map, position: origin, title: 'Search location', zIndex: 1,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      })
      bounds.extend(origin)
    }
    if (markers.length || origin) { map.fitBounds(bounds, 48); if (markers.length + (origin ? 1 : 0) === 1) map.setZoom(14) }
  }, [markers, origin, status])

  // Selecting a list row highlights its marker.
  useEffect(() => {
    const { map, maps } = state.current
    if (status !== 'ready' || !map) return
    state.current.markers.forEach((m, id) => {
      m.setAnimation(id === selectedId ? maps.Animation.BOUNCE : null)
      m.setZIndex(id === selectedId ? 10 : 2)
    })
    const sel = state.current.markers.get(selectedId)
    if (sel) map.panTo(sel.getPosition())
  }, [selectedId, status])

  if (status === 'unavailable') {
    return (
      <div role="note" style={{ padding: 16, border: '1px dashed var(--border)', borderRadius: 10, fontSize: 13, color: 'var(--muted)' }}>
        {reason === 'not_configured'
          ? 'The map is not set up for this workspace yet. Results are shown in the list, and each business has a Google Maps directions link.'
          : 'The map could not be loaded. Results are shown in the list, and each business has a Google Maps directions link.'}
      </div>
    )
  }
  return (
    <div style={{ position: 'relative' }}>
      <div ref={box} role="application" aria-label="Map of search results" style={{ width: '100%', height: 360, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)' }} />
      {status === 'loading' && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--muted)' }}>Loading map...</div>}
    </div>
  )
}
