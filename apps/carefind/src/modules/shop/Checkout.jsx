// Checkout — address, contact, delivery preference, fee calculation (Part B engine) + shop_orders RPC
// Fee math is pure (pricing.js) — delivery distance is approved-city bracketed; cross-city → quote_pending

import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from './CartProvider'
import { useAuth } from '../../providers/AuthContext'
import { orderRepository } from './orderRepository'
import { addressesRepository } from '../account/addressesRepository'
import { calculateTotalFees } from './pricing'
import { buildOrderRequest, orderErrorMessage } from './checkoutOrder'
import { validatePromoCode, applyPromoCodeToOrder } from './promoCodeRepository'
import { shopPaymentService } from './shopPaymentService'
import { shopRepository } from './shopRepository'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { theme } from '../../styles/theme'
import { Card, Button, Input, Textarea, Empty } from '../../components/ui'
import { ArrowLeft, MapPin, Truck, Package, AlertTriangle, Plus, Star, Tag, CheckCircle, X, ShoppingCart } from 'lucide-react'

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
  const { isMobile } = useBreakpoint()
  const isGuest = !user

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
  const [payLoading, setPayLoading] = useState(false)
  const [error, setError] = useState('')
  const [savedAddresses, setSavedAddresses] = useState([])
  const [selectedAddressId, setSelectedAddressId] = useState('')
  const [saveAddress, setSaveAddress] = useState(false)
  const [addressesLoading, setAddressesLoading] = useState(true)
  const [addressPreFilled, setAddressPreFilled] = useState(false)
  
  // Promo code state
  const [promoCode, setPromoCode] = useState('')
  const [promoValidation, setPromoValidation] = useState(null) // { valid, discount_kobo, promo_code_id, error }
  const [promoLoading, setPromoLoading] = useState(false)
  const [promoApplied, setPromoApplied] = useState(false)

  // Pre-checkout stock validation state
  const [stockErrors, setStockErrors] = useState([]) // [{ product_name, requested, available, ecommerce_product_id }]
  const { removeItem } = useCart()

  useEffect(() => {
    async function loadAddresses() {
      if (!user) return
      try {
        const addrs = await addressesRepository.list(user.id)
        setSavedAddresses(addrs)
        const defaultAddr = addrs.find(a => a.is_default)
        if (defaultAddr && !addressPreFilled) {
          setSelectedAddressId(defaultAddr.id)
          setFormData(prev => ({
            ...prev,
            street: defaultAddr.street,
            city: defaultAddr.city,
            state: defaultAddr.state,
          }))
          setAddressPreFilled(true)
        }
      } catch {} finally { setAddressesLoading(false) }
    }
    loadAddresses()
  }, [user, addressPreFilled])

  function handleSelectAddress(addrId) {
    setSelectedAddressId(addrId)
    if (addrId === '__new__') {
      setFormData(prev => ({ ...prev, street: '', city: '', state: '' }))
      return
    }
    const addr = savedAddresses.find(a => a.id === addrId)
    if (addr) {
      setFormData(prev => ({
        ...prev,
        street: addr.street,
        city: addr.city,
        state: addr.state,
      }))
    }
  }

  useEffect(() => {
    async function loadStations() {
      try {
        const data = await shopRepository.getPickupStations()
        setStations(data)
        if (data.length > 0) setPickupStationId(data[0].id)
      } catch {}
    }
    loadStations()
  }, [])

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
  const discountKobo = promoValidation?.valid ? promoValidation.discount_kobo : 0
  const grandTotal = total + fees.fulfilment + (deliveryFeeDisplay ? 0 : fees.delivery) - discountKobo

  // A phone gets one column, tighter cards, and delivery options as full-width tappable rows
  const cardPadding = isMobile ? 16 : 24
  const twoUp = isMobile ? '1fr' : '1fr 1fr'
  const summaryRow = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }
  const radioStyle = { width: 20, height: 20, margin: '2px 0 0', flexShrink: 0, accentColor: theme.tealDeep }
  const optionStyle = (selected) => ({
    display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', minHeight: 44, padding: 12, borderRadius: 12,
    border: `1px solid ${selected ? theme.tealDeep : theme.border}`, background: selected ? `${theme.tealDeep}0D` : '#fff',
  })
  // the out-of-zone note is shown once city and state are filled in; before that nothing is "pending"
  const outsideZone = !approved && Boolean(formData.city && formData.state)
  const selectedStation = stations.find(st => st.id === pickupStationId)

  // Every order is paid online with Paystack. Pay at Pickup is paused: nothing can record a cash payment yet, so such an order could
  // never be accepted (docs/architecture/Shop-Flow-Review.md, SD-2).

  async function handleValidatePromoCode() {
    if (!promoCode.trim() || !user) return
    
    setPromoLoading(true)
    setPromoValidation(null)
    
    try {
      const result = await validatePromoCode(
        promoCode.trim(),
        user.id,
        total, // order total before fees
        segment
      )
      
      setPromoValidation(result)
      
      if (result.valid) {
        setPromoApplied(true)
      }
    } catch (err) {
      setPromoValidation({ valid: false, error: 'Failed to validate promo code' })
    } finally {
      setPromoLoading(false)
    }
  }

  function handleRemovePromoCode() {
    setPromoCode('')
    setPromoValidation(null)
    setPromoApplied(false)
  }

  async function maybeSaveAddress() {
    if (!saveAddress || !user || !formData.street || !formData.city || !formData.state) return
    try {
      await addressesRepository.create({
        user_id: user.id,
        label: 'Home',
        street: formData.street,
        city: formData.city,
        state: formData.state,
        is_default: savedAddresses.length === 0,
      })
    } catch (err) {
      console.warn('Could not save address:', err.message || err)
    }
  }

  async function initiatePaystackForOrder(orderId) {
    const { url } = await shopPaymentService.startShopPayment(orderId)
    window.location.href = url
    return true
  }

  // Pre-checkout stock validation — queries real-time stock for all cart items
  async function validateStock() {
    const ecomIds = [...new Set(items.map(i => i.ecommerce_product_id).filter(Boolean))]
    if (ecomIds.length === 0) return []
    const data = await shopRepository.validateStock(ecomIds)
    const errors = []
    for (const item of items) {
      const ecom = data.find(d => d.id === item.ecommerce_product_id)
      const stock = ecom?.products?.stock ?? 0
      if (stock < item.quantity) {
        errors.push({
          ecommerce_product_id: item.ecommerce_product_id,
          product_name: item.product_name || ecom?.products?.name || 'Unknown',
          requested: item.quantity,
          available: stock,
        })
      }
    }
    return errors
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    // Pre-checkout stock validation
    setStockErrors([])
    const stockIssues = await validateStock()
    if (stockIssues.length > 0) {
      setStockErrors(stockIssues)
      return
    }
    // Create the order, then pay for it with Paystack. Home delivery outside the approved cities cannot be paid yet: the seller
    // quotes delivery first, and the customer pays the full amount from the order page.
    const awaitingQuote = deliveryFeeDisplay
    setLoading(true)
    if (!awaitingQuote) setPayLoading(true)
    setError('')

    let orderId
    try {
      orderId = await orderRepository.create(buildOrderRequest({
        items,
        subtotalKobo: total,
        fees,
        form: formData,
        deliveryPreference: formData.delivery_preference,
        approvedCity: approved,
        distanceKm,
        pickupStationId,
        user,
        paymentReference: `CF-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`,
      }))
    } catch (err) {
      setError(orderErrorMessage(err))
      setLoading(false)
      setPayLoading(false)
      return
    }

    // The order exists (and holds its stock) from here on. Whatever happens next, the customer leaves checkout (to Paystack or to
    // the order page) with an empty cart: staying here would let a second submit create a duplicate order. The cart is cleared at
    // the moment of leaving, so the page never flashes "Your cart is empty" in between.
    await maybeSaveAddress()

    let notice = ''
    if (promoValidation?.valid && promoValidation.promo_code_id) {
      const applied = await applyPromoCodeToOrder(orderId, promoValidation.promo_code_id, promoValidation.discount_kobo)
      if (!applied.success) notice = 'Your promo code could not be applied, so this order is at full price. You can pay for it or cancel it here.'
    }

    let tone = 'error'
    if (awaitingQuote && !notice) {
      notice = 'Your order is placed. The seller will quote delivery, and we will let you know when you can pay.'
      tone = 'info'
    } else if (!notice) {
      try {
        await initiatePaystackForOrder(orderId)
        clearCart()
        return
      } catch (err) {
        notice = `${err.message || 'Could not start payment'} Your order is saved — you can pay for it here.`
      }
    }
    clearCart()
    setLoading(false)
    setPayLoading(false)
    navigate(`/orders/${orderId}`, notice ? { state: { notice, tone } } : undefined)
  }


  // Only after every hook: returning before useMemo above made the hook count change when the cart loaded (the cart is read
  // after the first render), which crashed the page ("Rendered more hooks than during the previous render") on a refresh.
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

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: isMobile ? '12px 16px 32px' : '24px 16px' }}>
      <button
        type="button"
        onClick={() => navigate('/cart')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 44,
          padding: 0,
          background: 'none',
          border: 'none',
          color: theme.tealDeep,
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          marginBottom: isMobile ? 4 : 16
        }}
      >
        <ArrowLeft size={16} />
        Back to Cart
      </button>

      <h1 style={{ fontSize: isMobile ? 22 : 24, fontWeight: 700, marginBottom: isMobile ? 12 : 16, color: theme.navy }}>
        Checkout
      </h1>
      {segment !== 'retail' && (
        <p style={{ fontSize: 12, color: theme.textLight, marginBottom: 16 }}>Order type: <b style={{ textTransform:'capitalize' }}>{segment}</b></p>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 16 : 24 }}>
          <Card style={{ padding: cardPadding }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: theme.navy, display: 'flex', alignItems: 'center', gap: 8 }}>
              <MapPin size={20} />
              Delivery Address
            </h2>
            {!addressesLoading && savedAddresses.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: theme.textMid, display: 'block', marginBottom: 4 }}>Select a saved address</label>
                <select
                  value={selectedAddressId}
                  onChange={(e) => handleSelectAddress(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 10,
                    border: `1px solid ${theme.border}`, background: '#fff', fontSize: 13, fontFamily: 'inherit',
                  }}
                >
                  {savedAddresses.map((addr) => (
                    <option key={addr.id} value={addr.id}>
                      {addr.label}{addr.is_default ? ' (Default)' : ''} — {addr.street}, {addr.city}
                    </option>
                  ))}
                  <option value="__new__">+ Add new address</option>
                </select>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: twoUp, gap: 12 }}>
                <Input label="Customer Name" value={formData.customer_name} onChange={(v) => setFormData({ ...formData, customer_name: v })} placeholder="Full name" required />
                <Input label="Phone" value={formData.customer_phone} onChange={(v) => setFormData({ ...formData, customer_phone: v })} placeholder="080..." required />
              </div>
              <Input label="Email" value={formData.customer_email} onChange={(v) => setFormData({ ...formData, customer_email: v })} placeholder="you@example.com" required />
              <Input
                label="Street Address"
                value={formData.street}
                onChange={(v) => setFormData({ ...formData, street: v })}
                placeholder="123 Main Street"
                required
              />
              <div style={{ display: 'grid', gridTemplateColumns: twoUp, gap: 12 }}>
                <Input
                  label="City"
                  value={formData.city}
                  onChange={(v) => setFormData({ ...formData, city: v })}
                  placeholder="Lagos"
                  required
                />
                <Input
                  label="State"
                  value={formData.state}
                  onChange={(v) => setFormData({ ...formData, state: v })}
                  placeholder="Lagos State"
                  required
                />
              </div>
              <Textarea label="Delivery Instructions" value={formData.delivery_instructions} onChange={(v) => setFormData({ ...formData, delivery_instructions: v })} placeholder="Landmark, gate code..." rows={2} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={saveAddress}
                  onChange={(e) => setSaveAddress(e.target.checked)}
                  style={{ width: 20, height: 20, flexShrink: 0, accentColor: theme.tealDeep }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: theme.textMid }}>Save this address for future orders</span>
              </label>
              {outsideZone && (
                <div role="status" style={{ padding: 12, borderRadius: 8, background: theme.amberBg || '#FFF7ED', border: `1px solid ${theme.warning}30`, color: theme.warning, fontSize: 13, display:'flex', gap:8 }}>
                  <AlertTriangle size={16} style={{ flexShrink:0, marginTop:2 }} />
                  <span>Your address is outside our standard delivery zone. Place your order and the seller will quote delivery, usually within 24 hours. We will notify and email you, and you then pay for the products and delivery together. Pickup from a station needs no quote.</span>
                </div>
              )}
            </div>
          </Card>

          <Card style={{ padding: cardPadding }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: theme.navy, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Truck size={20} />
              Delivery Preference
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={optionStyle(formData.delivery_preference === 'pickup')}>
                <input
                  type="radio"
                  name="delivery_preference"
                  value="pickup"
                  checked={formData.delivery_preference === 'pickup'}
                  onChange={(e) => setFormData({ ...formData, delivery_preference: e.target.value })}
                  style={radioStyle}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: theme.navy }}>
                    Pickup from a station <span style={{ color: theme.success }}>· Free</span>
                  </div>
                  <div style={{ fontSize: 14, color: theme.textMid }}>
                    Collect your order from a pickup station. We text you when it is ready.
                  </div>
                </div>
              </label>
              {formData.delivery_preference === 'pickup' && (
                <div style={{ marginLeft: isMobile ? 0 : 32 }}>
                  <label htmlFor="checkout-pickup-station" style={{ fontSize: 12, fontWeight: 700, color: theme.textMid, display:'block', marginBottom:4 }}>Pickup station *</label>
                  {/* the option shows the station's name only: name + address did not fit a phone-width select and was cut off */}
                  <select id="checkout-pickup-station" value={pickupStationId} onChange={e=>setPickupStationId(e.target.value)} required style={{ width:'100%', minHeight: 44, padding:'10px 12px', borderRadius:10, border:`1px solid ${theme.border}`, background:'#fff', fontSize:14, fontFamily:'inherit' }}>
                    {stations.length===0 ? <option value="">Loading stations...</option> : stations.map(s=>(
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  {selectedStation && (
                    <p style={{ fontSize: 13, color: theme.textMid, marginTop: 6, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <MapPin size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                      <span>{[selectedStation.address, selectedStation.city].filter(Boolean).join(', ')}</span>
                    </p>
                  )}
                </div>
              )}
              <label style={optionStyle(formData.delivery_preference === 'home')}>
                <input
                  type="radio"
                  name="delivery_preference"
                  value="home"
                  checked={formData.delivery_preference === 'home'}
                  onChange={(e) => setFormData({ ...formData, delivery_preference: e.target.value })}
                  style={radioStyle}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: theme.navy }}>
                    Home delivery
                  </div>
                  <div style={{ fontSize: 14, color: theme.textMid }}>
                    {outsideZone
                      ? 'Delivered to your address. The seller quotes delivery for your area before you pay.'
                      : 'Delivered to your address. First 3km free, then ₦600 for every 3km.'}
                  </div>
                </div>
              </label>

              {formData.delivery_preference === 'home' && approved && (
                <div style={{ marginLeft: isMobile ? 0 : 32 }}>
                  <Input
                    label="Distance from vendor (km)"
                    type="number"
                    value={distanceKm}
                    onChange={(v) => setDistanceKm(Number(v))}
                    placeholder="5"
                    min="0"
                    step="0.1"
                    required
                  />
                  <p style={{ fontSize: 12, color: theme.textMid, marginTop: 4 }}>
                    Up to 3km free · 4–6km ₦600 · 7–9km ₦1,200 · 10–12km ₦1,800
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card style={{ padding: cardPadding }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: theme.navy }}>
              Order Summary
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* what is being bought, line by line, before the fees */}
              <ul aria-label="Items in this order" style={{ listStyle: 'none', margin: 0, padding: '0 0 12px', borderBottom: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map(item => (
                  <li key={item.ecommerce_product_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ color: theme.navy, fontWeight: 600, overflowWrap: 'anywhere' }}>{item.product_name}</span>
                      <span style={{ display: 'block', fontSize: 12, color: theme.textMid }}>{item.quantity} × ₦{(item.unit_price_kobo / 100).toLocaleString()}</span>
                    </span>
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>₦{((item.unit_price_kobo * item.quantity) / 100).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <div style={summaryRow}>
                <span style={{ color: theme.textMid }}>Items subtotal ({totalQty} {totalQty === 1 ? 'item' : 'items'})</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>₦{(total / 100).toLocaleString()}</span>
              </div>
              <div style={summaryRow}>
                <span style={{ color: theme.textMid }}>Fulfilment fee</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>₦{(fees.fulfilment / 100).toLocaleString()}</span>
              </div>
              {formData.delivery_preference === 'home' && !deliveryFeeDisplay && (
                <div style={summaryRow}>
                  <span style={{ color: theme.textMid }}>Delivery</span>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {fees.delivery === 0 ? 'Free' : `₦${(fees.delivery / 100).toLocaleString()}`}
                  </span>
                </div>
              )}
              {deliveryFeeDisplay && (
                <div style={summaryRow}>
                  <span style={{ color: theme.textMid }}>Delivery</span>
                  <span style={{ fontWeight: 600, color: theme.warning, textAlign: 'right' }}>To be quoted</span>
                </div>
              )}
              
              {/* Promo Code Section */}
              <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12, marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label htmlFor="checkout-promo" style={{ fontSize: 12, fontWeight: 700, color: theme.textMid, display: 'block', marginBottom: 4 }}>
                      <Tag size={12} style={{ display: 'inline', marginRight: 4 }} />
                      Promo Code
                    </label>
                    <input
                      id="checkout-promo"
                      type="text"
                      value={promoCode}
                      onChange={(e) => {
                        setPromoCode(e.target.value.toUpperCase())
                        if (promoApplied) {
                          setPromoApplied(false)
                          setPromoValidation(null)
                        }
                      }}
                      placeholder="Enter promo code"
                      disabled={promoApplied}
                      style={{
                        width: '100%',
                        minHeight: 44,
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: `1px solid ${promoValidation?.valid ? theme.success : promoValidation?.error ? theme.danger : theme.border}`,
                        fontSize: 13,
                        fontFamily: 'inherit',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {promoApplied ? (
                      <button
                        type="button"
                        onClick={handleRemovePromoCode}
                        style={{
                          minHeight: 44,
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: `1px solid ${theme.border}`,
                          background: '#fff',
                          color: theme.textMid,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <X size={14} />
                        Remove
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleValidatePromoCode}
                        disabled={promoLoading || !promoCode.trim()}
                        style={{
                          minHeight: 44,
                          padding: '10px 16px',
                          borderRadius: 8,
                          border: 'none',
                          background: promoLoading || !promoCode.trim() ? theme.gray200 : theme.tealDeep,
                          color: '#fff',
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: promoLoading || !promoCode.trim() ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {promoLoading ? 'Validating...' : 'Apply'}
                      </button>
                    )}
                  </div>
                </div>
                
                {/* Promo code validation message */}
                {promoValidation && (
                  <div style={{
                    marginTop: 8,
                    padding: 10,
                    borderRadius: 8,
                    background: promoValidation.valid ? theme.successBg : theme.dangerBg,
                    border: `1px solid ${promoValidation.valid ? theme.success : theme.danger}30`,
                    fontSize: 12,
                    color: promoValidation.valid ? theme.success : theme.danger,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}>
                    {promoValidation.valid ? (
                      <>
                        <CheckCircle size={14} />
                        <span>
                          {promoValidation.description || 'Promo code applied!'} 
                          {promoValidation.discount_type === 'percentage' 
                            ? ` (${promoValidation.discount_value}% off)`
                            : ` (₦${(promoValidation.discount_kobo / 100).toLocaleString()} off)`
                          }
                        </span>
                      </>
                    ) : (
                      <span>{promoValidation.error}</span>
                    )}
                  </div>
                )}
              </div>
              
              {/* Discount display */}
              {promoValidation?.valid && (
                <div style={{ ...summaryRow, color: theme.success }}>
                  <span>Discount</span>
                  <span style={{ fontWeight: 600 }}>-₦{(discountKobo / 100).toLocaleString()}</span>
                </div>
              )}
              
              <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12, marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 18, fontWeight: 700 }}>
                  <span style={{ color: theme.navy }}>{deliveryFeeDisplay ? 'Total before delivery' : 'Total'}</span>
                  <span style={{ color: theme.tealDeep }}>₦{(grandTotal / 100).toLocaleString()}</span>
                </div>
                {deliveryFeeDisplay && <div style={{ fontSize: 11, color: theme.textLight, textAlign:'right', marginTop: 4 }}>Plus delivery (to be quoted)</div>}
              </div>
            </div>
          </Card>

          <div role="note" style={{ padding: 12, borderRadius: 8, background: theme.tealMist, border: `1px solid ${theme.tealDeep}20`, fontSize: 12, color: theme.textMid, textAlign: 'center' }}>
            {deliveryFeeDisplay
              ? <>Delivery to your area is quoted by the seller. Place your order now — you pay once delivery is quoted.</>
              : <>You pay securely with <b>Paystack</b> (card, bank transfer, USSD). Your order is confirmed once Paystack confirms the payment.</>}
          </div>

          {stockErrors.length > 0 && (
            <div role="alert" style={{
              padding: 16,
              borderRadius: 12,
              background: theme.dangerBg,
              border: `1px solid ${theme.dangerBorder}`,
              color: theme.danger,
              fontSize: 13
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, fontWeight:700 }}>
                <AlertTriangle size={18} /> Some items are out of stock
              </div>
              <div style={{ fontSize:12, color: theme.textMid, marginBottom:12 }}>
                The following items have insufficient stock. Remove them or reduce quantity to continue.
              </div>
              {stockErrors.map(se => (
                <div key={se.ecommerce_product_id} style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'10px 12px', marginBottom:8, borderRadius:8,
                  background:'#fff', border:`1px solid ${theme.border}`
                }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, color: theme.navy, fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{se.product_name}</div>
                    <div style={{ fontSize:11, color: theme.textMid, marginTop:2 }}>
                      Requested: {se.requested} · Available: {se.available}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      removeItem(se.ecommerce_product_id)
                      setStockErrors(prev => prev.filter(e => e.ecommerce_product_id !== se.ecommerce_product_id))
                    }}
                    style={{
                      marginLeft:12, flexShrink:0, minHeight: 44,
                      padding:'6px 14px', borderRadius:8,
                      border:`1px solid ${theme.danger}`, background:'#fff',
                      color: theme.danger, fontWeight:700, fontSize:12, cursor:'pointer'
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

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
            disabled={loading || payLoading}
            style={{
              width: '100%',
              padding: '16px 24px',
              fontSize: 16,
              fontWeight: 600,
              opacity: (loading||payLoading) ? 0.7 : 1
            }}
          >
            {payLoading ? 'Redirecting to Paystack...' : loading ? 'Creating Order...' : deliveryFeeDisplay ? 'Place Order — Get Delivery Quote' : `Pay ₦${(grandTotal/100).toLocaleString()} with Paystack`}
          </Button>
          <p style={{ fontSize: 11, color: theme.textLight, textAlign:'center' }}>Payments secured by Paystack</p>
        </div>
      </form>
    </div>
  )
}
