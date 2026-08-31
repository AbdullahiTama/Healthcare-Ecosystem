import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Package, ShoppingBag, Heart, Star, ShieldCheck, Truck, RotateCcw, Send, Trash2, MessageCircle } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, Pill, Empty } from '../../components/ui'
import { createShopRepository } from './shopRepository'
import { useCart } from './CartProvider'
import { useWishlist } from './WishlistProvider'
import { pushRecent } from './recentlyViewed'
import { reviewsRepository } from './reviewsRepository'
import { qaRepository } from './qaRepository'
import { useAuth } from '../../providers/AuthContext'

const shopRepository = createShopRepository()

export default function ProductDetail() {
  const { productId } = useParams()
  const { addItem } = useCart()
  const { has, toggle } = useWishlist()
  const { user } = useAuth()
  const [product, setProduct] = useState(null)
  const [related, setRelated] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState(0)
  const [qty, setQty] = useState(1)
  const [addedToCart, setAddedToCart] = useState(false)
  const [reviews, setReviews] = useState([])
  const [avg, setAvg] = useState({ avg: 0, count: 0 })
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [rating, setRating] = useState(5)
  const [reviewText, setReviewText] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [qa, setQa] = useState([])
  const [qaQuestion, setQaQuestion] = useState('')
  const [qaSubmitting, setQaSubmitting] = useState(false)
  const touchStartX = useRef(null)

  useEffect(() => { load() }, [productId])
  useEffect(() => { if (product) { pushRecent(product.id); loadRelated(); loadReviews(); loadQa() } }, [product?.id])

  async function loadRelated() {
    try { const rows = await shopRepository.getActiveProducts({ segment: 'all', limit: 20 }); setRelated((rows||[]).filter(r=>r.id!==productId).slice(0,4)) } catch {}
  }
  async function loadReviews() {
    const list = await reviewsRepository.list(productId)
    setReviews(list || [])
    const a = await reviewsRepository.avg(productId)
    setAvg(a)
  }
  async function loadQa() {
    const list = await qaRepository.list(productId)
    setQa(list || [])
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
  const handleSubmitReview = async () => {
    if (!rating || rating <1 || rating>5) return
    if (!reviewText.trim() || reviewText.trim().length < 3) { alert('Review must be at least 3 characters'); return }
    setReviewSubmitting(true)
    await reviewsRepository.upsert(productId, { rating, text: reviewText.trim() })
    setReviewText(''); setRating(5); setShowReviewModal(false)
    await loadReviews()
    setReviewSubmitting(false)
  }
  const handleDeleteReview = async (id) => {
    if (!confirm('Delete your review?')) return
    await reviewsRepository.remove(productId, id)
    await loadReviews()
  }
  const handleAsk = async () => {
    if (!qaQuestion.trim() || qaQuestion.trim().length < 5) return
    setQaSubmitting(true)
    await qaRepository.ask(productId, qaQuestion.trim())
    setQaQuestion('')
    await loadQa()
    setQaSubmitting(false)
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
          <button onClick={()=>setShowReviewModal(true)} style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:700, color: avg.count>0 ? theme.warning : theme.textLight, background:'#fffbeb', border:`1px solid ${theme.warning}30`, padding:'4px 8px', borderRadius:999, cursor:'pointer' }}><Star size={12} fill={avg.count>0 ? theme.starAmber : 'none'} color={theme.starAmber}/> {avg.count>0 ? `${avg.avg} · ${avg.count}` : 'No reviews'} · {avg.count} {avg.count===1?'review':'reviews'}</button>
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

      {/* Reviews — fully functional */}
      <Card style={{ padding:16, marginBottom:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <b style={{ color:theme.navy }}>Reviews · {avg.count} {avg.count===1?'review':'reviews'} {avg.count>0 && `· ${avg.avg}★`}</b>
          <button onClick={()=>setShowReviewModal(true)} style={{ padding:'6px 10px', borderRadius:8, border:`1px solid ${theme.tealDeep}`, background: theme.tealDeep, color:'#fff', fontWeight:700, fontSize:12, cursor:'pointer' }}>Write a review</button>
        </div>
        <div style={{ display:'flex', gap:6, marginBottom:8 }}>{[1,2,3,4,5].map(i=> <Star key={i} size={14} fill={avg.avg>=i ? theme.starAmber : avg.avg>=i-0.5 ? theme.starAmber : 'none'} color={theme.starAmber} />)}<span style={{ fontSize:11, color:theme.textLight, marginLeft:6 }}>{avg.count>0 ? `${avg.avg} average` : 'No ratings yet — be the first'}</span></div>
        {reviews.length===0 ? <div style={{ fontSize:12, color:theme.textLight, textAlign:'center', padding:12, border:`1px dashed ${theme.border}`, borderRadius:8 }}>No reviews yet. Your review helps others choose.</div> : (
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:8 }}>
            {reviews.map(r=>(
              <div key={r.id} style={{ border:`1px solid ${theme.border}`, borderRadius:10, padding:10, background:'#fff' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                  <span style={{ display:'inline-flex', gap:4 }}>{[1,2,3,4,5].map(i=> <Star key={i} size={12} fill={i<=r.rating ? theme.starAmber : 'none'} color={theme.starAmber} />)}</span>
                  <span style={{ fontSize:10, color:theme.textLight }}>{new Date(r.created_at).toLocaleDateString()} {r.user_id===user?.id && <button onClick={()=>handleDeleteReview(r.id)} style={{ marginLeft:8, background:'none', border:`1px solid ${theme.danger}30`, color:theme.danger, borderRadius:6, padding:'2px 6px', fontSize:10, cursor:'pointer' }}><Trash2 size={10}/> Delete</button>}</span>
                </div>
                <div style={{ fontSize:13, color:theme.textMid, whiteSpace:'pre-wrap' }}>{r.text}</div>
                <div style={{ fontSize:11, color:theme.textLight, marginTop:4 }}>{r.user_id===user?.id ? 'You' : `User ${String(r.user_id).slice(0,6)}`} · Verified buyer</div>
              </div>
            ))}
          </div>
        )}
        {showReviewModal && (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'grid', placeItems:'center', zIndex:70, padding:16 }}>
            <div style={{ background:'#fff', borderRadius:14, padding:16, width:'min(420px, 100%)', border:`1px solid ${theme.border}` }}>
              <div style={{ fontWeight:800, color:theme.navy, marginBottom:8 }}>Write a review — {p.name}</div>
              <div style={{ display:'flex', gap:6, marginBottom:10 }}>{[1,2,3,4,5].map(i=> <button key={i} onClick={()=>setRating(i)} style={{ background:'none', border:'none', cursor:'pointer' }}><Star size={24} fill={i<=rating ? theme.starAmber : 'none'} color={theme.starAmber} /></button>)}<span style={{ fontSize:12, color:theme.textLight, marginLeft:6 }}>{rating}★</span></div>
              <textarea value={reviewText} onChange={e=>setReviewText(e.target.value)} placeholder="What did you like? Was it authentic? Delivery?" rows={3} style={{ width:'100%', padding:10, border:`1px solid ${theme.border}`, borderRadius:10, fontFamily:'inherit', fontSize:13, boxSizing:'border-box' }} />
              <div style={{ display:'flex', gap:8, marginTop:10 }}>
                <button onClick={()=>setShowReviewModal(false)} style={{ flex:1, padding:10, border:`1px solid ${theme.border}`, borderRadius:10, background:'#fff', fontWeight:700, cursor:'pointer' }}>Cancel</button>
                <button onClick={handleSubmitReview} disabled={reviewSubmitting || !reviewText.trim() || reviewText.trim().length<3} style={{ flex:1, padding:10, border:'none', borderRadius:10, background: reviewText.trim().length>=3 ? theme.tealDeep : theme.gray200, color: reviewText.trim().length>=3 ? '#fff' : theme.textLight, fontWeight:800, cursor:'pointer' }}>{reviewSubmitting ? 'Saving…' : 'Submit review'}</button>
              </div>
              <div style={{ fontSize:11, color:theme.textLight, marginTop:6 }}>One review per product — submitting again replaces your previous review.</div>
            </div>
          </div>
        )}
        <div style={{ marginTop:12, borderTop:`1px solid ${theme.border}`, paddingTop:12 }}>
          <div style={{ fontSize:12, fontWeight:700, color:theme.navy, display:'flex', alignItems:'center', gap:6 }}><MessageCircle size={14}/> Q&A</div>
          <div style={{ display:'flex', gap:6, marginTop:8 }}>
            <input value={qaQuestion} onChange={e=>setQaQuestion(e.target.value)} placeholder="Ask a question about this product..." style={{ flex:1, padding:'8px 10px', border:`1px solid ${theme.border}`, borderRadius:8, fontSize:12 }} />
            <button onClick={handleAsk} disabled={qaSubmitting || !qaQuestion.trim() || qaQuestion.trim().length<5} style={{ padding:'8px 12px', borderRadius:8, border:'none', background: qaQuestion.trim().length>=5 ? theme.tealDeep : theme.gray200, color: qaQuestion.trim().length>=5 ? '#fff' : theme.textLight, fontWeight:700, cursor:'pointer' }}><Send size={14}/></button>
          </div>
          {qa.length>0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:10 }}>
              {qa.map(q=>(
                <div key={q.id} style={{ border:`1px solid ${theme.border}`, borderRadius:10, padding:10, background: theme.cardBg }}>
                  <div style={{ fontSize:13, color:theme.navy }}><b>Q:</b> {q.question} <span style={{ fontSize:10, color:theme.textLight }}>· {new Date(q.created_at).toLocaleDateString()}</span></div>
                  {q.answer ? <div style={{ fontSize:13, color:theme.tealDeep, marginTop:4 }}><b>A:</b> {q.answer} {q.answered_at && <span style={{ fontSize:10, color:theme.textLight }}>· {new Date(q.answered_at).toLocaleDateString()}</span>}</div> : <div style={{ fontSize:11, color:theme.textLight, marginTop:4 }}>Awaiting vendor answer — you’ll be notified.</div>}
                </div>
              ))}
            </div>
          )}
        </div>
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
