import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingBag, Package, Heart, ShoppingCart, SlidersHorizontal, Star } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, Empty, Pill } from '../../components/ui'
import { createShopRepository } from './shopRepository'
import { useCart } from './CartProvider'
import { useWishlist } from './WishlistProvider'
import MiniCart from './MiniCart'
import { getRecent } from './recentlyViewed'

const shopRepository = createShopRepository()

export default function Shop({ segment: initialSegment = 'all', query: externalQuery = '' }) {
  const { count, addItem } = useCart()
  const { has: hasWishlist, toggle: toggleWishlist } = useWishlist()
  const [segment, setSegment] = useState(initialSegment)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [miniOpen, setMiniOpen] = useState(false)
  // Faceted filters (premium)
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [brand, setBrand] = useState('all')
  const [showRxOnly, setShowRxOnly] = useState(false)
  const [inStockOnly, setInStockOnly] = useState(true)
  const [sort, setSort] = useState('popular')
  const [recentIds, setRecentIds] = useState([])

  useEffect(() => { setSegment(initialSegment) }, [initialSegment])
  useEffect(() => { load(); setRecentIds(getRecent()) }, [segment, externalQuery])

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
    // Sort
    if (sort === 'price_asc') rows.sort((a,b) => (a.ecommerce_price_kobo ?? a.products.price*100 ?? 0) - (b.ecommerce_price_kobo ?? b.products.price*100 ?? 0))
    else if (sort === 'price_desc') rows.sort((a,b) => (b.ecommerce_price_kobo ?? b.products.price*100 ?? 0) - (a.ecommerce_price_kobo ?? a.products.price*100 ?? 0))
    else if (sort === 'newest') rows.sort((a,b) => new Date(b.active_at) - new Date(a.active_at))
    else if (sort === 'rating') rows.sort((a,b) => (b.avg_rating||0) - (a.avg_rating||0))
    return rows
  }, [products, brand, priceMin, priceMax, showRxOnly, inStockOnly, sort])

  const featured = filtered.slice(0, 6)
  const grid = filtered
  const recent = useMemo(() => {
    if (!recentIds.length) return []
    const map = new Map(filtered.map(r => [r.id, r]))
    // fallback to products (may include not in filtered due to price filter)
    const allMap = new Map(products.map(r=>[r.id,r]))
    return recentIds.map(id => map.get(id) || allMap.get(id)).filter(Boolean).slice(0, 6)
  }, [recentIds, filtered, products])

  if (loading) return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} style={{ padding: 12, height: 180, background: theme.bg, border: `1px solid ${theme.border}` }}>
          <div style={{ height: 80, background: theme.gray100, borderRadius: 8, marginBottom: 8 }} />
          <div style={{ height: 12, background: theme.gray100, borderRadius: 4, marginBottom: 6 }} />
          <div style={{ height: 12, background: theme.gray100, borderRadius: 4, width: '60%' }} />
        </Card>
      ))}
    </div>
  )

  if (error) return (
    <div role="alert" style={{ padding: 16, borderRadius: 12, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, textAlign: 'center' }}>
      {error} <button onClick={load} style={{ marginLeft: 8, background: 'none', border: `1px solid ${theme.danger}`, color: theme.danger, borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>Retry</button>
    </div>
  )

  return (
    <div style={{ padding: 16 }}>
      {/* Top bar: cart + wishlist */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <Link to="/wishlist" style={{ display:'flex', alignItems:'center', gap: 6, padding:'8px 12px', borderRadius:8, border:`1px solid ${theme.border}`, background:'#fff', color:theme.navy, textDecoration:'none', fontWeight:700, fontSize:12 }}>
          <Heart size={16} /> Wishlist
        </Link>
        <button onClick={()=>setMiniOpen(true)} style={{ position:'relative', display:'flex', alignItems:'center', gap:8, padding:'8px 16px', borderRadius:8, background: theme.tealDeep, color:'#fff', border:'none', fontWeight:700, cursor:'pointer' }}>
          <ShoppingCart size={18} /> Cart
          {count > 0 && <span style={{ position:'absolute', top:-8, right:-8, background: theme.danger, color:'#fff', borderRadius:'50%', width:22, height:22, display:'grid', placeItems:'center', fontSize:11, fontWeight:800 }}>{count}</span>}
        </button>
      </div>

      {/* Segment filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }} role="group" aria-label="Segment filter">
        {[
          { value: 'all', label: 'All' },
          { value: 'retail', label: 'Retail' },
          { value: 'wholesale', label: 'Wholesale' },
          { value: 'distributor', label: 'Distributor' },
        ].map(s => (
          <button key={s.value} onClick={() => setSegment(s.value)} aria-pressed={segment === s.value}
            style={{ padding:'6px 12px', borderRadius:20, border:`1px solid ${segment === s.value ? theme.tealDeep : theme.border}`, background: segment === s.value ? theme.tealDeep : '#fff', color: segment === s.value ? '#fff' : theme.textMid, fontSize: 12, fontWeight:700, cursor:'pointer' }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Faceted filters + sort (premium) */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom: 12, padding:10, border:`1px solid ${theme.border}`, borderRadius:12, background: theme.cardBg }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, fontWeight:700, color:theme.navy }}><SlidersHorizontal size={14}/> Filters</span>
        <select value={brand} onChange={e=>setBrand(e.target.value)} style={{ padding:'6px 10px', borderRadius:8, border:`1px solid ${theme.border}`, background:'#fff', fontSize:12 }}>
          {brands.map(b => <option key={b} value={b}>{b==='all' ? 'All brands' : b}</option>)}
        </select>
        <input placeholder="Min ₦" value={priceMin} onChange={e=>setPriceMin(e.target.value)} inputMode="numeric" style={{ width:90, padding:'6px 8px', borderRadius:8, border:`1px solid ${theme.border}`, fontSize:12 }} />
        <input placeholder="Max ₦" value={priceMax} onChange={e=>setPriceMax(e.target.value)} inputMode="numeric" style={{ width:90, padding:'6px 8px', borderRadius:8, border:`1px solid ${theme.border}`, fontSize:12 }} />
        <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:theme.navy }}><input type="checkbox" checked={showRxOnly} onChange={e=>setShowRxOnly(e.target.checked)} /> Rx only</label>
        <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:theme.navy }}><input type="checkbox" checked={inStockOnly} onChange={e=>setInStockOnly(e.target.checked)} /> In stock</label>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
          Sort <select value={sort} onChange={e=>setSort(e.target.value)} style={{ padding:'6px 10px', borderRadius:8, border:`1px solid ${theme.border}`, background:'#fff' }}>
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
                      {p.sale_type && <Pill label={p.sale_type} type="gray" style={{ fontSize: 9, alignSelf: 'flex-start' }} />}
                    </Card>
                  </Link>
                  <button onClick={(e)=>{ e.preventDefault(); toggleWishlist(row.id)}} aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'} style={{ position:'absolute', top:6, right:6, width:28, height:28, borderRadius:'50%', border:`1px solid ${theme.border}`, background: wished ? theme.tealDeep : '#fff', color: wished ? '#fff' : theme.navy, display:'grid', placeItems:'center', cursor:'pointer' }}><Heart size={14} fill={wished ? '#fff' : 'none'} /></button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Grid catalog - 2 per row minimum */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }} role="list" aria-label="Shop catalog">
        {grid.map(row => {
          const p = row.products
          const priceKobo = row.ecommerce_price_kobo ?? (p.price != null ? Math.round(p.price * 100) : null)
          const priceLabel = priceKobo != null ? `₦${(priceKobo/100).toLocaleString()}` : 'Ask for price'
          const thumb = row.primary_image_url || p.image_url || null
          const wished = hasWishlist(row.id)
          return (
            <div key={row.id} style={{ position:'relative' }} role="listitem">
              <Link to={`/shop/${row.id}`} style={{ textDecoration: 'none' }}>
                <Card style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, height: '100%' }}>
                  <div style={{ height: 120, borderRadius: 8, background: thumb ? `url(${thumb}) center/cover` : theme.tealMist, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.tealDeep }}>
                    {!thumb && <Package size={28} />}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: theme.navy, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 32 }}>{p.name}</div>
                  {p.generic_name && <div style={{ fontSize: 11, color: theme.textLight, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.generic_name}</div>}
                  {row.prescription_required && <span style={{ fontSize:10, fontWeight:700, color:theme.warning, border:`1px solid ${theme.warning}30`, background:'#fffbeb', padding:'2px 6px', borderRadius:6, alignSelf:'flex-start' }}>Rx</span>}
                  <div style={{ fontSize: 13, fontWeight: 800, color: theme.tealDeep, marginTop: 'auto' }}>{priceLabel}</div>
                  <div style={{ display:'flex', gap:4, alignItems:'center' }}>{p.sale_type && <Pill label={p.sale_type === 'retail' ? 'Retail' : p.sale_type === 'wholesale' ? 'Wholesale' : 'Distributor'} type="gray" style={{ fontSize: 9, alignSelf: 'flex-start' }} />}<span style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:10, color:theme.textLight }}><Star size={11}/> 4.8</span></div>
                </Card>
              </Link>
              <button onClick={()=>toggleWishlist(row.id)} aria-label={wished ? 'Remove wishlist' : 'Add wishlist'} style={{ position:'absolute', top:8, right:8, width:28, height:28, borderRadius:'50%', border:`1px solid ${theme.border}`, background: wished ? theme.tealDeep : 'rgba(255,255,255,0.95)', color: wished ? '#fff' : theme.navy, display:'grid', placeItems:'center', cursor:'pointer' }}><Heart size={14} fill={wished ? '#fff' : 'none'} /></button>
              <button onClick={()=>{ const k = row.ecommerce_price_kobo ?? (p.price!=null ? Math.round(p.price*100) : null); if(k!=null) addItem({ ecommerce_product_id: row.id, product_name: p.name, unit_price_kobo: k, quantity:1, image_url: thumb, vendor_id: row.business_id, sale_type: p.sale_type })}} style={{ position:'absolute', bottom:8, right:8, width:32, height:32, borderRadius:'50%', background: theme.tealDeep, color:'#fff', border:'none', display:'grid', placeItems:'center', cursor:'pointer', boxShadow: theme.elevation[1] }}><ShoppingCart size={16}/></button>
            </div>
          )
        })}
      </div>

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
