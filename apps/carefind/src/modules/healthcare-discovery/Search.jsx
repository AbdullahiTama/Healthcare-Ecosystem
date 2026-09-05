import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import Shop from '../shop/Shop'
import { useAuth } from '../../providers/AuthContext'
import {
  BadgeCheck, Building2, ChevronRight, MapPin, MessageCircle, Phone, Pill as PillIcon,
  Search as SearchIcon, SearchX, ShoppingBag, Sparkles, Star, Stethoscope,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import { useGeolocation } from '../../hooks/useGeolocation'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { Card, Pill, Avatar, CardSkeleton, Empty, Toast, useToast } from '../../components/ui'
import StoryAvatar from '../../components/StoryAvatar.jsx'
import StoryViewer from '../social-feed/components/StoryViewer.jsx'
import { fetchViewedStoryIds, markStoriesViewed } from '../social-feed/storyViews.js'
import { canShowPrice, distanceLabel, formatDistance, SALE_TYPE_LABELS, productCoords, businessCoords, haversineMeters, whatsappLink, telLink } from '../utils/marketplace.js'
import { recordContactLead } from '../utils/contactLeads.js'
import { attachOwnerProfiles, sellerName, sellerContact, sellerPhone } from '../utils/sellerLookup.js'
import MarketplaceTabs from '../marketplace/MarketplaceTabs.jsx'
import BusinessTypeFilter from '../marketplace/BusinessTypeFilter.jsx'
import Logo from '../social-feed/Logo.jsx'
import { useCart } from '../shop/CartProvider'

const NG_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta',
  'Ebonyi','Edo','Ekiti','Enugu','FCT - Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina',
  'Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers',
  'Sokoto','Taraba','Yobe','Zamfara',
]

function Search() {
  const { user } = useAuth()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const { coords: userCoords } = useGeolocation()
  const { count: cartCount } = useCart()

  const distanceMeters = (p, u) => {
    const c = productCoords(p)
    if (!c || !u) return Infinity
    const d = haversineMeters(c.lat, c.lng, u.lat, u.lng)
    return d == null ? Infinity : d
  }
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState(() => {
    const t = searchParams.get('tab')
    if (t && ['shop','products','businesses','professionals'].includes(t)) return t
    return 'shop'
  })
  const [stateFilter, setStateFilter] = useState('')
  const [saleTypeFilter, setSaleTypeFilter] = useState('')
  const [nearMe, setNearMe] = useState(false)
  const [specialtyFilter, setSpecialtyFilter] = useState('')
  const [businesses, setBusinesses] = useState([])
  const [bizHasMore, setBizHasMore] = useState(false)
  const [products, setProducts] = useState([])
  const [professionals, setProfessionals] = useState([])
  const [loading, setLoading] = useState(false)
  const [featured, setFeatured] = useState([])
  const [featuredType, setFeaturedType] = useState('promo')
  const [proStories, setProStories] = useState([])
  const [proViewed, setProViewed] = useState(() => new Set())
  const [storyViewer, setStoryViewer] = useState(null)
  const trackRef = useRef(null)
  const toast = useToast()

  useEffect(() => {
    if (featured.length === 0) return
    let raf
    let offset = 0
    const speed = 0.4
    function step() {
      const el = trackRef.current
      if (el) {
        offset += speed
        const half = el.scrollWidth / 2
        if (offset >= half) offset = 0
        el.style.transform = `translateX(${-offset}px)`
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [featured])

  useEffect(() => { loadFeatured() }, [])
  useEffect(() => { runSearch() }, [tab, stateFilter, saleTypeFilter, specialtyFilter, nearMe])

  useEffect(() => {
    const cur = searchParams.get('tab')
    if (cur !== tab) {
      const next = new URLSearchParams(searchParams)
      if (tab === 'shop') next.delete('tab')
      else next.set('tab', tab)
      setSearchParams(next, { replace: true })
    }
  }, [tab])

  useEffect(() => {
    const t = searchParams.get('tab')
    if (t && ['products','businesses','professionals','shop'].includes(t) && t !== tab) setTab(t)
  }, [])

  async function loadFeatured() {
    const { data } = await supabase
      .from('promotions')
      .select('id, title, image_url, link_url, expires_at')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(20)
    if (data && data.length > 0) {
      setFeatured(data)
      setFeaturedType('promo')
      return
    }
    const { data: prods } = await supabase
      .from('products')
      .select('id, name, emoji, price, show_price, latitude, longitude, business_id, list_on_carefind, businesses(name, latitude, longitude, lat, lng, show_prices)')
      .order('created_at', { ascending: false })
      .limit(14)
    setFeatured((prods || []).filter(p => p.list_on_carefind !== false))
    setFeaturedType('product')
  }

  const businessesQuery = (q, st) => {
    let bq = supabase.from('businesses').select('id, name, business_type, city, state, cover_url, booking_enabled, latitude, longitude, lat, lng')
      .eq('visible_on_carefind', true)
      .eq('status', 'active')
    if (q) bq = bq.or(`name.ilike.%${q}%,business_type.ilike.%${q}%,city.ilike.%${q}%,state.ilike.%${q}%`)
    if (st) bq = bq.ilike('state', `%${st}%`)
    return bq
  }

  async function loadMoreBusinesses() {
    const offset = businesses.length
    const { data } = await businessesQuery(query.trim(), stateFilter).range(offset, offset + 39)
    let merged = [...businesses, ...(data || [])]
    if (nearMe && userCoords) {
      merged = [...merged].sort((a, b) => {
        const da = businessCoords(a) ? haversineMeters(businessCoords(a).lat, businessCoords(a).lng, userCoords.lat, userCoords.lng) : Infinity
        const db = businessCoords(b) ? haversineMeters(businessCoords(b).lat, businessCoords(b).lng, userCoords.lat, userCoords.lng) : Infinity
        return da - db
      })
    }
    setBusinesses(merged)
    setBizHasMore((data || []).length === 40)
  }

  async function runSearch(e) {
    if (e) e.preventDefault()
    if (tab === 'shop') {
      setLoading(false)
      setProducts([]); setBusinesses([]); setProfessionals([])
      return
    }
    setLoading(true)
    const q = query.trim()
    let resultCount = 0

    if (tab === 'products') {
      let pq = supabase.from('products').select('id, name, emoji, price, show_price, category, generic_name, whatsapp, image_url, sale_type, price_unit, min_purchase, seller_location, latitude, longitude, business_id, owner_id, list_on_carefind, created_at, businesses(name, city, state, whatsapp, phone, latitude, longitude, lat, lng, show_prices)')
      if (q) pq = pq.or(`name.ilike.%${q}%,generic_name.ilike.%${q}%,category.ilike.%${q}%`)
      if (saleTypeFilter) pq = pq.eq('sale_type', saleTypeFilter)
      pq = pq.order('created_at', { ascending: false }).limit(100)
      const { data } = await pq
      let list = (data || []).filter(p => p.list_on_carefind !== false)
      if (stateFilter) list = list.filter(p => (p.seller_location || p.businesses?.state || p.businesses?.city || '').toLowerCase().includes(stateFilter.toLowerCase()))
      list = await attachOwnerProfiles(list)
      if (nearMe && userCoords) list = [...list].sort((a, b) => {
        const da = distanceMeters(a, userCoords)
        const db = distanceMeters(b, userCoords)
        return da - db
      })
      setProducts(list)
      setBusinesses([]); setProfessionals([])
      resultCount = list.length
    }
    else if (tab === 'businesses') {
      const { data } = await businessesQuery(q, stateFilter).range(0, 39)
      let list = (data || [])
      if (nearMe && userCoords) list = [...list].sort((a, b) => {
        const da = businessCoords(a) ? haversineMeters(businessCoords(a).lat, businessCoords(a).lng, userCoords.lat, userCoords.lng) : Infinity
        const db = businessCoords(b) ? haversineMeters(businessCoords(b).lat, businessCoords(b).lng, userCoords.lat, userCoords.lng) : Infinity
        return da - db
      })
      setBusinesses(list)
      setBizHasMore((data || []).length === 40)
      setProducts([]); setProfessionals([])
      resultCount = list.length
    }
    else if (tab === 'professionals') {
      let pf = supabase.from('profiles').select('id, full_name, display_name, verification_label, specialty, location, is_verified, avatar_url').eq('is_verified', true)
      if (q) pf = pf.or(`full_name.ilike.%${q}%,display_name.ilike.%${q}%`)
      if (specialtyFilter.trim()) pf = pf.ilike('specialty', `%${specialtyFilter}%`)
      if (stateFilter) pf = pf.ilike('location', `%${stateFilter}%`)
      const { data } = await pf.limit(40)
      setProfessionals(data || [])
      setProducts([]); setBusinesses([])
      resultCount = (data || []).length
      // Batch story ring for professionals (avoid N+1)
      const ids = (data || []).map((p) => p.id)
      if (ids.length) {
        const { data: rows } = await supabase.from('stories').select('id, user_id, expires_at').in('user_id', ids).gt('expires_at', new Date().toISOString())
        const s = rows || []
        setProStories(s)
        if (s.length && user?.id) {
          const seen = await fetchViewedStoryIds(supabase, s.map((x) => x.id))
          setProViewed(seen)
        } else setProViewed(new Set())
      } else {
        setProStories([]); setProViewed(new Set())
      }
    }

    setLoading(false)

    if (q || stateFilter || specialtyFilter) {
      const { error: logErr } = await supabase.from('search_logs').insert({
        query: q || null,
        category: tab,
        user_id: user?.id || null,
        results_count: resultCount,
        found: resultCount > 0,
      })
      if (logErr) toast.show('Search log failed: ' + logErr.message)
    }
  }

  const showingFeatured = tab === 'products' && !query.trim()

  const bodyContent = (
    <div style={isMobile ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', padding: '0 16px', paddingBottom: 'calc(100px + env(safe-area-inset-bottom))', background: theme.bg, minHeight: '100vh', overflowX: 'hidden', boxSizing: 'border-box' } : { fontFamily: theme.fontFamily }}>
      <style>{`
        @keyframes medmarket-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .mm-track { display: flex; gap: 12px; width: max-content; will-change: transform; }
        .mm-card { transition: transform 0.12s ease; }
        .mm-card:active { transform: scale(0.96); }
        /* hide scrollbars for tab rows but keep scroll */
        .hide-scrollbar::-webkit-scrollbar { display:none; height:0; }
        .hide-scrollbar { scrollbar-width:none; -ms-overflow-style:none; }
      `}</style>

      {/* 1 — CareFind Header (mobile) — matches home page style */}
      {isMobile && (
        <div style={{
          background: theme.heroGradient,
          margin: '-20px -20px 0 -20px',
          padding: '14px 16px 14px',
          borderRadius: '0 0 24px 24px',
          color: '#fff',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link to="/feed" style={{ textDecoration: 'none', flexShrink: 0 }}>
              <Logo size={30} />
            </Link>
            <div style={{ flex: 1 }} />
            <Link to="/cart" style={{
              width: 36, height: 36, borderRadius: theme.radius.md,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.1)', color: '#fff',
              textDecoration: 'none', position: 'relative',
            }}>
              <ShoppingBag size={18} aria-hidden="true" />
              {cartCount > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  minWidth: 16, height: 16, padding: '0 4px',
                  borderRadius: theme.radius.sm, background: theme.danger,
                  color: '#fff', fontSize: 9, fontWeight: 900,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxSizing: 'border-box', border: '1.5px solid rgba(14,111,90,0.7)',
                }}>{cartCount > 99 ? '99+' : cartCount}</span>
              )}
            </Link>
            <Link to={user ? '/profile' : '/login'} style={{ textDecoration: 'none' }}>
              <Avatar name={myUsername} src={myAvatar} size={36} style={{ border: '2px solid rgba(255,255,255,0.28)' }} />
            </Link>
          </div>
        </div>
      )}

      {/* 2 — Main Search — prominent, integrated */}
      <div style={{ padding: isMobile ? '14px 16px 12px' : '18px 0 14px', background: isMobile ? '#fff' : 'transparent', borderBottom: isMobile ? `1px solid ${theme.hairline}` : 'none' }}>
        <form onSubmit={runSearch} role="search" aria-label="Marketplace search" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <SearchIcon size={18} color={theme.textLight} aria-hidden="true" style={{ position: 'absolute', left: 12, pointerEvents: 'none' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search medication, facility, professional..."
              aria-label="Search medication, facility, professional"
              style={{
                width: '100%',
                minHeight: 44,
                padding: '11px 12px 11px 38px',
                fontSize: isMobile ? 16 : 14,
                border: `1px solid ${theme.border}`,
                borderRadius: 12,
                boxSizing: 'border-box',
                fontFamily: theme.fontFamily,
                background: isMobile ? '#fff' : theme.cardBg,
                outline: 'none',
                WebkitTextSizeAdjust: '100%',
              }}
            />
          </div>
          <button
            type="submit"
            aria-label="Search"
            style={{
              minHeight: 44,
              padding: '0 20px',
              background: theme.tealDeep,
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontWeight: 800,
              fontSize: 14,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              boxSizing: 'border-box',
              WebkitTapHighlightColor: 'transparent',
              transition: `transform ${theme.motion.fast} ${theme.motion.easeOut}`,
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.97)' }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            Search
          </button>
        </form>
      </div>

      {/* 3 — Marketplace Navigation — Shop first, one line, never wrap */}
      <div style={{ padding: '10px 0 8px', background: isMobile ? '#fff' : 'transparent', borderBottom: isMobile ? `1px solid ${theme.hairline}` : 'none', position: isMobile ? 'sticky' : 'static', top: isMobile ? 64 : undefined, zIndex: isMobile ? 30 : undefined }}>
        <MarketplaceTabs activeTab={tab} onChange={setTab} />
      </div>

      {/* 4 — Location filter — City or state */}
      <div style={{ padding: isMobile ? '12px 16px 0' : '14px 0 0', background: isMobile ? '#fff' : 'transparent' }}>
        <label htmlFor="marketplace-location" style={{ display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: theme.textLight, marginBottom: 6 }}>Location</label>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <MapPin size={16} color={theme.gray400} aria-hidden="true" style={{ position: 'absolute', left: 12, pointerEvents: 'none' }} />
          <input
            id="marketplace-location"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            placeholder="City or state (e.g., Lagos, Abuja)"
            aria-label="Filter by city or state"
            list="carefind-locations"
            style={{
              width: '100%',
              minHeight: 44,
              padding: '11px 12px 11px 36px',
              fontSize: isMobile ? 16 : 13.5,
              border: `1px solid ${theme.border}`,
              borderRadius: 12,
              boxSizing: 'border-box',
              fontFamily: theme.fontFamily,
              background: theme.cardBg,
            }}
          />
        </div>
        <datalist id="carefind-locations">
          {NG_STATES.map(s => <option key={s} value={s} />)}
        </datalist>
        {tab === 'professionals' && (
          <input value={specialtyFilter} onChange={(e) => setSpecialtyFilter(e.target.value)} placeholder="Specialty" aria-label="Filter by specialty" style={{ marginTop: 8, width: '100%', minHeight: 44, padding: 11, fontSize: isMobile ? 16 : 13, border: `1px solid ${theme.border}`, borderRadius: 12, boxSizing: 'border-box', fontFamily: theme.fontFamily, background: theme.cardBg }} />
        )}
        {stateFilter && (
          <button onClick={() => setStateFilter('')} style={{ marginTop: 8, minHeight: 32, padding: '4px 12px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 999, fontSize: 11, fontWeight: 700, color: theme.textLight, cursor: 'pointer' }}>Clear location</button>
        )}
      </div>

      {/* 5 — Business type filters + Near me — one line, never wrap */}
      <div style={{ padding: '12px 0 10px', background: isMobile ? '#fff' : 'transparent', borderBottom: isMobile ? `1px solid ${theme.hairline}` : 'none' }}>
        <BusinessTypeFilter value={saleTypeFilter} onChange={setSaleTypeFilter} nearMe={nearMe} onNearMeToggle={setNearMe} userCoords={userCoords} />
      </div>

      {/* Featured rail — only for products tab discovery */}
      {showingFeatured && featured.length > 0 && (
        <div style={{ padding: '14px 0 4px', background: isMobile ? '#fff' : 'transparent' }}>
          <p style={{ margin: '0 0 10px 16px', fontSize: 12, fontWeight: 900, color: theme.navy }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Sparkles size={14} color={theme.tealDeep} aria-hidden="true" /> {featuredType === 'promo' ? 'Featured promotions' : 'Featured on CareFind'}</span></p>
          <div style={{ overflow: 'hidden', width: '100%' }}>
            <div className="mm-track" ref={trackRef}>
              {[...featured, ...featured].map((p, i) => (
                featuredType === 'promo' ? (
                  <Link key={i} className="mm-card" to={p.link_url || '/search'} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 200 }}>
                    <Card style={{ overflow: 'hidden' }}>
                      <div style={{ height: 110, background: p.image_url ? `url(${p.image_url})` : theme.navy, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'flex-start', padding: 8 }}>
                        <span style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: '0.06em', color: '#fff', background: theme.tealDeep, padding: '2px 8px', borderRadius: 20, textTransform: 'uppercase' }}>Promo</span>
                      </div>
                      <div style={{ padding: '9px 11px 12px' }}>
                        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: theme.navy, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.title}</p>
                      </div>
                    </Card>
                  </Link>
                ) : (
                  <Link key={i} className="mm-card" to={`/drug/${encodeURIComponent(p.name)}`} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 130 }}>
                    <Card style={{ padding: 12, textAlign: 'center' }}>
                      <div style={{
                        width: 46, height: 46, borderRadius: theme.radius.md, margin: '0 auto 8px',
                        background: theme.tealMist, color: theme.tealDeep,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}><PillIcon size={22} aria-hidden="true" /></div>
                      <p style={{ margin: '0 0 3px 0', fontSize: 12.5, fontWeight: 800, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                      {canShowPrice(p)
                        ? <p style={{ margin: '0 0 2px 0', fontSize: 12, fontWeight: 700, color: theme.tealDeep }}>₦{Number(p.price).toLocaleString()}</p>
                        : <p style={{ margin: '0 0 2px 0', fontSize: 11, fontWeight: 700, color: theme.textLight }}>Ask for price</p>}
                      <p style={{ margin: 0, fontSize: 10, color: theme.textLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.businesses?.name || ''}</p>
                      {(() => {
                        const dist = distanceLabel(p, userCoords)
                        return dist ? (
                          <p style={{ margin: '3px 0 0 0', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: theme.tealDeep, fontWeight: 700 }}>
                            <MapPin size={10} aria-hidden="true" /> {dist}
                          </p>
                        ) : null
                      })()}
                    </Card>
                  </Link>
                )
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6 — Marketplace Content */}
      <div style={isMobile ? { padding: '14px 12px 0' } : { padding: '18px 0 0' }}>
        {/* Shop heading per spec when Shop active */}
        {tab === 'shop' && (
          <div style={{ marginBottom: 12, padding: isMobile ? '0 4px' : 0 }}>
            <h2 id="marketplace-panel-shop" style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.navy, letterSpacing: '-0.02em' }}>Shop</h2>
            <p style={{ margin: '2px 0 0 0', fontSize: 12.5, color: theme.textLight }}>Discover health products from trusted sellers near you.</p>
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        )}

        {!loading && tab === 'products' && products.length === 0 && (query.trim() || stateFilter) && (
          <Empty icon={<SearchX size={44} color={theme.gray300} strokeWidth={1.5} />} cause="filtered" message={<><div style={{ fontSize: 14, fontWeight: 700, color: theme.navy, marginBottom: 4 }}>No products found</div><div style={{ fontSize: 12.5, color: theme.textLight }}>Try another name or state.</div></>} />
        )}
        {!loading && tab === 'businesses' && businesses.length === 0 && (
          <Empty icon={<SearchX size={44} color={theme.gray300} strokeWidth={1.5} />} cause="filtered" message={<><div style={{ fontSize: 14, fontWeight: 700, color: theme.navy, marginBottom: 4 }}>No health facilities found</div><div style={{ fontSize: 12.5, color: theme.textLight }}>Try another state.</div></>} />
        )}
        {!loading && tab === 'professionals' && professionals.length === 0 && (
          <Empty icon={<SearchX size={44} color={theme.gray300} strokeWidth={1.5} />} cause="filtered" message={<><div style={{ fontSize: 14, fontWeight: 700, color: theme.navy, marginBottom: 4 }}>No professionals found</div><div style={{ fontSize: 12.5, color: theme.textLight }}>Try another specialty or state.</div></>} />
        )}

        {!loading && tab === 'shop' && (
          <div role="tabpanel" id="marketplace-panel-shop" aria-labelledby="marketplace-tab-shop">
            <Shop segment={saleTypeFilter} query={query} embedded />
          </div>
        )}

        {/* Products: 2-col grid on mobile, 3 tablet, 4 desktop — CSS media, not JS, so first paint is correct */}
        {!loading && tab === 'products' && products.length > 0 && (
          <>
            <style>{`
              .mp-products-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
              @media (min-width: 768px) { .mp-products-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
              @media (min-width: 1024px) { .mp-products-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
              .mp-products-grid > * { min-width: 0; }
            `}</style>
            <div role="tabpanel" id="marketplace-panel-products" aria-labelledby="marketplace-tab-products" className="mp-products-grid">

            {products.map((p, idx) => {
              const waLink = whatsappLink(sellerContact(p), `Hi, I'm interested in "${p.name}" on CareFind.`)
              const callLink = telLink(sellerPhone(p))
              const priceVisible = canShowPrice(p)
              return (
                <div key={p.id} className="mm-card" style={{ display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, overflow: 'hidden', height: '100%' }}>
                  <Link to={`/drug/${encodeURIComponent(p.name)}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', flex: 1 }}>
                    <div style={{ height: 118, background: p.image_url ? `url(${p.image_url}) center/cover` : theme.tealMist, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.tealDeep, flexShrink: 0, borderBottom: `1px solid ${theme.hairline}` }}>
                      {!p.image_url && <PillIcon size={26} aria-hidden="true" />}
                    </div>
                    <div style={{ padding: '9px 10px 8px', display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: theme.navy, lineHeight: 1.32, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 34, wordBreak: 'break-word', overflowWrap: 'anywhere' }} title={p.name}>
                        {p.name}{p.category && <Pill label={p.category} type="teal" style={{ fontSize: 9, padding: '1px 6px', marginLeft: 6 }} />}
                      </div>
                      {p.generic_name && <div style={{ fontSize: 11, color: theme.textMid, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{p.generic_name}</div>}
                      <div style={{ fontSize: 11, color: theme.textLight, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                        {p.business_id ? (
                          <span style={{ color: theme.tealDeep, fontWeight: 700 }}>{sellerName(p)}</span>
                        ) : p.owner_id ? (
                          <span style={{ color: theme.tealDeep, fontWeight: 700 }}>{sellerName(p)}</span>
                        ) : null}
                        {p.seller_location ? ` · ${p.seller_location}` : p.businesses?.state ? ` · ${p.businesses.state}` : ''}
                      </div>
                      {(p.sale_type || p.min_purchase) && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {p.sale_type && <Pill label={SALE_TYPE_LABELS[p.sale_type] || p.sale_type} type={p.sale_type === 'retail' ? 'teal' : 'purple'} style={{ fontSize: 9, textTransform: 'uppercase' }} />}
                          {p.min_purchase && <Pill label={`Min ${p.min_purchase} ${p.price_unit || ''}${p.min_purchase > 1 ? 's' : ''}`} type="gray" style={{ fontSize: 9 }} />}
                        </div>
                      )}
                      <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        {priceVisible ? <span style={{ fontSize: 13.5, fontWeight: 900, color: theme.tealDeep }}>₦{Number(p.price).toLocaleString()}</span> : <span style={{ fontSize: 12, fontWeight: 800, color: theme.textLight }}>Ask for price</span>}
                        {p.price_unit && priceVisible && <span style={{ fontSize: 10, color: theme.textLight }}>per {p.price_unit}</span>}
                      </div>
                      {(() => {
                        const dist = distanceLabel(p, userCoords)
                        return dist ? <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.tealDeep, fontWeight: 700 }}><MapPin size={10} aria-hidden="true" /> {dist}</div> : null
                      })()}
                    </div>
                  </Link>
                  {(waLink || callLink) && (
                    <div style={{ display: 'flex', gap: 6, padding: '0 10px 10px', flexWrap: 'wrap' }}>
                      {waLink && (
                        <a href={waLink} target="_blank" rel="noreferrer" onClick={() => recordContactLead({ businessId: p.business_id, productId: p.id, productName: p.name, channel: 'whatsapp' })} style={{ flex: '1 1 90px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 44, padding: '8px 8px', background: '#25D366', color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 11.5, textDecoration: 'none', touchAction: 'manipulation' }}>
                          <MessageCircle size={13} aria-hidden="true" /> WhatsApp
                        </a>
                      )}
                      {callLink && (
                        <a href={callLink} onClick={() => recordContactLead({ businessId: p.business_id, productId: p.id, productName: p.name, channel: 'call' })} style={{ flex: '1 1 90px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 44, padding: '8px 8px', background: theme.tealDeep, color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 11.5, textDecoration: 'none', touchAction: 'manipulation' }}>
                          <Phone size={13} aria-hidden="true" /> Call
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            </div>
          </>
        )}

        {!loading && tab === 'businesses' && businesses.length > 0 && (
          <div role="tabpanel" id="marketplace-panel-businesses" aria-labelledby="marketplace-tab-businesses" style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 8 : 10 }}>
            {businesses.map((b, idx) => {
              const isBookable = !!b.booking_enabled
              const handleBook = () => {
                if (isBookable) {
                  navigate(`/business/${b.id}#booking`)
                } else {
                  toast.show('This healthcare facility is not accepting appointments at the moment.')
                  try {
                    const key = `booking_interest_${b.id}`
                    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key)) return
                    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, '1')
                    fetch('/api/booking-interest', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ business_id: b.id }),
                    }).catch(() => {})
                  } catch (e) {}
                }
              }
              return (
                <div key={b.id} className="mm-card" style={{ padding: 12, border: `1px solid ${theme.border}`, borderRadius: 14, background: theme.cardBg }}>
                  <Link to={`/business/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12 }}>
                    <div style={{ width: 46, height: 46, borderRadius: 10, background: b.cover_url ? `url(${b.cover_url})` : theme.navy, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, flexShrink: 0 }}>
                      {!b.cover_url && (b.name?.[0]?.toUpperCase() || <Building2 size={20} aria-hidden="true" />)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 2px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>{b.name}</p>
                      <p style={{ margin: 0, fontSize: 12, color: theme.textLight, textTransform: 'capitalize' }}>{b.business_type} · {b.city}{b.state ? `, ${b.state}` : ''}</p>
                      {(() => {
                        const bc = businessCoords(b)
                        const dist = (bc && userCoords) ? formatDistance(haversineMeters(bc.lat, bc.lng, userCoords.lat, userCoords.lng)) : null
                        return dist ? <p style={{ margin: '3px 0 0 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.textMid, fontWeight: 600 }}><MapPin size={11} aria-hidden="true" /> {dist}</p> : null
                      })()}
                      <p style={{ margin: '3px 0 0 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.tealDeep, fontWeight: 700 }}><Star size={11} aria-hidden="true" /> See profile &amp; reviews <ChevronRight size={11} aria-hidden="true" /></p>
                    </div>
                  </Link>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <Link to={`/business/${b.id}`} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '9px 12px', background: '#fff', color: theme.tealDeep, border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 800, fontSize: 13, textDecoration: 'none', boxSizing: 'border-box' }}>View Profile</Link>
                    <button onClick={handleBook} aria-label={isBookable ? 'Book Appointment' : 'Book Appointment unavailable'} aria-disabled={!isBookable} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '9px 12px', background: isBookable ? theme.tealDeep : '#e2e8f0', color: isBookable ? '#fff' : theme.textLight, border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: isBookable ? 1 : 0.9, boxSizing: 'border-box' }}>Book Appointment</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!loading && tab === 'professionals' && professionals.length > 0 && (
          <div role="tabpanel" id="marketplace-panel-professionals" aria-labelledby="marketplace-tab-professionals" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {professionals.map((pr) => (
              <Link key={pr.id} to={`/u/${pr.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12, padding: 12, border: `1px solid ${theme.border}`, borderRadius: 14, background: theme.cardBg, alignItems: 'center' }}>
                <StoryAvatar userId={pr.id} stories={proStories} viewedIds={proViewed} size={44} src={pr.avatar_url} name={pr.full_name || pr.display_name} onClick={async (e) => { e.preventDefault(); const { data } = await supabase.from('stories').select('id, title, body, image_url, bg_color, created_at, user_id, view_count, is_platform, expires_at').eq('user_id', pr.id).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }); if (data?.length) setStoryViewer({ stories: data, index: 0, userId: pr.id }) }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 2px 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 800, color: theme.navy }}>{pr.full_name || pr.display_name}<BadgeCheck size={14} color={theme.tealDeep} aria-label="Verified" /></p>
                  <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>{pr.verification_label || pr.specialty}{pr.location ? ` · ${pr.location}` : ''}</p>
                </div>
              </Link>
            ))}
          </div>
        )}

        {!loading && tab === 'businesses' && bizHasMore && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 4px' }}>
            <button onClick={loadMoreBusinesses} style={{ minHeight: 44, padding: '0 24px', border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, background: '#fff', color: theme.tealDeep, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>Load more facilities</button>
          </div>
        )}
      </div>

      {isMobile && <BottomNav />}
      <Toast msg={toast.msg} />
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs}>
      {bodyContent}
    </AppShell>
  )
}

export default Search
