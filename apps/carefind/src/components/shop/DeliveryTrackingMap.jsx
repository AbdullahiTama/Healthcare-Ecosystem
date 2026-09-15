import { useEffect, useRef } from 'react'
import { theme } from '../../styles/theme'

// Dynamic import for Leaflet (client-side only)
let L = null

function getLeaflet() {
  if (typeof window === 'undefined') return null
  if (!L) {
    L = require('leaflet')
    require('leaflet/dist/leaflet.css')
    // Fix default marker icon paths
    delete L.Icon.Default.prototype._getIconUrl
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png'
    })
  }
  return L
}

const NIGERIA_CENTER = [9.082, 8.6753]

export default function DeliveryTrackingMap({
  pickupStation = null,
  deliveryAddress = null,
  currentLocation = null,
  height = 300,
  style = {}
}) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markersRef = useRef([])

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const Leaflet = getLeaflet()
    if (!Leaflet) return

    const map = Leaflet.map(mapRef.current, {
      center: NIGERIA_CENTER,
      zoom: 6,
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true
    })

    Leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(map)

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapInstanceRef.current
    const Leaflet = getLeaflet()
    if (!map || !Leaflet) return

    // Clear existing markers
    markersRef.current.forEach(m => map.removeLayer(m))
    markersRef.current = []

    const bounds = []

    // Pickup station marker
    if (pickupStation?.lat && pickupStation?.lng) {
      const marker = Leaflet.marker([pickupStation.lat, pickupStation.lng])
        .addTo(map)
        .bindPopup(`<strong>${pickupStation.name}</strong><br/>${pickupStation.address || ''}`)
      markersRef.current.push(marker)
      bounds.push([pickupStation.lat, pickupStation.lng])
    }

    // Delivery address marker (if coordinates available)
    if (deliveryAddress?.lat && deliveryAddress?.lng) {
      const marker = Leaflet.circleMarker([deliveryAddress.lat, deliveryAddress.lng], {
        radius: 8,
        color: theme.tealDeep || '#0E6F5A',
        fillColor: theme.tealDeep || '#0E6F5A',
        fillOpacity: 0.8
      })
        .addTo(map)
        .bindPopup(`<strong>Delivery Address</strong><br/>${deliveryAddress.address || ''}`)
      markersRef.current.push(marker)
      bounds.push([deliveryAddress.lat, deliveryAddress.lng])
    }

    // Current location marker (for in-transit)
    if (currentLocation?.lat && currentLocation?.lng) {
      const marker = Leaflet.circleMarker([currentLocation.lat, currentLocation.lng], {
        radius: 10,
        color: '#2196F3',
        fillColor: '#2196F3',
        fillOpacity: 0.9
      })
        .addTo(map)
        .bindPopup('<strong>Current Location</strong>')
      markersRef.current.push(marker)
      bounds.push([currentLocation.lat, currentLocation.lng])
    }

    // Fit map to markers
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
    }
  }, [pickupStation, deliveryAddress, currentLocation])

  return (
    <div
      ref={mapRef}
      style={{
        width: '100%',
        height,
        borderRadius: 8,
        border: `1px solid ${theme.border || '#e5e7eb'}`,
        overflow: 'hidden',
        ...style
      }}
    />
  )
}
