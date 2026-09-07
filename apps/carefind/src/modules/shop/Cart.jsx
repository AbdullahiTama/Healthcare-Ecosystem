// Cart page - displays cart items, allows quantity updates, removal, and checkout

import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from './CartProvider'
import { useAuth } from '../../providers/AuthContext'
import { theme } from '../../styles/theme'
import { Card, Button, Empty, Loading } from '../../components/ui'
import { ShoppingCart, Trash2, Plus, Minus, ArrowRight } from 'lucide-react'

function SwipeToDelete({ onDelete, children }) {
  const [offsetX, setOffsetX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const startX = useRef(null)

  const onTouchStart = (e) => { startX.current = e.touches[0].clientX; setSwiping(true) }
  const onTouchMove = (e) => {
    if (startX.current == null) return
    const dx = e.touches[0].clientX - startX.current
    if (dx < 0) setOffsetX(Math.max(dx, -100))
  }
  const onTouchEnd = () => {
    if (offsetX < -70) onDelete()
    setOffsetX(0)
    startX.current = null
    setSwiping(false)
  }

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 12 }}>
      <div style={{ position: 'absolute', inset: 0, background: theme.danger, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 16, color: '#fff', fontWeight: 700, fontSize: 13, borderRadius: 12 }}>
        Delete
      </div>
      <div style={{ transform: `translateX(${offsetX}px)`, transition: swiping ? 'none' : 'transform 0.2s ease', position: 'relative', zIndex: 1, background: '#fff', borderRadius: 12 }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {children}
      </div>
    </div>
  )
}

export default function Cart() {
  const { items, count, total, updateQuantity, removeItem } = useCart()
  const { user } = useAuth()
  const navigate = useNavigate()

  if (items.length === 0) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
        <Empty
          icon={<ShoppingCart size={48} />}
          title="Your cart is empty"
          description="Browse our shop and add products to your cart"
          action="Continue Shopping"
          onAction={() => navigate('/search?tab=shop')}
        />
      </div>
    )
  }

  const handleCheckout = () => {
    if (!user) {
      navigate('/login', { state: { from: '/checkout' } })
      return
    }
    navigate('/checkout')
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24, color: theme.navy }}>
        Shopping Cart ({count} {count === 1 ? 'item' : 'items'})
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {items.map(item => (
          <SwipeToDelete key={item.ecommerce_product_id} onDelete={() => removeItem(item.ecommerce_product_id)}>
          <Card style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              {/* Product image */}
              <div style={{
                width: 80,
                height: 80,
                borderRadius: 8,
                background: item.image_url ? `url(${item.image_url}) center/cover` : theme.gray200,
                flexShrink: 0
              }} />

              {/* Product details */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: theme.navy }}>
                  {item.product_name}
                </h3>
                <p style={{ fontSize: 14, color: theme.textMid, marginBottom: 8 }}>
                  ₦{(item.unit_price_kobo / 100).toLocaleString()} each
                </p>

                {/* Quantity controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => updateQuantity(item.ecommerce_product_id, item.quantity - 1)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      border: `1px solid ${theme.border}`,
                      background: 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    aria-label="Decrease quantity"
                  >
                    <Minus size={16} />
                  </button>
                  <span style={{ fontSize: 16, fontWeight: 600, minWidth: 32, textAlign: 'center' }}>
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => updateQuantity(item.ecommerce_product_id, item.quantity + 1)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      border: `1px solid ${theme.border}`,
                      background: 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    aria-label="Increase quantity"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              {/* Price and remove */}
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 18, fontWeight: 700, color: theme.tealDeep, marginBottom: 8 }}>
                  ₦{((item.unit_price_kobo * item.quantity) / 100).toLocaleString()}
                </p>
                <button
                  onClick={() => removeItem(item.ecommerce_product_id)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: `1px solid ${theme.danger}`,
                    background: 'white',
                    color: theme.danger,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 14
                  }}
                  aria-label="Remove item"
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              </div>
            </div>
           </Card>
          </SwipeToDelete>
        ))}
      </div>

      {/* Cart summary */}
      <Card style={{ padding: 24, marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: theme.navy }}>
            Subtotal ({count} {count === 1 ? 'item' : 'items'})
          </span>
          <span style={{ fontSize: 24, fontWeight: 700, color: theme.tealDeep }}>
            ₦{(total / 100).toLocaleString()}
          </span>
        </div>
        <p style={{ fontSize: 14, color: theme.textMid, marginBottom: 12 }}>
          Delivery and fulfilment fees will be calculated at checkout
        </p>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:theme.navy, border:`1px solid ${theme.border}`, borderRadius:999, padding:'4px 8px', background:'#fff' }}>✓ CareFind Authentic</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:theme.navy, border:`1px solid ${theme.border}`, borderRadius:999, padding:'4px 8px', background:'#fff' }}>↩ 7-day return</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:theme.navy, border:`1px solid ${theme.border}`, borderRadius:999, padding:'4px 8px', background:'#fff' }}>⚡ Pickup FREE ≤3km</span>
        </div>
        <Button
          onClick={handleCheckout}
          style={{
            width: '100%',
            padding: '16px 24px',
            fontSize: 16,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8
          }}
        >
          Proceed to Checkout
          <ArrowRight size={20} />
        </Button>
        <div style={{ fontSize:11, color:theme.textLight, textAlign:'center', marginTop:8 }}>Secure by Paystack · 256-bit SSL</div>
      </Card>
    </div>
  )
}
