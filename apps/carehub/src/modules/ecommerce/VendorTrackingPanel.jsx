import { useState, useEffect } from 'react'
import { MapPin, Send, Link, Clock, CheckCircle, Truck, Package, Copy } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, TealBtn, GhostBtn, Inp, useToast } from '../../components/ui'
import { sbFetch } from '../../services/supabase'

const STATUS_OPTIONS = [
  { value: 'accepted', label: 'Accepted', icon: CheckCircle },
  { value: 'processing', label: 'Processing', icon: Package },
  { value: 'ready_for_pickup', label: 'Ready for Pickup', icon: MapPin },
  { value: 'in_transit', label: 'In Transit', icon: Truck },
  { value: 'delivered', label: 'Delivered', icon: CheckCircle }
]

const STATUS_ICONS = {
  paid: { icon: Clock, label: 'Order Placed', color: theme.warning },
  accepted: { icon: CheckCircle, label: 'Accepted', color: theme.success },
  processing: { icon: Package, label: 'Processing', color: theme.tealDeep },
  ready_for_pickup: { icon: MapPin, label: 'Ready for Pickup', color: theme.tealDeep },
  in_transit: { icon: Truck, label: 'In Transit', color: theme.tealDeep },
  delivered: { icon: CheckCircle, label: 'Delivered', color: theme.success }
}

function fmtStamp(d) {
  if (!d) return ''
  return new Date(d).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function VendorTrackingPanel({ order, onStatusUpdate }) {
  const { show: showToast } = useToast()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [newStatus, setNewStatus] = useState('')
  const [notes, setNotes] = useState('')
  const [location, setLocation] = useState({ lat: '', lng: '' })
  const [submitting, setSubmitting] = useState(false)
  const [trackingToken, setTrackingToken] = useState(null)
  const [copied, setCopied] = useState(false)
  const [gettingLocation, setGettingLocation] = useState(false)

  useEffect(() => {
    if (order?.id) loadEvents()
  }, [order?.id])

  async function loadEvents() {
    setLoading(true)
    try {
      const rows = await sbFetch(
        `shop_order_tracking_events?order_id=eq.${order.id}&order=created_at.desc&select=*`
      )
      setEvents(rows || [])
    } catch (err) {
      console.error('Failed to load tracking events:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleGetCurrentLocation() {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported by your browser', { type: 'warning' })
      return
    }
    setGettingLocation(true)
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
      })
      setLocation({
        lat: pos.coords.latitude.toFixed(6),
        lng: pos.coords.longitude.toFixed(6)
      })
      showToast('Location captured', { type: 'success' })
    } catch (err) {
      showToast('Could not get location: ' + (err.message || 'Permission denied'), { type: 'error' })
    } finally {
      setGettingLocation(false)
    }
  }

  async function handleAddEvent() {
    if (!newStatus) {
      showToast('Select a status', { type: 'warning' })
      return
    }
    setSubmitting(true)
    try {
      const locationData = location.lat && location.lng
        ? { lat: parseFloat(location.lat), lng: parseFloat(location.lng) }
        : null

      await sbFetch('rpc/add_tracking_event', {
        method: 'POST',
        body: JSON.stringify({
          p_order_id: order.id,
          p_status: newStatus,
          p_notes: notes || null,
          p_location: locationData
        })
      })

      showToast('Tracking event added', { type: 'success' })
      setNewStatus('')
      setNotes('')
      setLocation({ lat: '', lng: '' })
      await loadEvents()
      if (onStatusUpdate) onStatusUpdate()
    } catch (err) {
      showToast(err.message || 'Failed to add event', { type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleGenerateToken() {
    try {
      const rows = await sbFetch('rpc/generate_tracking_token', {
        method: 'POST',
        body: JSON.stringify({ p_order_id: order.id })
      })
      const token = Array.isArray(rows) ? rows[0] : rows
      setTrackingToken(token)
      showToast('Tracking link generated', { type: 'success' })
    } catch (err) {
      showToast(err.message || 'Failed to generate tracking link', { type: 'error' })
    }
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/track/${trackingToken}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const trackingUrl = trackingToken ? `${window.location.origin}/track/${trackingToken}` : null
  const nextStatuses = STATUS_OPTIONS.filter(opt => {
    const currentIdx = STATUS_OPTIONS.findIndex(s => s.value === order?.status)
    const optIdx = STATUS_OPTIONS.findIndex(s => s.value === opt.value)
    return optIdx > currentIdx
  })

  if (!order || order.delivery_preference === 'pickup') return null

  return (
    <Card style={{ padding: 20 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: theme.navy, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Truck size={18} /> Delivery Tracking
      </h3>

      {/* Add Tracking Event */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.navy, marginBottom: 8 }}>Update Status</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {nextStatuses.map(opt => {
            const Icon = opt.icon
            return (
              <GhostBtn
                key={opt.value}
                onClick={() => setNewStatus(opt.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: `1px solid ${newStatus === opt.value ? theme.tealDeep : theme.border}`,
                  background: newStatus === opt.value ? theme.tealDeep + '10' : 'white',
                  color: newStatus === opt.value ? theme.tealDeep : theme.navy,
                  fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4
                }}
              >
                <Icon size={12} /> {opt.label}
              </GhostBtn>
            )
          })}
        </div>

        {newStatus && (
          <>
            <Inp
              value={notes}
              onChange={setNotes}
              placeholder="Add notes (optional)"
              style={{ marginBottom: 8 }}
            />

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                <Inp
                  value={location.lat}
                  onChange={v => setLocation(prev => ({ ...prev, lat: v }))}
                  placeholder="Latitude"
                  style={{ flex: 1 }}
                />
                <Inp
                  value={location.lng}
                  onChange={v => setLocation(prev => ({ ...prev, lng: v }))}
                  placeholder="Longitude"
                  style={{ flex: 1 }}
                />
              </div>
              <GhostBtn
                onClick={handleGetCurrentLocation}
                disabled={gettingLocation}
                style={{ padding: '8px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <MapPin size={12} /> {gettingLocation ? '...' : 'GPS'}
              </GhostBtn>
            </div>

            <TealBtn onClick={handleAddEvent} disabled={submitting} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Send size={14} /> {submitting ? 'Saving...' : 'Update Tracking'}
            </TealBtn>
          </>
        )}
      </div>

      {/* Tracking Link */}
      <div style={{ marginBottom: 20, padding: 12, borderRadius: 8, background: theme.bg || '#f9fafb' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.navy, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Link size={14} /> Share Tracking Link
        </div>
        {trackingToken ? (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <input
                value={trackingUrl}
                readOnly
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: 6, border: `1px solid ${theme.border}`,
                  fontSize: 12, color: theme.textMid, background: 'white'
                }}
              />
              <GhostBtn onClick={handleCopyLink} style={{ padding: '6px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                {copied ? <CheckCircle size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
              </GhostBtn>
            </div>
            <div style={{ fontSize: 11, color: theme.textLight }}>
              Link expires in 30 days. Share this with the customer for order tracking.
            </div>
          </div>
        ) : (
          <GhostBtn onClick={handleGenerateToken} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <Link size={14} /> Generate Tracking Link
          </GhostBtn>
        )}
      </div>

      {/* Tracking Events Timeline */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.navy, marginBottom: 8 }}>Event History</div>
        {loading ? (
          <div style={{ fontSize: 12, color: theme.textMid, padding: 12 }}>Loading events...</div>
        ) : events.length === 0 ? (
          <div style={{ fontSize: 12, color: theme.textMid, padding: 12, textAlign: 'center' }}>
            No tracking events yet. Add one above to start tracking.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {events.map((event, idx) => {
              const statusInfo = STATUS_ICONS[event.status] || STATUS_ICONS.paid
              const Icon = statusInfo.icon
              return (
                <div key={event.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: idx < events.length - 1 ? `1px solid ${theme.border}` : 'none' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: idx === 0 ? statusInfo.color + '15' : theme.gray200 || '#f3f4f6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Icon size={12} color={idx === 0 ? statusInfo.color : theme.textMid} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: theme.navy }}>{statusInfo.label}</div>
                    {event.notes && <div style={{ fontSize: 11, color: theme.textMid, marginTop: 2 }}>{event.notes}</div>}
                    {event.location && (
                      <div style={{ fontSize: 10, color: theme.textLight, marginTop: 2 }}>
                        lat {event.location.lat?.toFixed(4)}, lng {event.location.lng?.toFixed(4)}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: theme.textLight, marginTop: 4 }}>{fmtStamp(event.created_at)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}
