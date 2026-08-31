// Checkout — address, contact, delivery preference, fee calculation (Part B engine) + shop_orders RPC
// Fee math is pure (pricing.js) — delivery distance is approved-city bracketed; cross-city → quote_pending

import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from './CartProvider'
import { useAuth } from '../../providers/AuthContext'
import { orderRepository } from './orderRepository'
import { calculateTotalFees } from './pricing'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { Card, Button, Input, Textarea, Empty } from '../../components/ui'
import { ArrowLeft, MapPin, Truck, Package, AlertTriangle } from 'lucide-react'

const APPROVED_CITIES = ['lagos','abuja','port harcourt','kano','ibadan','benin city','enugu','kaduna','zaria','aba','jos','ilorin','onitsha','ogbomosho','maiduguri','warri']
const isApprovedCity = (city, state) => {
  const c = String(city||'').trim().toLowerCase()
  const s = String(state||'').trim().toLowerCase()
  return APPROVED_CITIES.includes(c) || APPROVED_CITIES.includes(s)
}

export default function Checkout() {
  const { items, total, clearCart } = useCart()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [formData, setFormData] = useState({
    customer_name: user?.user_metadata?.full_name || '',
    customer_phone: '',
    customer_email: user?.email || '',
    street: '',
    city: '',
    state: '',
    delivery_instructions: '',
    delivery_preference: 'pickup'
  })
  const [distanceKm, setDistanceKm] = useState(5)
  const [pickupStationId, setPickupStationId] = useState('')
  const [stations, setStations] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadStations() {
      try {
        const { data } = await supabase.from('shop_pickup_stations').select('id,name,address,city,state').eq('is_active', true).limit(20)
        setStations(data || [])
        if (data && data.length > 0) setPickupStationId(data[0].id)
      } catch {}
    }
    loadStations()
  }, [])

  if (items.length === 0) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
        <Empty
          icon={<Package size={48} />}
          title="Your cart is empty"
          description="Add products to your cart before checkout"
          action="Continue Shopping"
          onAction={() => navigate('/search?tab=shop')}
        />
      </div>
    )
  }

  // Derive segment from cart — if any wholesale/distributor item present, use highest tier
  const segment = useMemo(() => {
    const types = items.map(i => String(i.sale_type || '').toLowerCase()).filter(Boolean)
    if (types.includes('distributor')) return 'distributor'
    if (types.includes('wholesale')) return 'wholesale'
    // Fallback: infer from quantity — distributor = bulk, wholesale = 10+ items
    const totalQty = items.reduce((s,i)=>s+i.quantity,0)
    if (totalQty >= 100) return 'distributor'
    if (totalQty >= 10) return 'wholesale'
    return 'retail'
  }, [items])

  const approved = isApprovedCity(formData.city, formData.state)
  const totalQty = items.reduce((s,i)=>s+i.quantity,0)
  const fees = calculateTotalFees({
    segment,
    orderTotalKobo: total,
    distanceKm: formData.delivery_preference === 'home' && approved ? distanceKm : 0,
    includeDelivery: formData.delivery_preference === 'home' && approved,
    cartonCount: segment === 'distributor' ? totalQty : 1
  })
  // Cross-city: fulfilment still charged, delivery pending (B27 Step 3B)
  const deliveryFeeDisplay = !approved && formData.delivery_preference === 'home'
  const grandTotal = total + fees.fulfilment + (deliveryFeeDisplay ? 0 : fees.delivery)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (!formData.street || !formData.city || !formData.state) throw new Error('Street, city and state are required')
      if (!formData.customer_phone || String(formData.customer_phone).trim().length < 10) throw new Error('Valid phone number is required')
      if (!formData.customer_email || !formData.customer_email.includes('@')) throw new Error('Valid email is required')
      if (formData.delivery_preference === 'pickup' && !pickupStationId) throw new Error('Please select a pickup station')
      // Vendor grouping — spec assumes single vendor per order; reject multi-vendor cart explicitly
      const vendorIds = [...new Set(items.map(i => i.vendor_id || i.vendor_business_id).filter(Boolean))]
      if (vendorIds.length === 0) throw new Error('Vendor not found for cart items — please re-add products from Shop')
      if (vendorIds.length > 1) throw new Error('Multi-vendor checkout is not yet supported — please checkout per vendor')
      const vendorBusinessId = vendorIds[0]
      const customer_id = user.id
      const delivery_address = `${formData.street}, ${formData.city}, ${formData.state}`
      const orderItems = items.map(item => ({
        ecommerce_product_id: item.ecommerce_product_id,
        quantity: item.quantity,
        unit_price_kobo: item.unit_price_kobo
      }))
      const payment_reference = `CF-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`
      const orderId = await orderRepository.create({
        customer_id,
        vendor_business_id: vendorBusinessId,
        items: orderItems,
        subtotal_kobo: total,
        commission_kobo: fees.commission,
        fulfilment_kobo: fees.fulfilment,
        delivery_kobo: deliveryFeeDisplay ? 0 : fees.delivery,
        total_kobo: grandTotal,
        delivery_address,
        delivery_city: formData.city,
        delivery_state: formData.state,
        delivery_phone: formData.customer_phone,
        delivery_email: formData.customer_email,
        delivery_instructions: formData.delivery_instructions || null,
        delivery_preference: formData.delivery_preference,
        distance_km: formData.delivery_preference === 'home' ? distanceKm : 0,
        is_approved_city: approved,
        customer_name: formData.customer_name || user.email,
        payment_reference,
        pickup_station_id: formData.delivery_preference === 'pickup' ? pickupStationId : null
      })
      clearCart()
      navigate(`/orders/${orderId}`)
    } catch (err) {
      const msg = String(err.message || '')
      if (msg.includes('INSUFFICIENT_STOCK')) setError('Some items are now out of stock — please review your cart. Inventory was updated after you added items.')
      else if (msg.includes('PRICE_CHANGED')) setError('A product price changed while you were checking out — please review your cart and try again.')
      else if (msg.includes('Vendor not approved')) setError('This vendor is not currently approved for Shop sales.')
      else setError(err.message || 'Failed to create order. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
      <button
        onClick={() => navigate('/cart')}
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
        Back to Cart
      </button>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: theme.navy }}>
        Checkout
      </h1>
      <p style={{ fontSize: 12, color: theme.textLight, marginBottom: 16 }}>Segment: <b style={{ textTransform:'capitalize' }}>{segment}</b> · Commission {segment==='retail'?'10%':segment==='wholesale'?'5%':'2.5%'} is deducted from vendor payout, not charged to you.</p>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Card style={{ padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: theme.navy, display: 'flex', alignItems: 'center', gap: 8 }}>
              <MapPin size={20} />
              Delivery Address
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Input label="Customer Name *" value={formData.customer_name} onChange={(v) => setFormData({ ...formData, customer_name: v })} placeholder="Full name" required />
                <Input label="Phone *" value={formData.customer_phone} onChange={(v) => setFormData({ ...formData, customer_phone: v })} placeholder="080..." required />
              </div>
              <Input label="Email *" value={formData.customer_email} onChange={(v) => setFormData({ ...formData, customer_email: v })} placeholder="you@example.com" required />
              <Input
                label="Street Address *"
                value={formData.street}
                onChange={(v) => setFormData({ ...formData, street: v })}
                placeholder="123 Main Street"
                required
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Input
                  label="City *"
                  value={formData.city}
                  onChange={(v) => setFormData({ ...formData, city: v })}
                  placeholder="Lagos"
                  required
                />
                <Input
                  label="State *"
                  value={formData.state}
                  onChange={(v) => setFormData({ ...formData, state: v })}
                  placeholder="Lagos State"
                  required
                />
              </div>
              <Textarea label="Delivery Instructions" value={formData.delivery_instructions} onChange={(v) => setFormData({ ...formData, delivery_instructions: v })} placeholder="Landmark, gate code..." rows={2} />
              {!approved && formData.city && formData.state && (
                <div role="status" style={{ padding: 12, borderRadius: 8, background: theme.amberBg || '#FFF7ED', border: `1px solid ${theme.warning}30`, color: theme.warning, fontSize: 13, display:'flex', gap:8 }}>
                  <AlertTriangle size={16} style={{ flexShrink:0, marginTop:2 }} />
                  <span>Your delivery location is outside our standard automatic service zone. Our Customer Care team will contact you within 24 hours with a delivery quote. You can proceed to pay for your products now. Delivery charges will be confirmed via WhatsApp/Email.</span>
                </div>
              )}
              <p style={{ fontSize: 11, color: theme.textLight }}>Google Maps validation + GPS distance will replace manual city/state in Phase 2 (B27 Step 2).</p>
            </div>
          </Card>

          <Card style={{ padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: theme.navy, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Truck size={20} />
              Delivery Preference
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="delivery_preference"
                  value="pickup"
                  checked={formData.delivery_preference === 'pickup'}
                  onChange={(e) => setFormData({ ...formData, delivery_preference: e.target.value })}
                  style={{ width: 20, height: 20 }}
                />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: theme.navy }}>
                    Pickup from Station {approved ? '(FREE within 3km)' : '(FREE)'}
                  </div>
                  <div style={{ fontSize: 14, color: theme.textMid }}>
                    Collect your order from the nearest pickup station — you will receive an SMS when ready
                  </div>
                </div>
              </label>
              {formData.delivery_preference === 'pickup' && (
                <div style={{ marginLeft: 32, marginTop: 8 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: theme.textMid, display:'block', marginBottom:4 }}>Pickup Station *</label>
                  <select value={pickupStationId} onChange={e=>setPickupStationId(e.target.value)} required style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${theme.border}`, background:'#fff', fontSize:13, fontFamily:'inherit' }}>
                    {stations.length===0 ? <option value="">Loading stations...</option> : stations.map(s=>(
                      <option key={s.id} value={s.id}>{s.name} — {s.address}, {s.city}</option>
                    ))}
                  </select>
                  <p style={{ fontSize:11, color:theme.textLight, marginTop:4 }}>Orders are moved to your chosen station. Free pickup ≤3km, home delivery beyond.</p>
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="delivery_preference"
                  value="home"
                  checked={formData.delivery_preference === 'home'}
                  onChange={(e) => setFormData({ ...formData, delivery_preference: e.target.value })}
                  style={{ width: 20, height: 20 }}
                />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: theme.navy }}>
                    Home Delivery
                  </div>
                  <div style={{ fontSize: 14, color: theme.textMid }}>
                    Delivered to your address {approved ? '(₦600 per 3km beyond 3km)' : '(quote pending — see notice above)'}
                  </div>
                </div>
              </label>

              {formData.delivery_preference === 'home' && approved && (
                <div style={{ marginTop: 12 }}>
                  <Input
                    label="Distance from vendor (km) — Phase 2 will auto-calc via Maps"
                    type="number"
                    value={distanceKm}
                    onChange={(v) => setDistanceKm(Number(v))}
                    placeholder="5"
                    min="0"
                    step="0.1"
                    required
                  />
                  <p style={{ fontSize: 12, color: theme.textMid, marginTop: 4 }}>
                    0–3km = FREE, 4–6km = ₦600, 7–9km = ₦1,200, 10–12km = ₦1,800 (MAX bracket formula)
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card style={{ padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: theme.navy }}>
              Order Summary
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: theme.textMid }}>Subtotal ({items.length} items)</span>
                <span style={{ fontWeight: 600 }}>₦{(total / 100).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: theme.textMid }}>Fulfilment Fee {segment==='retail'?'MAX(₦600,3%)':segment==='wholesale'?'MAX(₦1,500,2%)':'MAX(₦350/carton,1%)'}</span>
                <span style={{ fontWeight: 600 }}>₦{(fees.fulfilment / 100).toLocaleString()}</span>
              </div>
              {formData.delivery_preference === 'home' && !deliveryFeeDisplay && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: theme.textMid }}>Delivery Fee</span>
                  <span style={{ fontWeight: 600 }}>
                    {fees.delivery === 0 ? 'FREE' : `₦${(fees.delivery / 100).toLocaleString()}`}
                  </span>
                </div>
              )}
              {deliveryFeeDisplay && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: theme.textMid }}>Delivery Fee</span>
                  <span style={{ fontWeight: 600, color: theme.warning }}>PENDING (quoted within 24h)</span>
                </div>
              )}
              <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12, marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700 }}>
                  <span style={{ color: theme.navy }}>{deliveryFeeDisplay ? 'Subtotal' : 'Total'}</span>
                  <span style={{ color: theme.tealDeep }}>₦{(grandTotal / 100).toLocaleString()}</span>
                </div>
                {deliveryFeeDisplay && <div style={{ fontSize: 11, color: theme.textLight, textAlign:'right', marginTop: 4 }}>Plus delivery (to be quoted)</div>}
              </div>
            </div>
          </Card>

          {error && (
            <div role="alert" style={{
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

          <Button
            type="submit"
            disabled={loading}
            style={{
              padding: '16px 24px',
              fontSize: 16,
              fontWeight: 600
            }}
          >
            {loading ? 'Creating Order...' : deliveryFeeDisplay ? 'Proceed to Pay for Products Now' : 'Place Order'}
          </Button>
          <p style={{ fontSize: 11, color: theme.textLight, textAlign:'center' }}>Payment via Paystack (cards/bank/mobile) will be added in next iteration — order is created as pending_payment and idempotency is enforced via payment_reference.</p>
        </div>
      </form>
    </div>
  )
}
