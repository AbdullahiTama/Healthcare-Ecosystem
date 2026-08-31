import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Package, ShoppingBag, Heart, Star, ShieldCheck, Truck, RotateCcw } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, Pill, Empty } from '../../components/ui'
import { createShopRepository } from './shopRepository'
import { useCart } from './CartProvider'
import { useWishlist } from './WishlistProvider'
import { pushRecent } from './recentlyViewed'

const shopRepository = createShopRepository()

export default function ProductDetail() {
  const { productId } = useParams()
  const { addItem } = useCart()
  const { has, toggle } = useWishlist()
  const [product, setProduct] = useState(null)
  const [related, setRelated] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState(0)
  const [qty, setQty] = useState(1)
  const [addedToCart, setAddedToCart] = useState(false)
  const touchStartX = useRef(null)

  useEffect(() => { load() }, [productId])
  useEffect(() => { if (product) { pushRecent(product.id); loadRelated() } }, [product?.id])
  async function loadRelated() {
    try { const rows = await shopRepository.getActiveProducts({ segment: 'all', limit: 20 }); setRelated((rows||[]).filter(r=>r.id!==productId).slice(0,4)) } catch {}
  }

  async function load() {
    setLoading(true); setError('')
    try {
      const data = await shopRepository.getProductDetail(productId)
      if (!data) { setError('Product not available'); setProduct(null) } else { setProduct(data); setCurrent(0); setQty(1) }
    } catch (e) { setError('Could not load product') }
    setLoading(false)
  }

  if (loading) return <div style={{ padding: 20, textAlign: 'center', color: theme.textLight }}>Loading product...</div>
  if (error || !product) return <Empty icon={<Package size={40} color={theme.gray300} />} message={error || 'Product not available'} action="Back to Shop" onAction={() => window.location.href = '/search?tab=shop'} />

  const p = product.products
  const images = product.images || []
  const priceKobo = product.ecommerce_price_kobo ?? (p.price != null ? Math.round(p.price * 100) : null)
  const priceLabel = priceKobo != null ? `₦${(priceKobo/100).toLocaleString()}` : 'Ask for price'
  const wished = has(product.id)

  const next = () => setCurrent(c => (c + 1) % images.length)
  const prev = () => setCurrent(c => (c - 1 + images.length) % images.length)
  const goTo = (idx) => setCurrent(idx)
  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX }
  const onTouchEnd = (e) => {
    if (touchStartX.current == null) return
    const diff = e.changedTouches[0].clientX - touchStartX.current
    if (diff > 50) prev()
    else if (diff < -50) next()
    touchStartX.current = null
  }
  const handleAddToCart = () => {
    if (!product || !p) return
    addItem({ ecommerce_product_id: product.id, product_name: p.name, unit_price_kobo: priceKobo, quantity: qty, image_url: images[0]?.url || p.image_url || null, vendor_id: product.business_id, vendor_business_id: product.business_id, sale_type: p.sale_type || null, prescription_required: !!product.prescription_required })
    setAddedToCart(true); setTimeout(() => setAddedToCart(false), 2000)
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <Link to="/search?tab=shop" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: theme.tealDeep, textDecoration: 'none', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
        <ArrowLeft size={14} /> Back to Shop
      </Link>

      {/* Gallery */}
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }} aria-label="Product gallery">
        {images.length === 0 ? (
          <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.tealMist, color: theme.tealDeep }}>
            <Package size={40} />
          </div>
        ) : (
          <div style={{ position: 'relative' }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} role="region" aria-label={`Product gallery, image ${current + 1} of ${images.length}`} aria-live="polite">
            <img src={images[current].url} alt={`${p.name} — image ${current + 1} of ${images.length}`} style={{ width: '100%', height: 320, objectFit: 'cover', display: 'block' }} />
            {images.length > 1 && (
              <>
                <button onClick={prev} aria-label="Previous image" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: '50%', border: `1px solid ${theme.border}`, background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <ChevronLeft size={18} />
                </button>
                <button onClick={next} aria-label="Next image" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: '50%', border: `1px solid ${theme.border}`, background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <ChevronRight size={18} />
                </button>
                <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6, background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: 12 }}>
                  {images.map((_, idx) => (
                    <button key={idx} onClick={() => goTo(idx)} aria-label={`Go to image ${idx + 1}`} aria-current={idx === current} style={{ width: 8, height: 8, borderRadius: '50%', border: 'none', background: idx === current ? '#fff' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 0 }} />
                  ))}
                </div>
                <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, padding: '2px 6px', borderRadius: 6 }}>
                  {current + 1}/{images.length}
                </div>
              </>
            )}
            <button onClick={()=>toggle(product.id)} aria-label={wished ? 'Remove wishlist' : 'Add wishlist'} style={{ position:'absolute', top:8, left:8, width:36, height:36, borderRadius:'50%', border:`1px solid ${theme.border}`, background: wished ? theme.tealDeep : 'rgba(255,255,255,0.95)', color: wished ? '#fff' : theme.navy, display:'grid', placeItems:'center', cursor:'pointer' }}><Heart size={16} fill={wished ? '#fff' : 'none'} /></button>
          </div>
        )}
      </Card>

      {/* Details */}
      <Card style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'flex-start' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: theme.navy, flex:1 }}>{p.name}</div>
          <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:700, color:theme.warning, background:'#fffbeb', border:`1px solid ${theme.warning}30`, padding:'4px 8px', borderRadius:999 }}><Star size={12}/> 4.8 · 24 reviews</span>
        </div>
        {p.generic_name && <div style={{ fontSize: 13, color: theme.textLight, fontStyle: 'italic', marginBottom: 8 }}>{p.generic_name}</div>}
        <div style={{ fontSize: 18, fontWeight: 800, color: theme.tealDeep, marginBottom: 8 }}>{priceLabel} {p.price_unit && <span style={{ fontSize:11, color:theme.textLight, fontWeight:500 }}>per {p.price_unit}</span>}</div>
        {p.sale_type && <Pill label={p.sale_type} type="gray" style={{ marginBottom: 8 }} />}
        <div style={{ fontSize: 13, color: theme.textMid, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 12 }}>{product.description || p.description || 'No description available.'}</div>
        {product.category && <div style={{ fontSize: 12, color: theme.textLight, marginBottom: 4 }}><b>Category:</b> {product.category}</div>}
        {product.prescription_required && <div style={{ fontSize: 12, color: theme.warning, fontWeight: 700, marginBottom: 6 }}>⚠️ Prescription required</div>}
        {product.warnings && <div style={{ fontSize: 12, color: theme.textMid, marginBottom: 6, borderLeft: `3px solid ${theme.warning}`, paddingLeft: 8 }}><b>Warnings:</b> {product.warnings}</div>}
        {product.restrictions && <div style={{ fontSize: 12, color: theme.danger, marginBottom: 6 }}><b>Restrictions:</b> {product.restrictions}</div>}
        {p.stock != null && <div style={{ fontSize: 12, color: p.stock>5 ? theme.success : theme.warning, fontWeight:600, marginBottom: 12 }}>{p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'} {p.stock>0 && p.stock<=5 && '· Low stock'}</div>}

        {/* Quantity + trust */}
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom: 12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, border:`1px solid ${theme.border}`, borderRadius:10, padding:'4px 6px', background:'#fff' }}>
            <button onClick={()=>setQty(q=>Math.max(1,q-1))} style={{ width:28, height:28, border:`1px solid ${theme.border}`, borderRadius:8, background:'#fff', cursor:'pointer' }}>−</button>
            <span style={{ minWidth:24, textAlign:'center', fontWeight:800 }}>{qty}</span>
            <button onClick={()=>setQty(q=> Math.min(p.stock||99, q+1))} disabled={p.stock!=null && qty>=p.stock} style={{ width:28, height:28, border:`1px solid ${theme.border}`, borderRadius:8, background: qty>= (p.stock||99) ? theme.bg : '#fff', cursor:'pointer' }}>+</button>
          </div>
          <span style={{ fontSize:11, color:theme.textLight }}>{p.sale_type==='wholesale' ? 'Boxes' : p.sale_type==='distributor' ? 'Cartons' : 'Pieces'} · {qty} × ₦{(priceKobo/100).toLocaleString()}</span>
        </div>

        <button onClick={handleAddToCart} disabled={!p.stock || p.stock <= 0} style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: addedToCart ? theme.success : (p.stock > 0 ? theme.tealDeep : theme.gray200), color: addedToCart ? '#fff' : (p.stock > 0 ? '#fff' : theme.textLight), fontWeight: 700, cursor: p.stock > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'background 0.2s' }}>
          <ShoppingBag size={16} />{addedToCart ? 'Added to Cart!' : (p.stock > 0 ? `Add ${qty} to Cart` : 'Out of Stock')}
        </button>
        <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:theme.navy, border:`1px solid ${theme.border}`, borderRadius:999, padding:'4px 8px', background:'#fff' }}><ShieldCheck size={12}/> CareFind Authentic</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:theme.navy, border:`1px solid ${theme.border}`, borderRadius:999, padding:'4px 8px', background:'#fff' }}><RotateCcw size={12}/> 7-day return</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600, color:theme.navy, border:`1px solid ${theme.border}`, borderRadius:999, padding:'4px 8px', background:'#fff' }}><Truck size={12}/> Pickup FREE ≤3km</span>
        </div>
      </Card>

      {/* Reviews stub + cross-sell */}
      <Card style={{ padding:16, marginBottom:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <b style={{ color:theme.navy }}>Reviews</b><span style={{ fontSize:12, color:theme.textLight }}>4.8 · 24 · 98% positive</span>
        </div>
        <div style={{ display:'flex', gap:6, marginBottom:8 }}>{[1,2,3,4,5].map(i=> <Star key={i} size={14} fill={i<=5 ? theme.starAmber : 'none'} color={theme.starAmber} />)}<span style={{ fontSize:11, color:theme.textLight, marginLeft:6 }}>Based on pharmacy sales</span></div>
        <div style={{ borderTop:`1px solid ${theme.border}`, paddingTop:10, display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:12, color:theme.textMid }}><b style={{ color:theme.navy }}>Aisha</b> · Verified buyer · 2d ago<br/>“Authentic, delivered to Yaba Hub next day.”</div>
          <div style={{ fontSize:12, color:theme.textMid }}><b style={{ color:theme.navy }}>Emeka</b> · 5d ago<br/>“Price matched inventory, no hidden fee.”</div>
        </div>
        <button style={{ marginTop:10, width:'100%', padding:10, border:`1px solid ${theme.border}`, borderRadius:10, background:'#fff', fontWeight:700, fontSize:12, color:theme.navy }}>Write a review</button>
        <div style={{ marginTop:12, fontSize:12, fontWeight:700, color:theme.navy }}>Q&A</div>
        <div style={{ fontSize:12, color:theme.textMid }}>Q: Is this suitable for children? <br/><span style={{ color:theme.tealDeep, fontWeight:600 }}>A: Check warnings — consult pharmacist if under 12.</span></div>
      </Card>

      {related.length>0 && (
        <div style={{ marginBottom:12 }}>
          <div style={{ fontWeight:800, color:theme.navy, marginBottom:8 }}>Bought together</div>
          <div style={{ display:'flex', gap:12, overflowX:'auto', paddingBottom:8 }}>
            {related.map(r=>(
              <Link key={r.id} to={`/shop/${r.id}`} style={{ textDecoration:'none', flex:'0 0 140px' }}>
                <Card style={{ padding:8, textAlign:'center' }}>
                  <div style={{ height:80, borderRadius:8, background: (r.primary_image_url||r.products.image_url) ? `url(${r.primary_image_url||r.products.image_url}) center/cover` : theme.tealMist }} />
                  <div style={{ fontSize:12, fontWeight:700, color:theme.navy, marginTop:6, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.products.name}</div>
                  <div style={{ fontSize:12, fontWeight:800, color:theme.tealDeep }}>₦{((r.ecommerce_price_kobo ?? Math.round(r.products.price*100))/100).toLocaleString()}</div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
