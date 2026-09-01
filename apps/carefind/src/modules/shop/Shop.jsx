import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Package, Heart, ShoppingCart, SlidersHorizontal } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card } from '../../components/ui'
import { createShopRepository } from './shopRepository'
import { useCart } from './CartProvider'
import { useWishlist } from './WishlistProvider'
import MiniCart from './MiniCart'
import { getRecent } from './recentlyViewed'
import { reviewsRepository } from './reviewsRepository'
import ProductGrid from '../marketplace/ProductGrid'

const shopRepository = createShopRepository()

export default function Shop({ segment: initialSegment = 'all', query: externalQuery = '', embedded = false }) {
  const { count, addItem } = useCart()
  const { has: hasWishlist, toggle: toggleWishlist } = useWishlist()
  const [segment, setSegment] = useState(initialSegment)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [miniOpen, setMiniOpen] = useState(false)
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [brand, setBrand] = useState('all')
  const [showRxOnly, setShowRxOnly] = useState(false)
  const [inStockOnly, setInStockOnly] = useState(true)
  const [sort, setSort] = useState('popular')
  const [recentIds, setRecentIds] = useState([])
  const [ratings, setRatings] = useState({})

  useEffect(() => { setSegment(initialSegment) }, [initialSegment])
  useEffect(() => { load(); setRecentIds(getRecent()) }, [segment, externalQuery])
  useEffect(() => {
    if (products.length===0) return
    let cancelled=false
    Promise.all(products.slice(0,30).map(async r=>{
      const a = await reviewsRepository.avg(r.id).catch(()=>({avg:0,count:0}))
      return [r.id, a]
    })).then(pairs=>{
      if (cancelled) return
      const m={}; pairs.forEach(([id,a])=>{ if(a.count>0) m[id]=a })
      setRatings(m)
    })
    return ()=> { cancelled=true }
  }, [products])

  async function load() {
    setLoading(true); setError('')
    try {
      const rows = await shopRepository.getActiveProducts({ segment, query: externalQuery, limit: 80 })
      setProducts(rows || [])
    } catch (e) {
      setError('Could not load Shop products')
    }
    setLoading(false)
  }

  const brands = useMemo(() => {
    const s = new Set((products||[]).map(r => r.category || r.products?.category).filter(Boolean))
    return ['all', ...Array.from(s)]
  }, [products])

  const filtered = useMemo(() => {
    let rows = [...products]
    if (brand !== 'all') rows = rows.filter(r => (r.category || r.products?.category) === brand)
    if (priceMin !== '') rows = rows.filter(r => {
      const k = r.ecommerce_price_kobo ?? (r.products.price!=null ? Math.round(r.products.price*100) : null)
      return k != null && k >= Math.round(parseFloat(priceMin)*100)
    })
    if (priceMax !== '') rows = rows.filter(r => {
      const k = r.ecommerce_price_kobo ?? (r.products.price!=null ? Math.round(r.products.price*100) : null)
      return k != null && k <= Math.round(parseFloat(priceMax)*100)
    })
    if (showRxOnly) rows = rows.filter(r => r.prescription_required)
    if (inStockOnly) rows = rows.filter(r => (r.products?.stock ?? 0) > 0)
    if (sort === 'price_asc') rows.sort((a,b) => (a.ecommerce_price_kobo ?? a.products.price*100 ?? 0) - (b.ecommerce_price_kobo ?? b.products.price*100 ?? 0))
    else if (sort === 'price_desc') rows.sort((a,b) => (b.ecommerce_price_kobo ?? b.products.price*100 ?? 0) - (a.ecommerce_price_kobo ?? a.products.price*100 ?? 0))
    else if (sort === 'newest') rows.sort((a,b) => new Date(b.active_at) - new Date(a.active_at))
    else if (sort === 'rating') rows.sort((a,b) => (ratings[b.id]?.avg||0) - (ratings[a.id]?.avg||0))
    return rows
  }, [products, brand, priceMin, priceMax, showRxOnly, inStockOnly, sort, ratings])

  const featured = filtered.slice(0, 6)
  const grid = filtered
  const recent = useMemo(() => {
    if (!recentIds.length) return []
    const map = new Map(filtered.map(r => [r.id, r]))
    const allMap = new Map(products.map(r=>[r.id,r]))
    return recentIds.map(id => map.get(id) || allMap.get(id)).filter(Boolean).slice(0, 6)
  }, [recentIds, filtered, products])

  // Embedded mode: parent (Search marketplace) already renders the segment filter (All|Retail|Wholesale|Distributor)
  // and Near Me. Hide duplicate chrome to avoid over-boxing per spec §13.
  const showSegmentFilter = !embedded

  // Common outer padding: embedded has no outer 16px because parent already pads
  const outerStyle = embedded ? {} : { padding: 16 }

  if (loading) {
    // Use ProductGrid skeleton for consistency
    return (
      <div style={outerStyle}>
        {!embedded && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
            <div style={{ width: 90, height: 36, borderRadius: 8, background: theme.gray100 }} />
            <div style={{ width: 90, height: 36, borderRadius: 8, background: theme.gray100 }} />
          </div>
        )}
        <ProductGrid rows={[]} loading={true} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={outerStyle}>
        <div role="alert" style={{ padding: 16, borderRadius: 12, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, textAlign: 'center', fontSize: 13 }}>
          {error} <button onClick={load} style={{ marginLeft: 8, background: '#fff', border: `1px solid ${theme.danger}`, color: theme.danger, borderRadius: 8, padding: '6px 12px', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div style={outerStyle}>
      {/* Top bar: wishlist + cart — hide when embedded? keep cart accessible but compact */}
      {!embedded ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
          <Link to="/wishlist" style={{ display:'flex', alignItems:'center', gap: 6, padding:'8px 12px', borderRadius:8, border:`1px solid ${theme.border}`, background:'#fff', color:theme.navy, textDecoration:'none', fontWeight:700, fontSize:12 }}>
            <Heart size={16} /> Wishlist
          </Link>
          <button onClick={()=>setMiniOpen(true)} style={{ position:'relative', display:'flex', alignItems:'center', gap:8, padding:'8px 16px', borderRadius:8, background: theme.tealDeep, color:'#fff', border:'none', fontWeight:700, cursor:'pointer' }}>
            <ShoppingCart size={18} /> Cart
            {count > 0 && <span style={{ position:'absolute', top:-8, right:-8, background: theme.danger, color:'#fff', borderRadius:'50%', width:22, height:22, display:'grid', placeItems:'center', fontSize:11, fontWeight:800 }}>{count}</span>}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
          <Link to="/wishlist" style={{ display:'inline-flex', alignItems:'center', gap: 5, padding:'6px 10px', borderRadius:999, border:`1px solid ${theme.border}`, background:'#fff', color:theme.navy, textDecoration:'none', fontWeight:700, fontSize:11 }}>
            <Heart size={14} /> Wishlist
          </Link>
          <button onClick={()=>setMiniOpen(true)} aria-label={`Cart, ${count} items`} style={{ position:'relative', display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px', borderRadius:999, background: theme.tealDeep, color:'#fff', border:'none', fontWeight:800, fontSize:11, cursor:'pointer' }}>
            <ShoppingCart size={14} /> Cart{count>0 ? ` · ${count}` : ''}
          </button>
        </div>
      )}

      {/* Segment filter — hidden when embedded (parent controls it) */}
      {showSegmentFilter && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }} role="group" aria-label="Segment filter">
          {[
            { value: 'all', label: 'All' },
            { value: 'retail', label: 'Retail' },
            { value: 'wholesale', label: 'Wholesale' },
            { value: 'distributor', label: 'Distributor' },
          ].map(s => (
            <button key={s.value} onClick={() => setSegment(s.value)} aria-pressed={segment === s.value}
              style={{ flex:'0 0 auto', padding:'6px 14px', borderRadius:999, border:`1px solid ${segment === s.value ? theme.tealDeep : theme.border}`, background: segment === s.value ? theme.tealDeep : '#fff', color: segment === s.value ? '#fff' : theme.textMid, fontSize: 12, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Faceted filters — lighter, not a heavy boxed card when embedded */}
      <div
        style={
          embedded
            ? { display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom: 10, padding: '2px 0' }
            : { display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom: 12, padding:10, border:`1px solid ${theme.border}`, borderRadius:12, background: theme.cardBg }
        }
      >
        {/* Hide Filters label when embedded to reduce chrome — keep compact */}
        {!embedded && <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, fontWeight:700, color:theme.navy }}><SlidersHorizontal size={14}/> Filters</span>}
        <select value={brand} onChange={e=>setBrand(e.target.value)} aria-label="Filter by brand" style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${theme.border}`, background:'#fff', fontSize:12, minHeight:44 }}>
          {brands.map(b => <option key={b} value={b}>{b==='all' ? 'All brands' : b}</option>)}
        </select>
        <input placeholder="Min ₦" value={priceMin} onChange={e=>setPriceMin(e.target.value)} inputMode="numeric" aria-label="Minimum price" style={{ width:90, padding:'8px 8px', borderRadius:8, border:`1px solid ${theme.border}`, fontSize:12, minHeight:44, boxSizing:'border-box' }} />
        <input placeholder="Max ₦" value={priceMax} onChange={e=>setPriceMax(e.target.value)} inputMode="numeric" aria-label="Maximum price" style={{ width:90, padding:'8px 8px', borderRadius:8, border:`1px solid ${theme.border}`, fontSize:12, minHeight:44, boxSizing:'border-box' }} />
        <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:theme.navy, minHeight:44 }}><input type="checkbox" checked={showRxOnly} onChange={e=>setShowRxOnly(e.target.checked)} /> Rx only</label>
        <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:theme.navy, minHeight:44 }}><input type="checkbox" checked={inStockOnly} onChange={e=>setInStockOnly(e.target.checked)} /> In stock</label>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, fontSize:12, minHeight:44 }}>
          Sort <select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sort products" style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${theme.border}`, background:'#fff', minHeight:44 }}>
            <option value="popular">Popular</option><option value="newest">Newest</option><option value="price_asc">Price ↑</option><option value="price_desc">Price ↓</option><option value="rating">Rating</option>
          </select>
        </div>
      </div>
      <div style={{ fontSize:11, color: theme.textLight, marginBottom: 12 }}>{filtered.length} products {inStockOnly ? '· in stock' : ''} · {showRxOnly ? 'Rx only · ' : ''}sorted {sort}</div>

      {/* Featured horizontal row */}
      {featured.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: theme.navy, marginBottom: 8 }}>Featured</div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'thin' }} role="list" aria-label="Featured products">
            {featured.map(row => {
              const p = row.products
              const priceKobo = row.ecommerce_price_kobo ?? (p.price != null ? Math.round(p.price * 100) : null)
              const priceLabel = priceKobo != null ? `₦${(priceKobo/100).toLocaleString()}` : 'Ask for price'
              const thumb = row.primary_image_url || p.image_url || null
              const wished = hasWishlist(row.id)
              return (
                <div key={row.id} style={{ position:'relative', flex:'0 0 160px' }} role="listitem">
                  <Link to={`/shop/${row.id}`} style={{ textDecoration: 'none' }}>
                    <Card style={{ padding: 10, height: 180, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ height: 80, borderRadius: 8, background: thumb ? `url(${thumb}) center/cover` : theme.tealMist, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.tealDeep }}>
                        {!thumb && <Package size={24} />}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: theme.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: theme.tealDeep }}>{priceLabel}</div>
                      {p.sale_type && <span style={{ fontSize: 10, fontWeight: 700, color: theme.textLight, border: `1px solid ${theme.border}`, background: '#fff', padding: '2px 6px', borderRadius: 6, alignSelf: 'flex-start' }}>{p.sale_type}</span>}
                    </Card>
                  </Link>
                  <button onClick={(e)=>{ e.preventDefault(); toggleWishlist(row.id)}} aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'} style={{ position:'absolute', top:6, right:6, width:28, height:28, borderRadius:'50%', border:`1px solid ${theme.border}`, background: wished ? theme.tealDeep : '#fff', color: wished ? '#fff' : theme.navy, display:'grid', placeItems:'center', cursor:'pointer' }}><Heart size={14} fill={wished ? '#fff' : 'none'} /></button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Grid catalog — now via shared ProductGrid for consistent 2-col mobile */}
      <ProductGrid
        rows={grid}
        loading={false}
        error=""
        onAddToCart={(item) => addItem(item)}
        onToggleWishlist={toggleWishlist}
        hasWishlist={hasWishlist}
        ratings={ratings}
        emptyTitle="No products match"
        emptyHint="Try adjusting filters or search."
      />

      {/* Recently viewed */}
      {recent.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize:13, fontWeight:800, color:theme.navy, marginBottom:8 }}>Recently viewed</div>
          <div style={{ display:'flex', gap:12, overflowX:'auto', paddingBottom:8 }}>
            {recent.map(r=>(
              <Link key={r.id} to={`/shop/${r.id}`} style={{ textDecoration:'none', flex:'0 0 140px' }}>
                <Card style={{ padding:8, textAlign:'center' }}>
                  <div style={{ height:80, borderRadius:8, background: (r.primary_image_url||r.products.image_url) ? `url(${r.primary_image_url||r.products.image_url}) center/cover` : theme.tealMist, marginBottom:6 }} />
                  <div style={{ fontSize:12, fontWeight:700, color:theme.navy, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.products.name}</div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      <MiniCart open={miniOpen} onClose={()=>setMiniOpen(false)} />
    </div>
  )
}
