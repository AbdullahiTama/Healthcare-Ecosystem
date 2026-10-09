import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { theme } from '../../styles/theme'
import { boundingBox } from '../business-directory/services/distance'

// Pins are DOM divIcons rather than Leaflet's default image markers: the
// default icon paths break under bundlers, and a DOM pin can show the list
// number so a marker and its list row are visibly the same thing.
function pinIcon(label, selected) {
  return L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div style="width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 11px Arial,sans-serif;color:#fff;background:${selected ? theme.danger : theme.tealDeep};border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.4);${selected ? 'transform:scale(1.25);' : ''}">${label}</div>`,
  })
}

/**
 * Leaflet map for Discovery results.
 * markers: [{ id, lat, lng, label, title }]; center: {lat,lng}|null; radiusKm
 * Selecting a marker calls onSelect(id); `selectedId` highlights and pans to one.
 */
export default function DiscoveryMap({ markers, center, radiusKm, selectedId, onSelect }) {
  const el = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    map.current = L.map(el.current, { zoomControl: true }).setView([9.08, 8.68], 6) // Nigeria, until results arrive
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    // Leaflet caches its size; without this the map goes blank after a resize or rotation.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.current && map.current.invalidateSize()) : null
    if (ro) ro.observe(el.current)
    return () => { if (ro) ro.disconnect(); map.current.remove(); map.current = null }
  }, [])

  useEffect(() => {
    if (!map.current) return
    layer.current.clearLayers()
    const pts = []
    if (center) {
      L.circleMarker([center.lat, center.lng], { radius: 7, color: '#fff', weight: 2, fillColor: theme.info, fillOpacity: 1 })
        .bindTooltip('Search location').addTo(layer.current)
      if (radiusKm) L.circle([center.lat, center.lng], { radius: radiusKm * 1000, color: theme.info, weight: 1, fillOpacity: 0.05 }).addTo(layer.current)
      pts.push([center.lat, center.lng])
    }
    markers.forEach((m) => {
      const mk = L.marker([m.lat, m.lng], { icon: pinIcon(m.label, m.id === selectedId), title: m.title, keyboard: true })
      mk.on('click', () => onSelectRef.current && onSelectRef.current(m.id))
      mk.addTo(layer.current)
      pts.push([m.lat, m.lng])
    })
    if (pts.length === 1) map.current.setView(pts[0], 14)
    else if (pts.length > 1) {
      // Circle#getBounds needs the circle to be on a map already, so the search
      // area is framed from our own bounding box instead.
      const box = center && radiusKm ? boundingBox(center.lat, center.lng, radiusKm) : null
      const bounds = box ? L.latLngBounds([[box.minLat, box.minLng], [box.maxLat, box.maxLng]]) : L.latLngBounds(pts)
      map.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 })
    }
  }, [markers, center, radiusKm, selectedId])

  useEffect(() => {
    if (!map.current || !selectedId) return
    const m = markers.find((x) => x.id === selectedId)
    if (m) map.current.panTo([m.lat, m.lng])
  }, [selectedId]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} role='application' aria-label='Map of search results' style={{ height: 460, borderRadius: 12, border: `1px solid ${theme.border}`, overflow: 'hidden' }} />
}
