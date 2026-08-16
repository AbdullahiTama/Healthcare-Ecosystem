import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import {
  BadgeCheck, Building2, ChevronRight, MapPin, MessageCircle, Phone, Pill as PillIcon,
  SearchX, ShoppingBag, Sparkles, Star, Stethoscope,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import { useGeolocation } from '../../hooks/useGeolocation'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { Card, Pill, Avatar, CardSkeleton, Empty, Toast, useToast } from '../../components/ui'
import { canShowPrice, distanceLabel, formatDistance, SALE_TYPE_LABELS, productCoords, businessCoords, haversineMeters, whatsappLink, telLink } from '../utils/marketplace.js'
import { attachOwnerProfiles, sellerName, sellerContact, sellerPhone } from '../utils/sellerLookup.js'

// Nigerian states offered as autocomplete suggestions. The location filter
// itself is a free-text field so it works globally (any city, region or
// country), per the "global location filter" requirement.
const NG_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta',
  'Ebonyi','Edo','Ekiti','Enugu','FCT - Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina',
  'Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers',
  'Sokoto','Taraba','Yobe','Zamfara',
]

const SALE_FILTERS = [
  { key: '', label: 'All' },
  { key: 'retail', label: 'Retail' },
  { key: 'wholesale', label: 'Wholesale' },
  { key: 'distributor', label: 'Distributor' },
]

function Search() {
  const { user } = useAuth()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const { coords: userCoords } = useGeolocation()

// Distance in meters between a product (or its business) and a user location;
// Infinity when either side has no coordinates so unknowns sort last.
const distanceMeters = (p, u) => {
  const c = productCoords(p)
  if (!c || !u) return Infinity
  const d = haversineMeters(c.lat, c.lng, u.lat, u.lng)
  return d == null ? Infinity : d
}
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('products')
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
  const [featuredType, setFeaturedType] = useState('promo') // 'promo' or 'product'
  const trackRef = useRef(null)
  const toast = useToast()

  // JS-driven marquee â€” works even in iOS Low Power Mode (CSS animations get paused, JS doesn't)
  useEffect(() => {
    if (featured.length === 0) return
    let raf
    let offset = 0
    const speed = 0.4 // px per frame
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
    // Fallback: auto-pull products if no active promotions
    const { data: prods } = await supabase
      .from('products')
      .select('id, name, emoji, price, show_price, latitude, longitude, business_id, list_on_carefind, businesses(name, latitude, longitude, lat, lng, show_prices)')
      .order('created_at', { ascending: false })
      .limit(14)
    setFeatured((prods || []).filter(p => p.list_on_carefind !== false))
    setFeaturedType('product')
  }

  // Health-facility query builder: one shape shared by the initial search and
  // the "load more" pager so the two can never drift apart. Eligibility is the
  // platform rule, applied server-side: the business must have been approved
  // (status 'active' â€” registration starts 'pending', admin suspension makes
  // it 'suspended') and must be publicly listed (visible_on_carefind). A
  // pending or suspended business must not appear in the public directory
  // even though registration sets visible_on_carefind optimistically.
  const businessesQuery = (q, st) => {
    let bq = supabase.from('businesses').select('id, name, business_type, city, state, cover_url, whatsapp, phone, latitude, longitude, lat, lng')
      .eq('visible_on_carefind', true)
      .eq('status', 'active')
    // A facility query is usually a name, a kind ("pharmacy", "lab"), or a
    // place ("lagos", "abuja") â€” match all of them server-side. Matching only
    // `name` made real queries like "clinic in Abuja" return zero results.
    if (q) bq = bq.or(`name.ilike.%${q}%,business_type.ilike.%${q}%,city.ilike.%${q}%,state.ilike.%${q}%`)
    if (st) bq = bq.ilike('state', `%${st}%`)
    return bq
  }

  async function loadMoreBusinesses() {
    const offset = businesses.length
    const { data } = await businessesQuery(query.trim(), stateFilter).range(offset, offset + 39)
    let merged = [...businesses, ...(data || [])]
    // "Near me" must keep the whole merged list nearest-first, not just the
    // first page â€” otherwise page 2+ appends break the ordering.
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
    setLoading(true)
    const q = query.trim()
    let resultCount = 0

    if (tab === 'products') {
      let pq = supabase.from('products').select('id, name, emoji, price, show_price, category, generic_name, whatsapp, image_url, sale_type, price_unit, min_purchase, seller_location, latitude, longitude, business_id, owner_id, list_on_carefind, created_at, businesses(name, city, state, whatsapp, phone, latitude, longitude, lat, lng, show_prices)')
      if (q) pq = pq.or(`name.ilike.%${q}%,generic_name.ilike.%${q}%,category.ilike.%${q}%`)
      // The sale-type (Retail/Wholesale/Distributor) filter must run server-side,
      // before limit(), not on the fetched batch: the products table holds many
      // legacy rows whose sale_type is null, and a client-side filter over a
      // small unordered batch of them silently emptied the tagged tabs.
      if (saleTypeFilter) pq = pq.eq('sale_type', saleTypeFilter)
      // Newest first, so the most recent (always sale_type-tagged) listings
      // surface deterministically ahead of untagged legacy inventory.
      pq = pq.order('created_at', { ascending: false }).limit(100)
      const { data } = await pq
      let list = (data || []).filter(p => p.list_on_carefind !== false)
      if (stateFilter) list = list.filter(p => (p.seller_location || p.businesses?.state || p.businesses?.city || '').toLowerCase().includes(stateFilter.toLowerCase()))
      // Resolve standalone sellers' profiles so every card can show a name,
      // a profile link and a contact â€” not just business-attached products.
      list = await attachOwnerProfiles(list)
      // Nearest first: sort by raw distance in meters so mixed m/km distances order correctly
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
      // Nearest first when the user asked for "Near me" and we have their
      // location â€” businesses without coordinates sort to the end.
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
      let pf = supabase.from('profiles').select('id, full_name, display_name, verification_label, specialty, location, is_verified').eq('is_verified', true)
      if (q) pf = pf.or(`full_name.ilike.%${q}%,display_name.ilike.%${q}%`)
      if (specialtyFilter.trim()) pf = pf.ilike('specialty', `%${specialtyFilter}%`)
      if (stateFilter) pf = pf.ilike('location', `%${stateFilter}%`)
      const { data } = await pf.limit(40)
      setProfessionals(data || [])
      setProducts([]); setBusinesses([])
      resultCount = (data || []).length
    }

    setLoading(false)

    // Log the search (query + category + user + whether anything was found)
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

  const CATEGORY_TABS = [
    { key: 'products', label: 'Products', Icon: PillIcon },
    { key: 'businesses', label: 'Health Facilities', Icon: Building2 },
    { key: 'professionals', label: 'Professionals', Icon: Stethoscope },
  ]

  const bodyContent = (
    <div style={isMobile ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))' } : { fontFamily: theme.fontFamily }}>
      <style>{`
        @keyframes medmarket-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .mm-track { display: flex; gap: 12px; width: max-content; will-change: transform; }
        .mm-card { transition: transform 0.12s ease; }
        .mm-card:active { transform: scale(0.96); }
      `}</style>

      <div style={{
        background: theme.heroGradient, color: '#fff',
        ...(isMobile
          ? { padding: '26px 18px 24px', borderRadius: '0 0 28px 28px' }
          : { padding: '28px 32px', borderRadius: theme.radius.xl, marginBottom: 20 }),
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <ShoppingBag size={24} aria-hidden="true" />
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 900, letterSpacing: '-0.02em' }}>MedMarket</h1>
        </div>
        <p style={{ margin: '0 0 16px 0', fontSize: 13.5, color: 'rgba(255,255,255,0.72)', lineHeight: 1.45, maxWidth: isMobile ? undefined : 640 }}>
          Your health marketplace: find medications, trusted health facilities, hospitals, clinics, skincare brands, wellness products, laboratories and verified health professionals near you, all in one place.
        </p>
        <form onSubmit={runSearch}>
          <div style={{ display: 'flex', gap: 8, maxWidth: isMobile ? undefined : 520 }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search medication, facility, doctorâ€¦" aria-label="Search medication, facility, doctor" style={{ flex: 1, minHeight: 44, padding: 13, fontSize: 14, border: 'none', borderRadius: theme.radius.md, boxSizing: 'border-box', fontFamily: theme.fontFamily }} />
            <button type="submit" style={{ minHeight: 44, padding: '0 20px', background: '#fff', color: theme.tealDeep, border: 'none', borderRadius: theme.radius.md, fontWeight: 800, fontSize: 14, cursor: 'pointer', boxSizing: 'border-box', WebkitTapHighlightColor: 'transparent', transition: `transform ${theme.motion.fast} ${theme.motion.easeOut}` }}
              onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.94)' }}
              onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
            >Go</button>
          </div>
        </form>
      </div>

      {/* Filter toolbar: mobile stacks category grid above a filter row;
          laptop+ has the horizontal room to put category tabs and location/
          specialty filters on one row (RESPONSIVENESS.md: "Filters: persistent
          sidebar, inline row, or a bottom sheet" â€” inline row is the desktop-
          appropriate choice once there's width for it). */}
      <div style={isMobile ? {} : { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 6, flexWrap: 'wrap' }}>
        <div style={isMobile
          ? { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '14px 16px 6px' }
          : { display: 'flex', gap: 8 }}>
          {CATEGORY_TABS.map((c) => (
            <button key={c.key} onClick={() => setTab(c.key)} style={isMobile ? {
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '12px 4px',
              borderRadius: 14, border: tab === c.key ? `2px solid ${theme.tealDeep}` : `1px solid ${theme.border}`,
              background: tab === c.key ? theme.tealMist : theme.cardBg, cursor: 'pointer',
            } : {
              display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', minHeight: 44,
              borderRadius: theme.radius.md, border: tab === c.key ? `2px solid ${theme.tealDeep}` : `1px solid ${theme.border}`,
              background: tab === c.key ? theme.tealMist : theme.cardBg, cursor: 'pointer',
            }}>
              <c.Icon size={isMobile ? 22 : 17} color={tab === c.key ? theme.tealDeep : theme.gray500} aria-hidden="true" />
              <span style={{ fontSize: isMobile ? 11 : 13, fontWeight: 700, color: theme.navy }}>{c.label}</span>
            </button>
          ))}
        </div>

        <div style={isMobile ? { padding: '4px 16px 0' } : { display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              placeholder={tab === 'professionals' ? 'Location (any city or country)' : 'Location (any city or state)'}
              aria-label="Filter by location"
              list="carefind-locations"
              style={{ flex: 1, minWidth: isMobile ? undefined : 220, minHeight: 44, padding: 11, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, boxSizing: 'border-box' }}
            />
            <datalist id="carefind-locations">
              {NG_STATES.map(s => <option key={s} value={s} />)}
            </datalist>
            {tab === 'products' && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {SALE_FILTERS.map(f => (
                  <button key={f.key || 'all'} onClick={() => setSaleTypeFilter(f.key)} style={{ padding: '9px 12px', minHeight: 44, borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', background: saleTypeFilter === f.key ? theme.tealDeep : theme.bg, color: saleTypeFilter === f.key ? '#fff' : theme.textMid }}>{f.label}</button>
                ))}
                <button onClick={() => setNearMe(!nearMe)} disabled={!userCoords} title={userCoords ? 'Sort by distance from you' : 'Allow location to sort by distance'} style={{ padding: '9px 12px', minHeight: 44, borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5, background: nearMe ? theme.tealDeep : theme.bg, color: nearMe ? '#fff' : (userCoords ? theme.textMid : theme.gray300) }}>
                  <MapPin size={13} aria-hidden="true" /> {nearMe ? 'Nearest first' : 'Near me'}
                </button>
              </div>
            )}
            {tab === 'professionals' && (
              <input value={specialtyFilter} onChange={(e) => setSpecialtyFilter(e.target.value)} placeholder="Specialty" style={{ flex: 1, minWidth: isMobile ? undefined : 160, minHeight: 44, padding: 11, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, boxSizing: 'border-box' }} />
            )}
          </div>
          {stateFilter && (
            <button onClick={() => setStateFilter('')} style={{ marginTop: isMobile ? 6 : 0, minHeight: 44, padding: '4px 14px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 10, fontSize: 11, color: theme.textLight, whiteSpace: 'nowrap' }}>Clear location</button>
          )}
        </div>
      </div>

      {showingFeatured && featured.length > 0 && (
        <div style={{ padding: '14px 0 4px' }}>
          <p style={{ margin: '0 0 10px 16px', fontSize: 12, fontWeight: 900, color: theme.navy }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Sparkles size={14} color={theme.tealDeep} aria-hidden="true" /> {featuredType === 'promo' ? 'Featured promotions' : 'Featured on MedMarket'}</span></p>
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
                        ?                       <p style={{ margin: '0 0 2px 0', fontSize: 12, fontWeight: 700, color: theme.tealDeep }}>â‚¦{Number(p.price).toLocaleString()}</p>
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

      <div style={isMobile ? { padding: '14px 16px 0' } : { padding: '14px 0 0' }}>
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

        {/* Laptop+: multi-column result grid â€” RESPONSIVENESS.md calls this out
            explicitly as a desktop-appropriate expansion once there's width for
            it. auto-fill/minmax (the GRID_SYSTEM.md card-grid pattern) rather
            than a fixed column count, since result counts vary a lot by query. */}
        <div style={isMobile ? {} : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '0 12px' }}>
        {products.map((p, idx) => {
          // WhatsApp: product's own number, else the business's number (CareHub
          // inventory), else the owner profile's phone (standalone CareFind seller).
          const waLink = whatsappLink(sellerContact(p), `Hi, I'm interested in "${p.name}" on CareFind.`)
          const callLink = telLink(sellerPhone(p))
          return (
            <Card key={p.id} className="mm-card" style={{ animationDelay: `${Math.min(idx * 0.04, 0.4)}s`, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {p.image_url
                  ? <div style={{ width: 46, height: 46, borderRadius: 10, background: `url(${p.image_url}) center/cover`, flexShrink: 0 }} />
                  : <div style={{
                      width: 46, height: 46, borderRadius: theme.radius.md, flexShrink: 0,
                      background: theme.tealMist, color: theme.tealDeep,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}><PillIcon size={22} aria-hidden="true" /></div>}
                <div style={{ flex: 1 }}>
                  <Link to={`/drug/${encodeURIComponent(p.name)}`} style={{ textDecoration: 'none' }}>
                    <p style={{ margin: '0 0 2px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>{p.name}{p.category && <Pill label={p.category} type="teal" style={{ fontSize: 9, padding: '1px 6px', marginLeft: 6 }} />}</p>
                    {p.generic_name && <p style={{ margin: '0 0 2px 0', fontSize: 11.5, color: theme.textMid, fontStyle: 'italic' }}>{p.generic_name}</p>}
                    <p style={{ margin: '0 0 3px 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.tealDeep, fontWeight: 700 }}>
                      <Star size={11} aria-hidden="true" /> See reviews <ChevronRight size={11} aria-hidden="true" />
                    </p>
                  </Link>
                  {p.business_id ? (
                    <Link to={`/business/${p.business_id}`} style={{ margin: 0, fontSize: 12, color: theme.tealDeep, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      {sellerName(p)}
                      {(() => {
                        const loc = p.seller_location || p.businesses?.state || p.businesses?.city
                        return loc ? <span style={{ color: theme.gray400, fontWeight: 400 }}> Â· {loc}</span> : null
                      })()}
                      <ChevronRight size={12} aria-hidden="true" />
                    </Link>
                  ) : p.owner_id ? (
                    <Link to={`/u/${p.owner_id}`} style={{ margin: 0, fontSize: 12, color: theme.tealDeep, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      {sellerName(p)}
                      {(() => {
                        const loc = p.seller_location
                        return loc ? <span style={{ color: theme.gray400, fontWeight: 400 }}> Â· {loc}</span> : null
                      })()}
                      <ChevronRight size={12} aria-hidden="true" />
                    </Link>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>
                      {(() => {
                        const loc = p.seller_location
                        return loc ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} aria-hidden="true" /> {loc}</span> : null
                      })()}
                    </p>
                  )}
                </div>
                {(() => {
                  const dist = distanceLabel(p, userCoords)
                  return dist ? (
                    <p style={{ margin: '0 0 3px 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.textMid, fontWeight: 600 }}>
                      <MapPin size={11} aria-hidden="true" /> {dist}
                    </p>
                  ) : null
                })()}
                {canShowPrice(p) ? (
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: theme.tealDeep }}>â‚¦{Number(p.price).toLocaleString()}</p>
                    {p.price_unit && <p style={{ margin: 0, fontSize: 9.5, color: theme.textLight }}>per {p.price_unit}</p>}
                  </div>
                ) : (
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: theme.textLight }}>Ask for price</p>
                  </div>
                )}
              </div>
              {(p.sale_type || p.min_purchase) && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {p.sale_type && <Pill label={SALE_TYPE_LABELS[p.sale_type] || p.sale_type} type={p.sale_type === 'retail' ? 'teal' : 'purple'} style={{ fontSize: 9.5, textTransform: 'uppercase' }} />}
                  {p.min_purchase && <Pill label={`Min ${p.min_purchase} ${p.price_unit || ''}${p.min_purchase > 1 ? 's' : ''}`} type="gray" style={{ fontSize: 9.5 }} />}
                </div>
              )}
              {(waLink || callLink) && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {waLink && (
                    <a href={waLink} target="_blank" rel="noreferrer" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '9px 12px', background: '#25D366', color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 13, textDecoration: 'none', boxSizing: 'border-box' }}>
                      <MessageCircle size={16} aria-hidden="true" /> WhatsApp
                    </a>
                  )}
                  {callLink && (
                    <a href={callLink} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '9px 12px', background: theme.tealDeep, color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 13, textDecoration: 'none', boxSizing: 'border-box' }}>
                      <Phone size={16} aria-hidden="true" /> Call
                    </a>
                  )}
                </div>
              )}
            </Card>
          )
        })}

        {businesses.map((b, idx) => {
          const bizWa = whatsappLink(b.whatsapp, `Hi, I'm interested in ${b.name} on CareFind.`)
          const bizCall = telLink(b.phone)
          return (
          <div key={b.id} className="mm-card" style={{ animationDelay: `${Math.min(idx * 0.04, 0.4)}s`, padding: 12, border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 8, background: theme.cardBg }}>
            <Link to={`/business/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12 }}>
              <div style={{ width: 46, height: 46, borderRadius: 10, background: b.cover_url ? `url(${b.cover_url})` : theme.navy, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, flexShrink: 0 }}>
                {!b.cover_url && (b.name?.[0]?.toUpperCase() || <Building2 size={20} aria-hidden="true" />)}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>{b.name}</p>
                <p style={{ margin: 0, fontSize: 12, color: theme.textLight, textTransform: 'capitalize' }}>{b.business_type} Â· {b.city}{b.state ? `, ${b.state}` : ''}</p>
                {(() => {
                  const bc = businessCoords(b)
                  const dist = (bc && userCoords)
                    ? formatDistance(haversineMeters(bc.lat, bc.lng, userCoords.lat, userCoords.lng))
                    : null
                  return dist ? (
                    <p style={{ margin: '3px 0 0 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.textMid, fontWeight: 600 }}>
                      <MapPin size={11} aria-hidden="true" /> {dist}
                    </p>
                  ) : null
                })()}
                <p style={{ margin: '3px 0 0 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.tealDeep, fontWeight: 700 }}>
                  <Star size={11} aria-hidden="true" /> See profile &amp; reviews <ChevronRight size={11} aria-hidden="true" />
                </p>
              </div>
            </Link>
            {(bizWa || bizCall) && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                {bizWa && (
                  <a href={bizWa} target="_blank" rel="noreferrer" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '9px 12px', background: '#25D366', color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 13, textDecoration: 'none', boxSizing: 'border-box' }}>
                    <MessageCircle size={16} aria-hidden="true" /> WhatsApp
                  </a>
                )}
                {bizCall && (
                  <a href={bizCall} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '9px 12px', background: theme.tealDeep, color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 13, textDecoration: 'none', boxSizing: 'border-box' }}>
                    <Phone size={16} aria-hidden="true" /> Call
                  </a>
                )}
              </div>
            )}
          </div>
          )
        })}

        {professionals.map((pr, idx) => (
          <Link key={pr.id} className="mm-card" to={`/u/${pr.id}`} style={{ animationDelay: `${Math.min(idx * 0.04, 0.4)}s`, textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12, padding: 12, border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 8, background: theme.cardBg, alignItems: 'center' }}>
            <Avatar name={pr.full_name || pr.display_name} size={44} />
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 2px 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 800, color: theme.navy }}>
                {pr.full_name || pr.display_name}
                <BadgeCheck size={14} color={theme.tealDeep} aria-label="Verified" />
              </p>
              <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>{pr.verification_label || pr.specialty}{pr.location ? ` Â· ${pr.location}` : ''}</p>
            </div>
          </Link>
        ))}
        </div>

        {!loading && tab === 'businesses' && bizHasMore && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 4px' }}>
            <button onClick={loadMoreBusinesses} style={{ minHeight: 44, padding: '0 24px', border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, background: '#fff', color: theme.tealDeep, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
              Load more facilities
            </button>
          </div>
        )}
      </div>

      {isMobile && <BottomNav />}
      <Toast msg={toast.msg} />
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell
      user={user}
      myUsername={myUsername}
      myAvatar={myAvatar}
      unreadNotifs={unreadNotifs}
      onCompose={() => navigate('/feed')}
    >
      {bodyContent}
    </AppShell>
  )
}

export default Search
