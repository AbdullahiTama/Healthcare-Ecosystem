import { Link } from 'react-router-dom'
import { X, ShoppingBag } from 'lucide-react'
import { theme } from '../../styles/theme'
import { useCart } from './CartProvider'
export default function MiniCart({ open, onClose }) {
  const { items, total, removeItem, updateQuantity } = useCart()
  if (!open) return null
  return (
    <div style={{ position:'fixed', inset:0, zIndex:80 }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background: theme.overlay }} />
      <div style={{ position:'absolute', right:0, top:0, bottom:0, width:'min(360px, 90vw)', background: theme.cardBg, borderLeft:`1px solid ${theme.border}`, display:'flex', flexDirection:'column', boxShadow: theme.elevation[3] }}>
        <div style={{ padding:16, borderBottom:`1px solid ${theme.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <b style={{ color: theme.navy }}>Cart · {items.length} items</b><button onClick={onClose} aria-label="Close" style={{ background:'none', border:`1px solid ${theme.border}`, borderRadius:8, padding:'4px 8px' }}><X size={16}/></button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:12, display:'flex', flexDirection:'column', gap:12 }}>
          {items.length===0 ? <div style={{ textAlign:'center', padding:32, color:theme.textLight }}><ShoppingBag size={32} style={{ margin:'0 auto 8px', display:'block' }}/>Your cart is empty</div> : items.map(i=>(
            <div key={i.ecommerce_product_id} style={{ display:'flex', gap:10, border:`1px solid ${theme.border}`, borderRadius:12, padding:10, background:'#fff' }}>
              <div style={{ width:56, height:56, borderRadius:8, background: i.image_url ? `url(${i.image_url}) center/cover` : theme.tealMist, flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:13, color:theme.navy, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.product_name}</div>
                <div style={{ fontSize:12, color:theme.textLight }}>₦{(i.unit_price_kobo/100).toLocaleString()} × {i.quantity}</div>
                <div style={{ display:'flex', gap:6, marginTop:6 }}><button onClick={()=>updateQuantity(i.ecommerce_product_id, Math.max(0,i.quantity-1))} style={{ width:24, height:24, border:`1px solid ${theme.border}`, borderRadius:6, background:'#fff' }}>−</button><span style={{ fontSize:12, fontWeight:700, minWidth:16, textAlign:'center' }}>{i.quantity}</span><button onClick={()=>updateQuantity(i.ecommerce_product_id, i.quantity+1)} style={{ width:24, height:24, border:`1px solid ${theme.border}`, borderRadius:6, background:'#fff' }}>+</button><button onClick={()=>removeItem(i.ecommerce_product_id)} style={{ marginLeft:8, fontSize:11, color:theme.danger, background:'none', border:`1px solid ${theme.danger}20`, borderRadius:6, padding:'2px 8px' }}>Remove</button></div>
              </div>
              <div style={{ fontWeight:800, color:theme.tealDeep, fontSize:12 }}>₦{(i.unit_price_kobo*i.quantity/100).toLocaleString()}</div>
            </div>
          ))}
        </div>
        <div style={{ padding:16, borderTop:`1px solid ${theme.border}`, background:'#fff' }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontWeight:800, color:theme.navy, marginBottom:12 }}>Subtotal <span style={{ color:theme.tealDeep }}>₦{(total/100).toLocaleString()}</span></div>
          <Link to="/cart" onClick={onClose} style={{ display:'block', textAlign:'center', padding:12, background:theme.tealDeep, color:'#fff', borderRadius:10, fontWeight:800, textDecoration:'none' }}>View Cart & Checkout</Link>
          <Link to="/search?tab=shop" onClick={onClose} style={{ display:'block', textAlign:'center', padding:10, color:theme.textMid, fontSize:12, marginTop:8, textDecoration:'none' }}>Continue shopping</Link>
        </div>
      </div>
    </div>
  )
}
