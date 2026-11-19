import { useEffect, useRef, useState } from 'react'
import { openMap } from '@care-ecosystem/design-system/components/maps/mapEngine'
import { theme } from '../../styles/theme'
import { GOOGLE_MAPS_KEY, loadLeaflet } from '../maps/mapProvider'

const NIGERIA_CENTER = { lat: 9.082, lng: 8.6753 }
const COLORS = { pickup: '#7c3aed', delivery: theme.tealDeep || '#0E6F5A', current: '#2196F3' }

// A popup built from text nodes: the station name and the delivery address are typed by people, and the previous
// version interpolated them into an HTML string (a planted <img onerror> would have run for the customer).
export function trackingPopup(title, detail) {
  const box = document.createElement('div')
  const strong = document.createElement('strong')
  strong.textContent = title || ''
  box.appendChild(strong)
  if (detail) {
    const div = document.createElement('div')
    div.textContent = detail
    box.appendChild(div)
  }
  return box
}

const valid = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && !(Number(p.lat) === 0 && Number(p.lng) === 0)

// Pickup station, delivery address and the rider's last position on one map: Google Maps when a key is configured,
// OpenStreetMap otherwise (the shared map engine chooses, and falls back if Google is unavailable).
export default function DeliveryTrackingMap({
  pickupStation = null,
  deliveryAddress = null,
  currentLocation = null,
  height = 300,
  style = {},
  open = openMap,
}) {
  const mapRef = useRef(null)
  const handleRef = useRef(null)
  const [status, setStatus] = useState('loading') // loading | ready | failed

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const handle = await open(mapRef.current, {
          googleApiKey: GOOGLE_MAPS_KEY, loadLeaflet, center: NIGERIA_CENTER, zoom: 6, scrollWheelZoom: false,
        })
        if (cancelled) { handle.destroy(); return }
        handleRef.current = handle
        setStatus('ready')
      } catch (e) {
        console.error('[maps] delivery map could not be loaded', e)
        if (!cancelled) setStatus('failed')
      }
    })()
    return () => {
      cancelled = true
      if (handleRef.current) { handleRef.current.destroy(); handleRef.current = null }
    }
  }, [open])

  const pLat = pickupStation?.lat, pLng = pickupStation?.lng
  const dLat = deliveryAddress?.lat, dLng = deliveryAddress?.lng
  const cLat = currentLocation?.lat, cLng = currentLocation?.lng

  useEffect(() => {
    const handle = handleRef.current
    if (status !== 'ready' || !handle) return
    const markers = []
    if (valid(pickupStation)) {
      markers.push({ lat: Number(pLat), lng: Number(pLng), color: COLORS.pickup, radius: 8, title: pickupStation.name || 'Pickup station',
        popup: trackingPopup(pickupStation.name || 'Pickup station', pickupStation.address) })
    }
    if (valid(deliveryAddress)) {
      markers.push({ lat: Number(dLat), lng: Number(dLng), color: COLORS.delivery, radius: 8, title: 'Delivery address',
        popup: trackingPopup('Delivery address', deliveryAddress.address) })
    }
    if (valid(currentLocation)) {
      markers.push({ lat: Number(cLat), lng: Number(cLng), color: COLORS.current, radius: 10, fillOpacity: 0.9, title: 'Current location',
        popup: trackingPopup('Current location') })
    }
    handle.setMarkers(markers)
    if (markers.length) handle.fitTo(markers.map((m) => ({ lat: m.lat, lng: m.lng })), { padding: 40, maxZoom: 14, singleZoom: 14 })
  }, [status, pLat, pLng, dLat, dLng, cLat, cLng]) // redraw on a moved position, not on every new object from the parent

  const frame = { width: '100%', height, borderRadius: 8, border: `1px solid ${theme.border || '#e5e7eb'}`, overflow: 'hidden', ...style }
  if (status === 'failed') {
    return <div role='status' style={{ ...frame, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: theme.textMid || '#6b7280', padding: 12, textAlign: 'center', boxSizing: 'border-box' }}>The map could not be loaded. The delivery details below are up to date.</div>
  }
  return (
    <div style={{ position: 'relative' }}>
      <div ref={mapRef} role='region' aria-label='Delivery map' aria-busy={status === 'loading'} style={frame} />
      {status === 'loading' && (
        <div role='status' style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: theme.textMid || '#6b7280', pointerEvents: 'none' }}>Loading map…</div>
      )}
    </div>
  )
}
