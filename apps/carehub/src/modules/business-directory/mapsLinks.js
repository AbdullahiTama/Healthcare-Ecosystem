import { isValidLatLng } from '../directory/directoryRecord.js'
import { formatDistance } from '../../lib/geo.js'

// Google Maps URLs (no API key needed). They open Google Maps in a new tab; the
// app never calls a Google web service for them. Returns null for a business
// without valid coordinates so the UI can hide the action instead of linking to
// a wrong place.

const num = (v) => (v == null || v === '' ? NaN : Number(v))

export function directionsUrl(lat, lng) {
  const la = num(lat), ln = num(lng)
  if (!isValidLatLng(la, ln)) return null
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(la + ',' + ln)
}

export function viewOnMapUrl(lat, lng) {
  const la = num(lat), ln = num(lng)
  if (!isValidLatLng(la, ln)) return null
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(la + ',' + ln)
}

// The basis is part of the label: this is a great-circle distance, not a road
// distance, and must never be presented as travel distance.
export function distanceLabel(distanceM) {
  if (distanceM == null || !Number.isFinite(Number(distanceM))) return ''
  return formatDistance(Number(distanceM)) + ' straight-line'
}
