import { Link } from 'react-router-dom'
import { X, ShoppingBag, ArrowRight, Minus, Plus } from 'lucide-react'
import { theme } from '../../styles/theme'
import { useCart } from './CartProvider'
import { useDialog } from '../../hooks/useDialog'

// Quantity stepper control. 30px keeps it compact in the cart panel while
// staying above the 24px minimum target size from WCAG 2.2.
const stepperBtn = {
  width: 30,
  height: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: '#fff',
  color: theme.navy,
  cursor: 'pointer',
  padding: 0,
}
export default function MiniCart({ open, onClose }) {
  const { items, total, removeItem, updateQuantity } = useCart()
  const panelRef = useDialog({ open, onClose })
  if (!open) return null
  return (
    <div style={{ position:'fixed', inset:0, zIndex:80 }}>
      <div onClick={onClose} aria-hidden="true" style={{ position:'absolute', inset:0, background: theme.overlay }} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Shopping cart" tabIndex={-1} style={{ position:'absolute', right:0, top:0, bottom:0, width:'min(360px, 90vw)', background: theme.cardBg, borderLeft:`1px solid ${theme.border}`, display:'flex', flexDirection:'column', boxShadow: theme.elevation[3] }}>
        <div style={{ padding:16, borderBottom:`1px solid ${theme.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <b style={{ color: theme.navy }}>Cart · {items.length} {items.length === 1 ? 'item' : 'items'}</b><button onClick={onClose} aria-label="Close" style={{ background:'none', border:`1px solid ${theme.border}`, borderRadius:8, padding:'4px 8px' }}><X size={16}/></button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:12, display:'flex', flexDirection:'column', gap:12 }}>
          {items.length===0 ? (
            <div style={{ textAlign:'center', padding:'40px 16px', color:theme.textMid }}>
              <ShoppingBag size={40} style={{ margin:'0 auto 12px', display:'block', color:theme.textLight }}/>
              <div style={{ fontWeight:700, fontSize:14, color:theme.navy, marginBottom:4 }}>Your cart is empty</div>
              <div style={{ fontSize:12, marginBottom:16 }}>Browse our shop and add products</div>
              <Link to="/search?tab=shop" onClick={onClose} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'10px 20px', background:theme.tealDeep, color:'#fff', borderRadius:10, fontWeight:700, fontSize:13, textDecoration:'none' }}>
                Browse Shop <ArrowRight size={14}/>
              </Link>
            </div>
          ) : items.map(i=>(
            <div key={i.ecommerce_product_id} style={{ display:'flex', gap:10, border:`1px solid ${theme.border}`, borderRadius:12, padding:10, background:'#fff' }}>
              <div style={{ width:56, height:56, borderRadius:8, background: i.image_url ? `url(${i.image_url}) center/cover` : theme.tealMist, flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:13, color:theme.navy, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.product_name}</div>
                <div style={{ fontSize:12, color:theme.textLight }}>₦{(i.unit_price_kobo/100).toLocaleString()} × {i.quantity}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${theme.border}`, borderRadius: theme.radius.sm, overflow: 'hidden' }}>
                    <button
                      type="button"
                      onClick={() => updateQuantity(i.ecommerce_product_id, Math.max(0, i.quantity - 1))}
                      disabled={i.quantity <= 1}
                      aria-label={`Decrease quantity of ${i.product_name}`}
                      style={stepperBtn}
                    >
                      <Minus size={14} aria-hidden="true" />
                    </button>
                    <span style={{ minWidth: 28, textAlign: 'center', fontSize: 12, fontWeight: 700, borderLeft: `1px solid ${theme.border}`, borderRight: `1px solid ${theme.border}`, padding: '5px 0' }}>{i.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(i.ecommerce_product_id, i.quantity + 1)}
                      aria-label={`Increase quantity of ${i.product_name}`}
                      style={stepperBtn}
                    >
                      <Plus size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(i.ecommerce_product_id)}
                    aria-label={`Remove ${i.product_name} from cart`}
                    style={{ fontSize: 11, color: theme.danger, background: 'none', border: `1px solid ${theme.danger}30`, borderRadius: theme.radius.sm, padding: '5px 8px', cursor: 'pointer' }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <div style={{ fontWeight:800, color:theme.tealDeep, fontSize:12 }}>₦{(i.unit_price_kobo*i.quantity/100).toLocaleString()}</div>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <div style={{ padding:16, borderTop:`1px solid ${theme.border}`, background:'#fff' }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontWeight:800, color:theme.navy, marginBottom:12 }}>Subtotal <span style={{ color:theme.tealDeep }}>₦{(total/100).toLocaleString()}</span></div>
            <Link to="/cart" onClick={onClose} style={{ display:'block', textAlign:'center', padding:12, background:theme.tealDeep, color:'#fff', borderRadius:10, fontWeight:800, textDecoration:'none' }}>View Cart & Checkout</Link>
            <Link to="/search?tab=shop" onClick={onClose} style={{ display:'block', textAlign:'center', padding:10, color:theme.textMid, fontSize:12, marginTop:8, textDecoration:'none' }}>Continue shopping</Link>
          </div>
        )}
      </div>
    </div>
  )
}
