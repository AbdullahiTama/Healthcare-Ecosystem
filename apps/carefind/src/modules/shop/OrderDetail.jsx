// Order detail page - displays order items, status, timeline, and communication

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { orderRepository } from './orderRepository'
import { trackingRepository } from './trackingRepository'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { theme } from '../../styles/theme'
import { Card, Button, Input, Empty, Loading } from '../../components/ui'
import { ArrowLeft, Package, Clock, CheckCircle, Truck, MapPin, MessageSquare, Send, RotateCcw, Calendar, Download, Link, Copy } from 'lucide-react'
import { STATUS_CONFIG, TRACKING_STEPS, getEstimatedDelivery } from './orderConstants'
import { useCart } from './CartProvider'
import DeliveryTrackingMap from '../../components/shop/DeliveryTrackingMap'

export default function OrderDetail() {
  const { orderId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { addItem } = useCart()

  const [order, setOrder] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)
  const [station, setStation] = useState(null)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [returnDescription, setReturnDescription] = useState('')
  const [returnData, setReturnData] = useState(null)
  const [trackingEvents, setTrackingEvents] = useState([])
  const [trackingToken, setTrackingToken] = useState(null)
  const [copiedLink, setCopiedLink] = useState(false)

  function handleReorder() {
    if (!order || !order.order_items) return
    let added = 0
    order.order_items.forEach(item => {
      if (item.ecommerce_product_id) {
        addItem({
          ecommerce_product_id: item.ecommerce_product_id,
          product_name: item.product_name,
          unit_price_kobo: item.unit_price_kobo,
          quantity: item.quantity
        })
        added++
      }
    })
    if (added > 0) {
      navigate('/cart')
    }
  }

  function handleDownloadInvoice() {
    if (!order) return
    
    const invoiceHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice - ${order.order_ref || order.id.slice(0, 8).toUpperCase()}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          .header { display: flex; justify-content: space-between; margin-bottom: 30px; }
          .header h1 { margin: 0; color: #0E6F5A; }
          .header .invoice-info { text-align: right; }
          .section { margin-bottom: 24px; }
          .section h2 { color: #0E6F5A; border-bottom: 2px solid #0E6F5A; padding-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f5f5f5; font-weight: 600; }
          .total { font-size: 18px; font-weight: 700; color: #0E6F5A; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>CareFind</h1>
            <p>Healthcare Marketplace</p>
          </div>
          <div class="invoice-info">
            <h2>INVOICE</h2>
            <p><strong>Order:</strong> ${order.order_ref || order.id.slice(0, 8).toUpperCase()}</p>
            <p><strong>Date:</strong> ${new Date(order.created_at).toLocaleDateString()}</p>
            <p><strong>Status:</strong> ${order.status}</p>
          </div>
        </div>

        <div class="section">
          <h2>Customer Details</h2>
          <p><strong>Name:</strong> ${order.customer_name || 'N/A'}</p>
          <p><strong>Email:</strong> ${order.delivery_email || 'N/A'}</p>
          <p><strong>Phone:</strong> ${order.delivery_phone || 'N/A'}</p>
          <p><strong>Address:</strong> ${order.delivery_address}, ${order.delivery_city || ''}, ${order.delivery_state || ''}</p>
        </div>

        <div class="section">
          <h2>Order Items</h2>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${order.order_items.map(item => `
                <tr>
                  <td>${item.product_name}</td>
                  <td>${item.quantity}</td>
                  <td>₦${(item.unit_price_kobo / 100).toLocaleString()}</td>
                  <td>₦${((item.quantity * item.unit_price_kobo) / 100).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="section">
          <h2>Order Summary</h2>
          <table>
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td>₦${((order.subtotal_kobo || order.total_kobo - order.fulfilment_kobo - order.delivery_kobo) / 100).toLocaleString()}</td>
              </tr>
              <tr>
                <td>Fulfilment Fee</td>
                <td>₦${(order.fulfilment_kobo / 100).toLocaleString()}</td>
              </tr>
              <tr>
                <td>Delivery Fee</td>
                <td>${order.delivery_kobo > 0 ? `₦${(order.delivery_kobo / 100).toLocaleString()}` : 'PENDING'}</td>
              </tr>
              <tr class="total">
                <td><strong>Total</strong></td>
                <td><strong>₦${(order.total_kobo / 100).toLocaleString()}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        ${order.payment_reference ? `
          <div class="section">
            <h2>Payment Information</h2>
            <p><strong>Payment Reference:</strong> ${order.payment_reference}</p>
            ${order.paystack_reference ? `<p><strong>Paystack Reference:</strong> ${order.paystack_reference}</p>` : ''}
            <p><strong>Payment Status:</strong> ${order.payment_status}</p>
          </div>
        ` : ''}

        <div class="footer">
          <p>Thank you for shopping with CareFind!</p>
          <p>For support, contact: support@carefind.ng</p>
          <p>This is a computer-generated invoice. No signature required.</p>
        </div>

        <script>
          window.onload = function() {
            if (window.location.search.includes('print=1')) {
              window.print();
            }
          }
        </script>
      </body>
      </html>
    `

    const blob = new Blob([invoiceHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const newWindow = window.open(url, '_blank')
    if (newWindow) {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  async function loadReturnData() {
    try {
      const { data } = await supabase
        .from('shop_order_returns')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setReturnData(data || null)
    } catch (err) {
      console.error('Failed to load return data:', err)
    }
  }

  async function handleRequestReturn() {
    if (!returnReason.trim()) {
      setError('Please select a return reason')
      return
    }
    setUpdating(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in to request a return')
      
      const res = await fetch('/api/request-shop-return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          order_id: orderId,
          reason: returnReason,
          description: returnDescription || null
        })
      })
      
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to request return')
      
      setShowReturnModal(false)
      setReturnReason('')
      setReturnDescription('')
      await loadOrder()
      await loadReturnData()
    } catch (err) {
      setError(err.message || 'Failed to request return')
    } finally {
      setUpdating(false)
    }
  }

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
      // Load return data if order is delivered
      if (data.status === 'delivered' || data.status === 'refund_requested' || data.status === 'refunded') {
        await loadReturnData()
      }
      // Load tracking events
      const events = await trackingRepository.getTrackingEvents(orderId)
      setTrackingEvents(events)
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
    setUpdating(true)
    try {
      await orderRepository.cancel(orderId, user.id, cancelReason || null)
      setShowCancelModal(false)
      setCancelReason('')
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

  async function handleGenerateTrackingLink() {
    try {
      const token = await trackingRepository.generateTrackingToken(orderId)
      if (token) {
        setTrackingToken(token)
      }
    } catch (err) {
      setError('Failed to generate tracking link')
    }
  }

  function handleCopyTrackingLink() {
    const url = `${window.location.origin}/track/${trackingToken}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    })
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button
                onClick={handleDownloadInvoice}
                variant="secondary"
                size="sm"
                leftIcon={<Download size={14} />}
              >
                Invoice
              </Button>
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

        {/* Tracking Link Section - for customers on non-cancelled orders */}
        {isCustomer && !['cancelled', 'pending_payment', 'delivered'].includes(order.status) && (
          <Card style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: theme.navy }}>
              <Link size={16} />
              <span style={{ fontWeight: 600 }}>Share order tracking with anyone</span>
            </div>
            {trackingToken ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200 }}>
                <input
                  value={`${window.location.origin}/track/${trackingToken}`}
                  readOnly
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: 6, border: `1px solid ${theme.border}`,
                    fontSize: 12, color: theme.textMid, background: 'white', minWidth: 0
                  }}
                />
                <button
                  onClick={handleCopyTrackingLink}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6,
                    border: `1px solid ${theme.border}`, background: copiedLink ? theme.tealDeep + '10' : 'white',
                    color: copiedLink ? theme.tealDeep : theme.navy, fontSize: 12, fontWeight: 600, cursor: 'pointer'
                  }}
                >
                  {copiedLink ? <CheckCircle size={12} /> : <Copy size={12} />}
                  {copiedLink ? 'Copied' : 'Copy'}
                </button>
              </div>
            ) : (
              <button
                onClick={handleGenerateTrackingLink}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6,
                  border: `1px solid ${theme.tealDeep}`, background: theme.tealDeep + '10',
                  color: theme.tealDeep, fontSize: 13, fontWeight: 600, cursor: 'pointer'
                }}
              >
                <Link size={14} /> Generate Tracking Link
              </button>
            )}
          </Card>
        )}

        {/* Tracking Timeline */}
        {!['cancelled', 'pending_payment', 'disputed'].includes(order.status) && (
          <Card style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: theme.navy, margin: 0 }}>
                Order Tracking
              </h2>
              {getEstimatedDelivery(order) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: theme.tealDeep, fontWeight: 600 }}>
                  <Calendar size={14} />
                  {getEstimatedDelivery(order)}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, position: 'relative' }}>
              {TRACKING_STEPS.map((step, idx) => {
                const currentStepIndex = TRACKING_STEPS.findIndex(s => s.key === order.status)
                const isCompleted = currentStepIndex >= idx || order.status === 'delivered'
                const isCurrent = step.key === order.status
                return (
                  <div key={step.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                    {/* Connector line */}
                    {idx > 0 && (
                      <div style={{
                        position: 'absolute',
                        top: 14,
                        right: '50%',
                        width: '100%',
                        height: 2,
                        background: isCompleted ? theme.tealDeep : theme.gray200,
                        zIndex: 0
                      }} />
                    )}
                    {/* Step circle */}
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: isCompleted ? theme.tealDeep : '#fff',
                      border: `2px solid ${isCompleted ? theme.tealDeep : theme.gray300}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 1,
                      boxShadow: isCurrent ? `0 0 0 4px ${theme.tealDeep}20` : 'none'
                    }}>
                      {isCompleted && <CheckCircle size={14} color="#fff" />}
                    </div>
                    {/* Step label */}
                    <div style={{
                      marginTop: 8,
                      fontSize: 10,
                      fontWeight: isCurrent ? 700 : 500,
                      color: isCompleted ? theme.tealDeep : theme.textMid,
                      textAlign: 'center'
                    }}>
                      {step.label}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {/* Delivery Tracking Map - for in-transit orders */}
        {order.status === 'in_transit' && order.delivery_preference !== 'pickup' && (
          <Card style={{ padding: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: theme.navy, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Truck size={18} /> Delivery Location
            </h2>
            <DeliveryTrackingMap
              currentLocation={trackingEvents[0]?.location}
              pickupStation={station}
              height={220}
            />
            {trackingEvents[0]?.location && (
              <div style={{ marginTop: 8, fontSize: 11, color: theme.textMid, textAlign: 'center' }}>
                Last updated: {new Date(trackingEvents[0].created_at).toLocaleString('en-NG', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                })}
              </div>
            )}
          </Card>
        )}

        {/* Tracking Events Timeline */}
        {trackingEvents.length > 0 && (
          <Card style={{ padding: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: theme.navy, marginBottom: 16 }}>
              Tracking Updates
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {trackingEvents.slice(0, 5).map((event, idx) => {
                const statusInfo = STATUS_CONFIG[event.status] || STATUS_CONFIG.paid
                const Icon = statusInfo.icon
                return (
                  <div key={event.id} style={{ display: 'flex', gap: 12 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: idx === 0 ? statusInfo.color + '15' : theme.gray200,
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Icon size={12} color={idx === 0 ? statusInfo.color : theme.textMid} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: theme.navy }}>{statusInfo.label}</div>
                      {event.notes && <div style={{ fontSize: 12, color: theme.textMid, marginTop: 2 }}>{event.notes}</div>}
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
          </Card>
        )}

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
              <span>₦{((order.subtotal_kobo || order.total_kobo - order.fulfilment_kobo - order.delivery_kobo) / 100).toLocaleString()}</span>
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
          {/* Reorder button for delivered orders */}
          {order.status === 'delivered' && isCustomer && !returnData && (
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <Button
                onClick={handleReorder}
                style={{ flex: 1 }}
                leftIcon={<RotateCcw size={16} />}
              >
                Buy Again
              </Button>
              <Button
                onClick={() => setShowReturnModal(true)}
                variant="secondary"
                style={{ flex: 1 }}
                leftIcon={<RotateCcw size={16} />}
              >
                Return / Refund
              </Button>
            </div>
          )}
          {/* Return status display */}
          {returnData && isCustomer && (
            <div style={{ marginTop: 16, padding: 16, borderRadius: 8, background: returnData.status === 'approved' ? theme.successBg : returnData.status === 'rejected' ? theme.dangerBg : theme.warningBg, border: `1px solid ${returnData.status === 'approved' ? theme.success : returnData.status === 'rejected' ? theme.danger : theme.warning}30` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <RotateCcw size={16} color={returnData.status === 'approved' ? theme.success : returnData.status === 'rejected' ? theme.danger : theme.warning} />
                <span style={{ fontWeight: 700, color: returnData.status === 'approved' ? theme.success : returnData.status === 'rejected' ? theme.danger : theme.warning }}>
                  Return {returnData.status === 'requested' ? 'Requested' : returnData.status === 'approved' ? 'Approved' : returnData.status === 'rejected' ? 'Rejected' : returnData.status}
                </span>
              </div>
              <div style={{ fontSize: 13, color: theme.textMid }}>
                <div><strong>Reason:</strong> {returnData.reason}</div>
                {returnData.description && <div style={{ marginTop: 4 }}><strong>Details:</strong> {returnData.description}</div>}
                <div style={{ marginTop: 4 }}><strong>Refund Amount:</strong> ₦{(returnData.refund_amount_kobo / 100).toLocaleString()}</div>
                <div style={{ marginTop: 4 }}><strong>Requested:</strong> {new Date(returnData.requested_at).toLocaleDateString()}</div>
                {returnData.resolution_notes && <div style={{ marginTop: 4 }}><strong>Notes:</strong> {returnData.resolution_notes}</div>}
              </div>
            </div>
          )}
          {(order.status==='pending_payment' || order.status==='paid') && isCustomer && (
            <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
              {order.status==='pending_payment' && (
                <>
                  <Button onClick={handlePayNow} disabled={updating} style={{ flex:1, minWidth: 140 }}>Pay with Paystack</Button>
                  <Button onClick={handleVerifyPayment} disabled={updating} style={{ flex:1, minWidth: 140 }}>I've Paid — Verify</Button>
                </>
              )}
              <Button variant="secondary" onClick={() => setShowCancelModal(true)} disabled={updating}>Cancel Order</Button>
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

        {/* Cancel Order Modal */}
        {showCancelModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16
          }}>
            <Card style={{ maxWidth: 480, width: '100%', padding: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: theme.navy, marginBottom: 16 }}>
                Cancel Order
              </h2>
              <p style={{ fontSize: 14, color: theme.textMid, marginBottom: 16 }}>
                Are you sure you want to cancel this order? Stock will be restored and you will receive a refund if you have already paid.
              </p>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: theme.navy, marginBottom: 8 }}>
                  Reason for cancellation (optional)
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Changed my mind, found it cheaper elsewhere, etc."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: 12,
                    borderRadius: 8,
                    border: `1px solid ${theme.border}`,
                    fontSize: 14,
                    fontFamily: 'inherit',
                    resize: 'vertical'
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowCancelModal(false)
                    setCancelReason('')
                  }}
                  disabled={updating}
                >
                  Keep Order
                </Button>
                <Button
                  variant="danger"
                  onClick={handleCancel}
                  disabled={updating}
                >
                  {updating ? 'Cancelling...' : 'Cancel Order'}
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Return/Refund Modal */}
        {showReturnModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16
          }}>
            <Card style={{ maxWidth: 480, width: '100%', padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: theme.navy, marginBottom: 16 }}>
                Request Return / Refund
              </h2>
              <p style={{ fontSize: 14, color: theme.textMid, marginBottom: 16 }}>
                You can request a return within 7 days of delivery. The vendor will review your request and respond.
              </p>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: theme.navy, marginBottom: 8 }}>
                  Reason for return *
                </label>
                <select
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 12,
                    borderRadius: 8,
                    border: `1px solid ${theme.border}`,
                    fontSize: 14,
                    fontFamily: 'inherit',
                    background: 'white'
                  }}
                >
                  <option value="">Select a reason</option>
                  <option value="defective">Product is defective or damaged</option>
                  <option value="wrong_item">Received wrong item</option>
                  <option value="not_as_described">Not as described</option>
                  <option value="quality_issue">Quality issue</option>
                  <option value="changed_mind">Changed my mind</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: theme.navy, marginBottom: 8 }}>
                  Additional details (optional)
                </label>
                <textarea
                  value={returnDescription}
                  onChange={(e) => setReturnDescription(e.target.value)}
                  placeholder="Please provide any additional details about your return request..."
                  rows={4}
                  style={{
                    width: '100%',
                    padding: 12,
                    borderRadius: 8,
                    border: `1px solid ${theme.border}`,
                    fontSize: 14,
                    fontFamily: 'inherit',
                    resize: 'vertical'
                  }}
                />
              </div>
              <div style={{ padding: 12, borderRadius: 8, background: theme.infoBg, border: `1px solid ${theme.info}30`, marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: theme.info, fontWeight: 600, marginBottom: 4 }}>Refund Amount</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: theme.navy }}>₦{(order.total_kobo / 100).toLocaleString()}</div>
                <div style={{ fontSize: 12, color: theme.textMid, marginTop: 4 }}>Full refund to original payment method</div>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowReturnModal(false)
                    setReturnReason('')
                    setReturnDescription('')
                  }}
                  disabled={updating}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRequestReturn}
                  disabled={updating || !returnReason}
                >
                  {updating ? 'Submitting...' : 'Submit Request'}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
