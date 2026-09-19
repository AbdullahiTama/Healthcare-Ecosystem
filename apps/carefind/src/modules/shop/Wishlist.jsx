import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heart, ShoppingBag } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, Empty } from '../../components/ui'
import { useWishlist } from './WishlistProvider'
import { createShopRepository } from './shopRepository'
import { useCart } from './CartProvider'

const shopRepository = createShopRepository()

export default function Wishlist() {
  const { ids, toggle } = useWishlist()
  const { addItem } = useCart()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (ids.length===0) { setProducts([]); setLoading(false); return }
      setLoading(true)
      const all = await shopRepository.getActiveProducts({ limit: 80 })
      const map = new Map(all.map(r=>[r.id,r]))
      setProducts(ids.map(id=>map.get(id)).filter(Boolean))
      setLoading(false)
    }
    load()
  }, [ids])

  if (loading) return <div style={{ padding:20, textAlign:'center', color:theme.textLight }}>Loading wishlist...</div>
  if (ids.length===0) return <div style={{ maxWidth:800, margin:'0 auto', padding:'24px 16px' }}><Empty icon={<Heart size={40} />} title="Wishlist empty" description="Tap the heart on any product to save it" action="Browse Shop" onAction={()=> window.location.href='/search?tab=shop'} /></div>
  if (products.length===0) return <div style={{ maxWidth:800, margin:'0 auto', padding:16, color:theme.textLight, fontSize:13 }}>Saved items are no longer available.</div>

  return (
    <div style={{ maxWidth:800, margin:'0 auto', padding:16 }}>
      <h1 style={{ fontSize:21, fontWeight:900, color:theme.navy, marginBottom:12, display:'flex', alignItems:'center', gap:8 }}><Heart size={20}/> Wishlist · {products.length}</h1>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px,1fr))', gap:12 }}>
        {products.map(row=>{
          const p=row.products; const k=row.ecommerce_price_kobo ?? (p.price!=null ? Math.round(p.price*100) : null); const thumb=row.primary_image_url||p.image_url
          return (
            <Card key={row.id} style={{ padding:10, display:'flex', flexDirection:'column', gap:6 }}>
              <Link to={`/shop/${row.id}`} style={{ textDecoration:'none' }}>
                <div style={{ height:120, borderRadius:8, background: thumb ? `url(${thumb}) center/cover` : theme.tealMist }} />
                <div style={{ fontWeight:700, color:theme.navy, fontSize:13, marginTop:6 }}>{p.name}</div>
                <div style={{ fontWeight:800, color:theme.tealDeep, fontSize:13 }}>{k!=null ? `₦${(k/100).toLocaleString()}` : 'Ask for price'}</div>
              </Link>
              <div style={{ display:'flex', gap:6, marginTop:6 }}>
                <button onClick={()=>{ if(k!=null) addItem({ ecommerce_product_id: row.id, product_name:p.name, unit_price_kobo:k, quantity:1, image_url:thumb, vendor_id:row.business_id, sale_type:p.sale_type })}} style={{ flex:1, padding:'8px', borderRadius:8, border:'none', background:theme.tealDeep, color:'#fff', fontWeight:700, fontSize:12, display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6 }}><ShoppingBag size={14}/> Add</button>
                <button onClick={()=>toggle(row.id)} style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${theme.border}`, background:'#fff', color:theme.danger, fontWeight:700, fontSize:12 }}>Remove</button>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
