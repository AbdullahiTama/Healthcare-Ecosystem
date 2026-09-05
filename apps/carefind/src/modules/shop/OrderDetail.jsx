// Order detail page - displays order items, status, timeline, and communication

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { orderRepository } from './orderRepository'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { theme } from '../../styles/theme'
import { Card, Button, Input, Empty, Loading } from '../../components/ui'
import { ArrowLeft, Package, Clock, CheckCircle, Truck, MapPin, MessageSquare, Send } from 'lucide-react'

const STATUS_CONFIG = {
  pending_payment: { label: 'Pending Payment', icon: Clock, color: theme.warning },
  delivery_quote_pending: { label: 'Quote Pending', icon: Truck, color: theme.warning },
  paid: { label: 'Paid', icon: CheckCircle, color: theme.success },
  accepted: { label: 'Accepted', icon: CheckCircle, color: theme.success },
  processing: { label: 'Processing', icon: Package, color: theme.tealDeep },
  ready_for_pickup: { label: 'Ready for Pickup', icon: MapPin, color: theme.tealDeep },
  in_transit: { label: 'In Transit', icon: Truck, color: theme.tealDeep },
  delivered: { label: 'Delivered', icon: CheckCircle, color: theme.success },
  cancelled: { label: 'Cancelled', icon: Clock, color: theme.danger },
  refund_requested: { label: 'Refund Requested', icon: Clock, color: theme.warning },
  refunded: { label: 'Refunded', icon: Clock, color: theme.textMid },
  disputed: { label: 'Disputed', icon: Clock, color: theme.danger }
}

export default function OrderDetail() {
  const { orderId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [order, setOrder] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)
  const [station, setStation] = useState(null)

  useEffect(() => {
    loadOrder()
  }, [orderId])

  // Paystack return: ?reference=... — verify server-side before showing paid
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('reference') || params.get('trxref')
    if (!ref) return
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const headers = session ? { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` } : { 'Content-Type': 'application/json' }
        const res = await fetch('/api/verify-shop-payment', {
          method: 'POST',
          headers,
          body: JSON.stringify({ order_id: orderId, reference: ref }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        window.history.replaceState({}, '', window.location.pathname)
        if (res.ok) {
          await loadOrder()
        } else {
          setError(data.error || 'Could not confirm payment. Keep your reference and contact support.')
        }
      } catch (e) {
        setError('Could not confirm payment')
      }
    })()
    return () => { cancelled = true }
  }, [orderId])

  async function loadOrder() {
    setLoading(true)
    setError('')
    try {
      const data = await orderRepository.getById(orderId)
      if (!data) throw new Error('Order not found')
      setOrder(data)
      const msgs = await orderRepository.getMessages(orderId)
      setMessages(msgs)
      if (data.pickup_station_id) {
        try {
          const { data: st } = await supabase.from('shop_pickup_stations').select('id,name,address,city,state').eq('id', data.pickup_station_id).maybeSingle()
          setStation(st || null)
        } catch {}
      }
    } catch (err) {
      console.error('Failed to load order:', err)
      setError(err.message || 'Failed to load order')
    } finally {
      setLoading(false)
    }
  }

  async function handleStatusUpdate(newStatus) {
    setUpdating(true)
    try {
      await orderRepository.updateStatus(orderId, newStatus, user.id)
      await loadOrder()
    } catch (err) {
      console.error('Failed to update status:', err)
      setError(err.message || 'Failed to update status')
    } finally {
      setUpdating(false)
    }
  }
  async function handlePayNow() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setError('Please sign in to pay'); return }
    setUpdating(true)
    try {
      const res = await fetch('/api/initiate-shop-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ order_id: orderId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not start Paystack payment')
      if (data.authorization_url) window.location.href = data.authorization_url
    } catch (err) {
      setError(err.message || 'Could not start payment')
    } finally { setUpdating(false) }
  }
  async function handleVerifyPayment() {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('reference') || prompt('Enter Paystack reference:')
    if (!ref || !String(ref).trim()) return
    setUpdating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = session ? { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` } : { 'Content-Type': 'application/json' }
      const res = await fetch('/api/verify-shop-payment', {
        method: 'POST',
        headers,
        body: JSON.stringify({ order_id: orderId, reference: String(ref).trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Verification failed')
      await loadOrder()
    } catch (err) {
      setError(err.message || 'Payment verification failed')
    } finally { setUpdating(false) }
  }
  async function handleCancel() {
    if (!confirm('Cancel this order? Stock will be restored.')) return
    setUpdating(true)
    try {
      await orderRepository.cancel(orderId, user.id)
      await loadOrder()
    } catch (err) { setError(err.message || 'Cancel failed') } finally { setUpdating(false) }
  }

  async function handleSendMessage(e) {
    e.preventDefault()
    if (!newMessage.trim()) return

    try {
      await orderRepository.addMessage(orderId, user.id, newMessage)
      setNewMessage('')
      // Reload messages
      const msgs = await orderRepository.getMessages(orderId)
      setMessages(msgs)
    } catch (err) {
      console.error('Failed to send message:', err)
      setError(err.message || 'Failed to send message')
    }
  }

  if (loading) {
    return <Loading />
  }

  if (error || !order) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
        <Empty
          icon={<Package size={48} />}
          title="Order not found"
          description={error || 'This order does not exist or you do not have access'}
          action="Back to Orders"
          onAction={() => navigate('/orders')}
        />
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending_payment
  const StatusIcon = statusConfig.icon
  const isVendor = order.vendor_business_id && user?.email ? false : order.vendor_id === user.id // vendor view lives in CareHub; CareFind consumers are customers
  const isCustomer = order.customer_id === user.id

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
      <button
        onClick={() => navigate('/orders')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          color: theme.tealDeep,
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          marginBottom: 24
        }}
      >
        <ArrowLeft size={16} />
        Back to Orders
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Order Header */}
        <Card style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: theme.navy, marginBottom: 8 }}>
                Order #{order.order_ref || order.id.slice(0, 8).toUpperCase()}
              </h1>
              <p style={{ fontSize: 14, color: theme.textMid }}>
                {new Date(order.created_at).toLocaleString()} {order.payment_reference && <span>· Ref {order.payment_reference}</span>}
              </p>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 20,
              background: statusConfig.color + '20',
              color: statusConfig.color,
              fontSize: 14,
              fontWeight: 600
            }}>
              <StatusIcon size={16} />
              {statusConfig.label}
            </div>
          </div>

          {/* Delivery Info */}
          <div style={{ display: 'flex', gap: 16, paddingTop: 16, borderTop: `1px solid ${theme.border}`, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 12, color: theme.textMid, marginBottom: 4 }}>Delivery Address</div>
              <div style={{ fontSize: 14, color: theme.navy }}>{order.delivery_address} {order.delivery_city ? `, ${order.delivery_city}` : ''} {order.delivery_state ? `, ${order.delivery_state}` : ''}</div>
              {order.delivery_phone && <div style={{ fontSize: 12, color: theme.textMid }}>Phone: {order.delivery_phone}</div>}
              {order.delivery_email && <div style={{ fontSize: 12, color: theme.textMid }}>Email: {order.delivery_email}</div>}
              {order.customer_name && <div style={{ fontSize: 12, color: theme.textMid }}>Customer: {order.customer_name}</div>}
              {order.delivery_instructions && <div style={{ fontSize: 12, color: theme.textMid, fontStyle:'italic' }}>Note: {order.delivery_instructions}</div>}
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ fontSize: 12, color: theme.textMid, marginBottom: 4 }}>Delivery Method</div>
              <div style={{ fontSize: 14, color: theme.navy }}>
                {order.delivery_preference === 'pickup' ? 'Pickup from Station' : 'Home Delivery'}
              </div>
              {station && <div style={{ fontSize: 12, color: theme.tealDeep, fontWeight:600 }}>{station.name} — {station.address}, {station.city}</div>}
              {order.distance_km != null && <div style={{ fontSize: 12, color: theme.textMid }}>{order.distance_km} km {order.is_approved_city === false ? '(quote pending)' : ''}</div>}
              {order.status === 'delivery_quote_pending' && <div style={{ fontSize: 12, color: theme.warning, fontWeight: 600 }}>Delivery quote pending — we will contact you within 24h</div>}
              {order.paystack_reference && <div style={{ fontSize: 11, color: theme.textLight }}>Paystack: {order.paystack_reference}</div>}
            </div>
          </div>
        </Card>

        {/* Order Items */}
        <Card style={{ padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: theme.navy }}>
            Order Items
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {order.order_items.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${theme.border}` }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: theme.navy }}>
                    {item.product_name}
                  </div>
                  <div style={{ fontSize: 12, color: theme.textMid }}>
                    Qty: {item.quantity} × ₦{(item.unit_price_kobo / 100).toLocaleString()}
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: theme.navy }}>
                  ₦{((item.quantity * item.unit_price_kobo) / 100).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          {/* Order Totals */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
              <span style={{ color: theme.textMid }}>Subtotal</span>
              <span>₦{((order.total_kobo - order.fulfilment_kobo - order.delivery_kobo) / 100).toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
              <span style={{ color: theme.textMid }}>Fulfilment Fee</span>
              <span>₦{(order.fulfilment_kobo / 100).toLocaleString()}</span>
            </div>
            {order.delivery_kobo > 0 ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                <span style={{ color: theme.textMid }}>Delivery Fee</span>
                <span>₦{(order.delivery_kobo / 100).toLocaleString()}</span>
              </div>
            ) : order.status==='delivery_quote_pending' ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                <span style={{ color: theme.textMid }}>Delivery Fee</span>
                <span style={{ color: theme.warning, fontWeight:600 }}>PENDING</span>
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700, paddingTop: 12, borderTop: `1px solid ${theme.border}` }}>
              <span style={{ color: theme.navy }}>Total</span>
              <span style={{ color: theme.tealDeep }}>₦{(order.total_kobo / 100).toLocaleString()}</span>
            </div>
            <div style={{ fontSize:11, color:theme.textLight, marginTop:4 }}>Commission ₦{(order.commission_kobo/100).toLocaleString()} deducted from vendor payout</div>
          </div>
          {order.status==='pending_payment' && isCustomer && (
            <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
              <Button onClick={handlePayNow} disabled={updating} style={{ flex:1, minWidth: 140 }}>Pay with Paystack</Button>
              <Button onClick={handleVerifyPayment} disabled={updating} style={{ flex:1, minWidth: 140 }}>I've Paid — Verify</Button>
              <Button variant="secondary" onClick={handleCancel} disabled={updating}>Cancel Order</Button>
            </div>
          )}
          {order.status==='delivery_quote_pending' && isCustomer && (
            <div style={{ padding:10, borderRadius:8, background:theme.amberBg || '#FFF7ED', border:`1px solid ${theme.warning}30`, color:theme.warning, fontSize:12, marginTop:12 }}>
              Outside standard zone — our team will quote delivery within 24h via WhatsApp/Email. You have paid for products + fulfilment. Delivery will be added before dispatch.
            </div>
          )}
        </Card>

        {/* Status Timeline */}
        <Card style={{ padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: theme.navy }}>
            Order Timeline
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(order.shop_order_status_history || order.order_status_history || []).map((history, idx) => {
              const statusKey = history.to_status || history.status
              const config = STATUS_CONFIG[statusKey] || STATUS_CONFIG.pending_payment
              const Icon = config.icon
              return (
                <div key={history.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: config.color + '20',
                    color: config.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Icon size={16} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: theme.navy }}>
                      {config.label} {history.from_status ? <span style={{ fontWeight:400, color: theme.textMid }}>({history.from_status} → {history.to_status})</span> : null}
                    </div>
                    <div style={{ fontSize: 12, color: theme.textMid }}>
                      {new Date(history.created_at || history.changed_at).toLocaleString()} {history.note ? `· ${history.note}` : ''}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Vendor Actions */}
        {isVendor && order.status !== 'delivered' && order.status !== 'cancelled' && (
          <Card style={{ padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: theme.navy }}>
              Vendor Actions
            </h2>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {order.status === 'paid' && (
                <Button onClick={() => handleStatusUpdate('accepted')} disabled={updating}>
                  Accept Order
                </Button>
              )}
              {order.status === 'accepted' && (
                <Button onClick={() => handleStatusUpdate('processing')} disabled={updating}>
                  Start Processing
                </Button>
              )}
              {order.status === 'processing' && (
                <Button onClick={() => handleStatusUpdate('ready_for_pickup')} disabled={updating}>
                  Mark Ready for Pickup
                </Button>
              )}
              {order.status === 'ready_for_pickup' && (
                <Button onClick={() => handleStatusUpdate('delivered')} disabled={updating}>
                  Mark as Delivered
                </Button>
              )}
            </div>
          </Card>
        )}

        {/* Communication */}
        <Card style={{ padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: theme.navy, display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageSquare size={20} />
            Communication
          </h2>
          
          {/* Messages */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16, maxHeight: 400, overflowY: 'auto' }}>
            {messages.length === 0 ? (
              <p style={{ fontSize: 14, color: theme.textMid, textAlign: 'center', padding: 24 }}>
                No messages yet
              </p>
            ) : (
              messages.map(msg => (
                <div key={msg.id} style={{
                  padding: 12,
                  borderRadius: 8,
                  background: msg.sender_id === user.id ? theme.tealDeep + '10' : theme.gray200,
                  marginLeft: msg.sender_id === user.id ? 32 : 0,
                  marginRight: msg.sender_id === user.id ? 0 : 32
                }}>
                  <div style={{ fontSize: 12, color: theme.textMid, marginBottom: 4 }}>
                    {msg.profiles?.full_name || 'User'} • {new Date(msg.created_at).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 14, color: theme.navy }}>
                    {msg.message}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Send Message */}
          <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: 8 }}>
            <Input
              value={newMessage}
              onChange={(v) => setNewMessage(v)}
              placeholder="Type a message..."
              style={{ flex: 1 }}
            />
            <Button type="submit" disabled={!newMessage.trim()}>
              <Send size={16} />
            </Button>
          </form>
        </Card>

        {error && (
          <div style={{
            padding: 16,
            borderRadius: 8,
            background: theme.dangerBg,
            border: `1px solid ${theme.danger}`,
            color: theme.danger,
            fontSize: 14
          }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
