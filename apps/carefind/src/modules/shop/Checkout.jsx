// Checkout page - address form, delivery preference, fee calculation, and order creation

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from './CartProvider'
import { useAuth } from '../../providers/AuthContext'
import { orderRepository } from './orderRepository'
import { calculateTotalFees } from './pricing'
import { theme } from '../../styles/theme'
import { Card, Button, Input, Textarea, Empty } from '../../components/ui'
import { ArrowLeft, MapPin, Truck, Package } from 'lucide-react'

export default function Checkout() {
  const { items, total, clearCart } = useCart()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [formData, setFormData] = useState({
    street: '',
    city: '',
    state: '',
    delivery_preference: 'pickup'
  })
  const [distanceKm, setDistanceKm] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

  // Calculate fees using pricing engine
  const segment = 'retail' // TODO: Determine segment from products
  const fees = calculateTotalFees({
    segment,
    orderTotalKobo: total,
    distanceKm: formData.delivery_preference === 'home' ? distanceKm : 0,
    includeDelivery: formData.delivery_preference === 'home'
  })

  const grandTotal = total + fees.fulfilment + fees.delivery

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // Validate form
      if (!formData.street || !formData.city || !formData.state) {
        throw new Error('Please fill in all address fields')
      }

      // Group items by vendor (for now, assume single vendor)
      // TODO: Handle multi-vendor carts
      const vendorId = items[0].vendor_id // Assuming all items from same vendor
      const customer_id = user.id

      const delivery_address = `${formData.street}, ${formData.city}, ${formData.state}`

      // Create order items
      const orderItems = items.map(item => ({
        ecommerce_product_id: item.ecommerce_product_id,
        quantity: item.quantity,
        product_name: item.product_name,
        unit_price_kobo: item.unit_price_kobo
      }))

      // Generate payment reference (will be updated after payment)
      const payment_reference = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      // Create order
      const orderId = await orderRepository.create({
        customer_id,
        vendor_id: vendorId,
        items: orderItems,
        total_kobo: grandTotal,
        commission_kobo: fees.commission,
        fulfilment_kobo: fees.fulfilment,
        delivery_kobo: fees.delivery,
        delivery_address,
        delivery_preference: formData.delivery_preference,
        payment_reference
      })

      // Clear cart
      clearCart()

      // Navigate to order detail
      navigate(`/orders/${orderId}`)
    } catch (err) {
      console.error('Checkout error:', err)
      setError(err.message || 'Failed to create order. Please try again.')
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

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24, color: theme.navy }}>
        Checkout
      </h1>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Delivery Address */}
          <Card style={{ padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: theme.navy, display: 'flex', alignItems: 'center', gap: 8 }}>
              <MapPin size={20} />
              Delivery Address
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input
                label="Street Address"
                value={formData.street}
                onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                placeholder="123 Main Street"
                required
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Input
                  label="City"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  placeholder="Lagos"
                  required
                />
                <Input
                  label="State"
                  value={formData.state}
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  placeholder="Lagos State"
                  required
                />
              </div>
            </div>
          </Card>

          {/* Delivery Preference */}
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
                    Pickup from Station (FREE)
                  </div>
                  <div style={{ fontSize: 14, color: theme.textMid }}>
                    Collect your order from the nearest pickup station
                  </div>
                </div>
              </label>
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
                    Delivered to your address (additional fee applies)
                  </div>
                </div>
              </label>

              {formData.delivery_preference === 'home' && (
                <div style={{ marginTop: 12 }}>
                  <Input
                    label="Distance from vendor (km)"
                    type="number"
                    value={distanceKm}
                    onChange={(e) => setDistanceKm(Number(e.target.value))}
                    placeholder="5"
                    min="0"
                    step="0.1"
                    required
                  />
                  <p style={{ fontSize: 12, color: theme.textMid, marginTop: 4 }}>
                    Enter approximate distance for delivery fee calculation
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* Order Summary */}
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
                <span style={{ color: theme.textMid }}>Fulfilment Fee</span>
                <span style={{ fontWeight: 600 }}>₦{(fees.fulfilment / 100).toLocaleString()}</span>
              </div>
              {formData.delivery_preference === 'home' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: theme.textMid }}>Delivery Fee</span>
                  <span style={{ fontWeight: 600 }}>
                    {fees.delivery === 0 ? 'FREE' : `₦${(fees.delivery / 100).toLocaleString()}`}
                  </span>
                </div>
              )}
              <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12, marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700 }}>
                  <span style={{ color: theme.navy }}>Total</span>
                  <span style={{ color: theme.tealDeep }}>₦{(grandTotal / 100).toLocaleString()}</span>
                </div>
              </div>
            </div>
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

          <Button
            type="submit"
            disabled={loading}
            style={{
              padding: '16px 24px',
              fontSize: 16,
              fontWeight: 600
            }}
          >
            {loading ? 'Creating Order...' : 'Place Order'}
          </Button>
        </div>
      </form>
    </div>
  )
}
