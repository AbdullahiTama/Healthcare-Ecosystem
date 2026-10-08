import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { Card, Loading, Empty } from '../../components/ui'
import DeliveryTrackingMap from '../../components/shop/DeliveryTrackingMap'
import { Package, Clock, CheckCircle, Truck, MapPin, Calendar, ExternalLink } from 'lucide-react'

const STATUS_ICONS = {
  paid: { icon: CheckCircle, label: 'Order Placed', color: theme.success },
  accepted: { icon: CheckCircle, label: 'Confirmed', color: theme.success },
  processing: { icon: Package, label: 'Preparing', color: theme.tealDeep },
  ready_for_pickup: { icon: MapPin, label: 'Ready for Pickup', color: theme.tealDeep },
  in_transit: { icon: Truck, label: 'On the Way', color: theme.tealDeep },
  delivered: { icon: CheckCircle, label: 'Delivered', color: theme.success },
  cancelled: { icon: Package, label: 'Cancelled', color: theme.danger }
}

const TRACKING_STEPS = [
  { key: 'paid', label: 'Placed' },
  { key: 'accepted', label: 'Confirmed' },
  { key: 'processing', label: 'Preparing' },
  { key: 'ready_for_pickup', label: 'Ready' },
  { key: 'in_transit', label: 'On the Way' },
  { key: 'delivered', label: 'Delivered' }
]

export default function PublicTracking() {
  const { token } = useParams()
  const [tracking, setTracking] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadTracking()
  }, [token])

  async function loadTracking() {
    setLoading(true)
    setError('')
    try {
      const { data, error: rpcError } = await supabase.rpc('get_tracking_by_token', {
        p_token: token
      })

      if (rpcError) throw rpcError
      if (data?.error) {
        setError(data.error)
        return
      }

      setTracking(data)
    } catch (err) {
      console.error('Failed to load tracking:', err)
      setError('Unable to load tracking information. The link may be invalid or expired.')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <Loading />

  if (error || !tracking) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '48px 16px' }}>
        <Empty
          icon={<Package size={48} />}
          title="Tracking unavailable"
          description={error || 'This tracking link is invalid or has expired.'}
        />
      </div>
    )
  }

  const currentStepIndex = TRACKING_STEPS.findIndex(s => s.key === tracking.status)
  const latestEvent = tracking.tracking_events?.[0]
  const currentLocation = latestEvent?.location

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: theme.tealDeep + '15',
          marginBottom: 16
        }}>
          <Package size={28} color={theme.tealDeep} />
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: theme.navy, margin: '0 0 8px' }}>
          Order Tracking
        </h1>
        <div style={{ fontSize: 14, color: theme.textMid }}>
          Order ref: <strong>{tracking.order_ref}</strong>
        </div>
      </div>

      {/* Status Badge */}
      <Card style={{ padding: 20, marginBottom: 16, textAlign: 'center' }}>
        {(() => {
          const statusInfo = STATUS_ICONS[tracking.status] || STATUS_ICONS.paid
          const Icon = statusInfo.icon
          return (
            <>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 20px',
                borderRadius: 20,
                background: statusInfo.color + '15',
                marginBottom: 12
              }}>
                <Icon size={18} color={statusInfo.color} />
                <span style={{ fontSize: 15, fontWeight: 600, color: statusInfo.color }}>
                  {statusInfo.label}
                </span>
              </div>
              {tracking.estimated_delivery && tracking.status !== 'delivered' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, color: theme.tealDeep, fontWeight: 600, marginTop: 8 }}>
                  <Calendar size={14} />
                  Estimated delivery: {new Date(tracking.estimated_delivery).toLocaleDateString('en-NG', {
                    weekday: 'short', month: 'short', day: 'numeric'
                  })}
                </div>
              )}
            </>
          )
        })()}
      </Card>

      {/* Progress Bar */}
      {!['cancelled', 'pending_payment', 'disputed'].includes(tracking.status) && (
        <Card style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            {TRACKING_STEPS.map((step, idx) => {
              const isCompleted = currentStepIndex >= idx
              const isCurrent = step.key === tracking.status
              return (
                <div key={step.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                  {idx > 0 && (
                    <div style={{
                      position: 'absolute', top: 10, right: '50%', width: '100%', height: 2,
                      background: isCompleted ? theme.tealDeep : theme.gray200, zIndex: 0
                    }} />
                  )}
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: isCompleted ? theme.tealDeep : '#fff',
                    border: `2px solid ${isCompleted ? theme.tealDeep : theme.gray300}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1
                  }}>
                    {isCompleted && <CheckCircle size={12} color="#fff" />}
                  </div>
                  <div style={{
                    marginTop: 6, fontSize: 9, fontWeight: isCurrent ? 700 : 500,
                    color: isCompleted ? theme.tealDeep : theme.textMid, textAlign: 'center'
                  }}>
                    {step.label}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Map */}
      {tracking.status === 'in_transit' && currentLocation && (
        <Card style={{ padding: 16, marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: theme.navy, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Truck size={16} /> Live Location
          </h3>
          <DeliveryTrackingMap
            currentLocation={currentLocation}
            height={200}
          />
        </Card>
      )}

      {/* Tracking Timeline */}
      <Card style={{ padding: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: theme.navy, marginBottom: 16 }}>
          Tracking History
        </h3>
        {tracking.tracking_events && tracking.tracking_events.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {tracking.tracking_events.map((event, idx) => {
              const statusInfo = STATUS_ICONS[event.status] || STATUS_ICONS.paid
              const Icon = statusInfo.icon
              return (
                <div key={idx} style={{ display: 'flex', gap: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: idx === 0 ? statusInfo.color + '15' : theme.gray200,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Icon size={14} color={idx === 0 ? statusInfo.color : theme.textMid} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.navy }}>
                      {statusInfo.label}
                    </div>
                    {event.notes && (
                      <div style={{ fontSize: 12, color: theme.textMid, marginTop: 2 }}>
                        {event.notes}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: theme.textLight, marginTop: 4 }}>
                      {new Date(event.created_at).toLocaleString('en-NG', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: theme.textMid, textAlign: 'center', padding: 16 }}>
            No tracking updates yet. Check back soon.
          </p>
        )}
      </Card>

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: 24, padding: 16 }}>
        <div style={{ fontSize: 12, color: theme.textLight }}>
          Powered by <strong style={{ color: theme.tealDeep }}>CareFind</strong>
        </div>
        <a
          href="/"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8,
            fontSize: 13, color: theme.tealDeep, textDecoration: 'none', fontWeight: 600
          }}
        >
          <ExternalLink size={12} /> Visit CareFind
        </a>
      </div>
    </div>
  )
}
