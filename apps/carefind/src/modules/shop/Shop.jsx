import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Heart, ShoppingCart, SlidersHorizontal, ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, Toast } from '../../components/ui'
import { useToast } from '../../components/ui'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { createShopRepository } from './shopRepository'
import { useCart } from './CartProvider'
import { useWishlist } from './WishlistProvider'
import MiniCart from './MiniCart'
import { getRecent } from './recentlyViewed'
import { reviewsRepository } from './reviewsRepository'
import ProductGrid from '../marketplace/ProductGrid'

const shopRepository = createShopRepository()

// Embedded in Search, the Filters sheet owns price/category/Rx/stock/sort and passes them as `filters`; Shop's own
// controls only exist (and only matter) when it renders standalone. `onCategoriesChange` lets the sheet offer this
// catalogue's categories, since Search's own category list is only fetched for the other tabs. `userCoords` is the
// buyer's location (Search already asked for it) so each card can show how far the seller is.
export default function Shop({ segment: initialSegment = 'all', query: externalQuery = '', embedded = false, filters, onCategoriesChange, userCoords }) {
  const { count, addItem } = useCart()
  const location = useLocation()
  const { msg: toastMsg, type: toastType, show: showToast } = useToast()
  const { has: hasWishlist, toggle: toggleWishlist } = useWishlist()
  const [segment, setSegment] = useState(initialSegment)
  const [miniOpen, setMiniOpen] = useState(false)
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [brand, setBrand] = useState('all')
  const [category, setCategory] = useState('all')
  const [showRxOnly, setShowRxOnly] = useState(false)
  const [inStockOnly, setInStockOnly] = useState(true)
  const [sort, setSort] = useState('popular')
  const [recentIds, setRecentIds] = useState([])
  const [ratings, setRatings] = useState({})
  const { isMobile } = useBreakpoint()
  const [showFilters, setShowFilters] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const touchStartY = useRef(null)
  const pullRaf = useRef(null)

  const handleAddToCart = useCallback((item) => {
    addItem(item)
    showToast('Added to cart!', { type: 'success', duration: 2000 })
  }, [addItem, showToast])

  useEffect(() => { setSegment(initialSegment) }, [initialSegment])
  useEffect(() => { setRecentIds(getRecent()) }, [])

  const { data: products = [], isLoading: loading, error: queryError, refetch } = useQuery({
    queryKey: ['shop-products', segment, externalQuery],
    queryFn: () => shopRepository.getActiveProducts({ segment, query: externalQuery, limit: 80 }),
    staleTime: 30 * 1000,
  })

  // Pull-to-refresh — disabled when embedded (Search already owns scroll), rAF-throttled
  // to avoid 60Hz re-renders of 80 cards that caused mouse shake + hang.
  const handleTouchStart = useCallback((e) => {
    if (embedded || window.scrollY > 0) return
    touchStartY.current = e.touches[0].clientY
  }, [embedded])

  const handleTouchMove = useCallback((e) => {
    if (embedded || touchStartY.current == null || refreshing) return
    const delta = e.touches[0].clientY - touchStartY.current
    if (delta > 0 && window.scrollY === 0) {
      const next = Math.min(delta * 0.5, 120)
      if (pullRaf.current) return
      pullRaf.current = requestAnimationFrame(() => {
        setPullDistance(next)
        pullRaf.current = null
      })
    }
  }, [embedded, refreshing])

  const handleTouchEnd = useCallback(async () => {
    if (embedded) return
    if (pullRaf.current) { cancelAnimationFrame(pullRaf.current); pullRaf.current = null }
    if (pullDistance > 80 && !refreshing) {
      setRefreshing(true)
      setPullDistance(60)
      try { await refetch() } catch {}
      setRefreshing(false)
    }
    setPullDistance(0)
    touchStartY.current = null
  }, [embedded, pullDistance, refreshing, refetch])

  useEffect(() => () => { if (pullRaf.current) cancelAnimationFrame(pullRaf.current) }, [])
  const error = queryError ? 'Could not load Shop products' : ''
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

  const brands = useMemo(() => {
    const s = new Set((products||[]).map(r => r.category || r.products?.category).filter(Boolean))
    return ['all', ...Array.from(s)]
  }, [products])

  const categories = useMemo(() => {
    const s = new Set((products||[]).map(r => r.ecommerce_category || r.category).filter(Boolean))
    return ['all', ...Array.from(s)]
  }, [products])

  useEffect(() => { onCategoriesChange?.(categories) }, [categories, onCategoriesChange])

  // The filter values in effect: the parent's sheet when embedded, Shop's own controls otherwise.
  const active = embedded && filters ? filters : { priceMin, priceMax, category, showRxOnly, inStockOnly, sort }

  const filtered = useMemo(() => {
    let rows = [...products]
    if (brand !== 'all') rows = rows.filter(r => (r.category || r.products?.category) === brand)
    if (active.category !== 'all') rows = rows.filter(r => (r.ecommerce_category || r.category) === active.category)
    if (active.priceMin !== '') rows = rows.filter(r => {
      const k = r.ecommerce_price_kobo ?? (r.products.price!=null ? Math.round(r.products.price*100) : null)
      return k != null && k >= Math.round(parseFloat(active.priceMin)*100)
    })
    if (active.priceMax !== '') rows = rows.filter(r => {
      const k = r.ecommerce_price_kobo ?? (r.products.price!=null ? Math.round(r.products.price*100) : null)
      return k != null && k <= Math.round(parseFloat(active.priceMax)*100)
    })
    if (active.showRxOnly) rows = rows.filter(r => r.prescription_required)
    if (active.inStockOnly) rows = rows.filter(r => (r.products?.stock ?? 0) > 0)
    if (active.sort === 'price_asc') rows.sort((a,b) => (a.ecommerce_price_kobo ?? a.products.price*100 ?? 0) - (b.ecommerce_price_kobo ?? b.products.price*100 ?? 0))
    else if (active.sort === 'price_desc') rows.sort((a,b) => (b.ecommerce_price_kobo ?? b.products.price*100 ?? 0) - (a.ecommerce_price_kobo ?? a.products.price*100 ?? 0))
    else if (active.sort === 'newest') rows.sort((a,b) => new Date(b.active_at) - new Date(a.active_at))
    else if (active.sort === 'rating') rows.sort((a,b) => (ratings[b.id]?.avg||0) - (ratings[a.id]?.avg||0))
    return rows
  }, [products, brand, active.category, active.priceMin, active.priceMax, active.showRxOnly, active.inStockOnly, active.sort, ratings])

  // The unfiltered landing shows a featured row; any query, segment or filter shows every match straight away.
  const filtersActive = active.priceMin !== '' || active.priceMax !== '' || active.category !== 'all' || active.showRxOnly || !active.inStockOnly || active.sort !== 'popular'
  const isFiltered = externalQuery.trim() !== '' || segment !== 'all' || brand !== 'all' || filtersActive
  const canCollapse = !isFiltered && filtered.length > 4
  const collapsed = canCollapse && !showAll
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

  // Postgres 42501 / HTTP 401: the catalogue is not readable without a session.
  const needsSignIn = queryError && (String(queryError.code) === '42501' || queryError.status === 401)
  if (needsSignIn) {
    return (
      <div style={outerStyle}>
        <div role="status" style={{ padding: '40px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <Lock size={32} color={theme.tealDeep} aria-hidden="true" />
          <div style={{ fontSize: 16, fontWeight: 800, color: theme.navy }}>Sign in to browse the shop</div>
          <div style={{ fontSize: 13, color: theme.textMid, maxWidth: 320 }}>Sign in or create a free account to see products from trusted sellers and place an order.</div>
          <Link to="/login" state={{ from: location.pathname + location.search }} style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '0 24px', borderRadius: 10, background: theme.tealDeep, color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>Sign in</Link>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={outerStyle}>
        <div role="alert" style={{ padding: 16, borderRadius: 12, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, textAlign: 'center', fontSize: 13 }}>
          {error} <button onClick={() => refetch()} style={{ marginLeft: 8, background: '#fff', border: `1px solid ${theme.danger}`, color: theme.danger, borderRadius: 8, padding: '6px 12px', fontWeight: 700, cursor: 'pointer' }}>Retry</button>
        </div>
      </div>
    )
  }

  const pullHandlers = embedded ? {} : { onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd }

  return (
    <div style={outerStyle} {...pullHandlers}>
      <Toast msg={toastMsg} type={toastType} />
      {/* Pull-to-refresh indicator — disabled when embedded */}
      {!embedded && (pullDistance > 0 || refreshing) && (
        <div style={{ textAlign:'center', overflow:'hidden', height: refreshing ? 50 : pullDistance, transition: refreshing ? 'none' : 'height 0.2s', display:'flex', alignItems:'center', justifyContent:'center', color: theme.tealDeep, fontSize: 13, fontWeight: 700 }}>
          {refreshing ? '↻ Refreshing...' : pullDistance > 80 ? '↓ Release to refresh' : '↓ Pull to refresh'}
        </div>
      )}
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

      {/* Faceted filters — hidden when embedded (parent Search.jsx handles via FilterSheet) */}
      {!embedded && isMobile && (
        <button
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-controls="shop-faceted-filters"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 44,
            padding: '8px 14px',
            borderRadius: 999,
            border: `1px solid ${theme.border}`,
            background: showFilters ? theme.tealMist : '#fff',
            color: showFilters ? theme.tealDeep : theme.navy,
            fontWeight: 800,
            fontSize: 12,
            cursor: 'pointer',
            marginBottom: showFilters ? 10 : 12,
          }}
        >
          <SlidersHorizontal size={14} aria-hidden="true" /> Filters <ChevronDown size={14} aria-hidden="true" style={{ transform: showFilters ? 'rotate(180deg)' : 'none', transition: `transform ${theme.motion.fast}` }} />
        </button>
      )}
      {!embedded && (
        <div
          id="shop-faceted-filters"
          style={
            isMobile
              ? { display: showFilters ? 'flex' : 'none', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, padding: '2px 0' }
              : { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: 10, border: `1px solid ${theme.border}`, borderRadius: 12, background: theme.cardBg }
          }
        >
          <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, fontWeight:700, color:theme.navy }}><SlidersHorizontal size={14}/> Filters</span>
          <select value={brand} onChange={e=>setBrand(e.target.value)} aria-label="Filter by brand" style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${theme.border}`, background:'#fff', fontSize:12, minHeight:44 }}>
            {brands.map(b => <option key={b} value={b}>{b==='all' ? 'All brands' : b}</option>)}
          </select>
          <select value={category} onChange={e=>setCategory(e.target.value)} aria-label="Filter by category" style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${theme.border}`, background:'#fff', fontSize:12, minHeight:44 }}>
            {categories.map(c => <option key={c} value={c}>{c==='all' ? 'All categories' : c}</option>)}
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
      )}
      {!embedded && <div style={{ fontSize:11, color: theme.textMid, marginBottom: 12 }}>{filtered.length} products {inStockOnly ? '· in stock' : ''} · {showRxOnly ? 'Rx only · ' : ''}sorted {sort}</div>}

      {/* Section header: "Featured products" on the landing, a result count once the buyer has searched or filtered */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, margin: '4px 0 12px' }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, letterSpacing: '-0.02em', color: theme.navy }}>{isFiltered ? 'Products' : 'Featured products'}</h2>
          <p style={{ margin: '2px 0 0 0', fontSize: 13, color: theme.textMid }}>
            {isFiltered ? `${filtered.length} ${filtered.length === 1 ? 'product' : 'products'} found` : 'Health products from trusted sellers near you.'}
          </p>
        </div>
        {canCollapse && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            aria-controls="shop-product-grid"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44, padding: '0 4px', background: 'none', border: 'none', color: theme.tealDeep, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', flexShrink: 0 }}
          >
            {showAll ? 'Show less' : 'View all'}
            <ChevronRight size={16} aria-hidden="true" style={{ transform: showAll ? 'rotate(90deg)' : 'none', transition: `transform ${theme.motion.fast}` }} />
          </button>
        )}
      </div>

      {/* Grid catalog — shared ProductGrid; collapsed to one row until "View all" */}
      <ProductGrid
        gridId="shop-product-grid"
        rows={filtered}
        loading={false}
        error=""
        collapsed={collapsed}
        onAddToCart={handleAddToCart}
        onToggleWishlist={toggleWishlist}
        hasWishlist={hasWishlist}
        ratings={ratings}
        userCoords={userCoords}
        variant="shop"
        emptyTitle={externalQuery ? `No products found for "${externalQuery}"` : 'No products match'}
        emptyHint={externalQuery ? 'Try a different search term or adjust filters.' : 'Try adjusting filters or search.'}
      />

      {/* Recently viewed */}
      {recent.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize:13, fontWeight:800, color:theme.navy, marginBottom:8 }}>Recently viewed</div>
          <div className="cf-hscroll" style={{ display:'flex', gap:12, overflowX:'auto', paddingBottom:8 }}>
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
