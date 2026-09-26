import { useEffect, useState, useRef, useCallback } from 'react'
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
import { Card, Pill, Avatar, Empty, Toast, useToast } from '../../components/ui'
import StoryAvatar from '../../components/StoryAvatar.jsx'
import StoryViewer from '../social-feed/components/StoryViewer.jsx'
import { markStoriesViewed } from '../social-feed/storyViews.js'
import { canShowPrice, distanceLabel, formatDistance, SALE_TYPE_LABELS, productCoords, businessCoords, haversineMeters, whatsappLink, telLink } from '../utils/marketplace.js'
import { recordContactLead } from '../utils/contactLeads.js'
import { sellerName, sellerContact, sellerPhone } from '../utils/sellerLookup.js'
import MarketplaceTabs from '../marketplace/MarketplaceTabs.jsx'
import Logo from '../social-feed/Logo.jsx'
import { useCart } from '../shop/CartProvider'
import FilterSheet from '../../components/FilterSheet.jsx'
import FilterFAB from '../../components/FilterFAB.jsx'
import ProductGrid from '../marketplace/ProductGrid.jsx'
import { useFeatured, useSearchResults } from '../../hooks/queries'
import { healthcareRepository } from './repositories'

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
  const [searchQuery, setSearchQuery] = useState('')
  const [tab, setTab] = useState(() => {
    const t = searchParams.get('tab')
    if (t && ['shop','products','businesses','professionals'].includes(t)) return t
    return 'shop'
  })
  const [stateFilter, setStateFilter] = useState('')
  const [nearMe, setNearMe] = useState(false)
  const [specialtyFilter, setSpecialtyFilter] = useState('')
  const [storyViewer, setStoryViewer] = useState(null)
  const trackRef = useRef(null)
  const toast = useToast()

  // Filter sheet state
  const [filterOpen, setFilterOpen] = useState(false)
  const [saleType, setSaleType] = useState('all')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [showRxOnly, setShowRxOnly] = useState(false)
  const [inStockOnly, setInStockOnly] = useState(true)
  const [sort, setSort] = useState('popular')

  const { data: featuredData } = useFeatured()
  const featured = featuredData?.items || []
  const featuredType = featuredData?.type || 'promo'

  const { data: searchResults, isLoading: loading, refetch } = useSearchResults({
    searchQuery, tab, stateFilter, saleType, specialtyFilter, userId: user?.id,
  })
  const products = searchResults?.products || []
  const businesses = searchResults?.businesses || []
  const professionals = searchResults?.professionals || []
  const proStories = searchResults?.proStories || []
  const proViewed = searchResults?.proViewed || new Set()
  const filterCategories = searchResults?.filterCategories || ['all']

  // Client-side near-me sort for products and businesses
  const sortedProducts = nearMe && userCoords
    ? [...products].sort((a, b) => (distanceMeters(a, userCoords) - distanceMeters(b, userCoords)))
    : products
  const sortedBusinesses = nearMe && userCoords
    ? [...businesses].sort((a, b) => {
        const da = businessCoords(a) ? haversineMeters(businessCoords(a).lat, businessCoords(a).lng, userCoords.lat, userCoords.lng) : Infinity
        const db = businessCoords(b) ? haversineMeters(businessCoords(b).lat, businessCoords(b).lng, userCoords.lat, userCoords.lng) : Infinity
        return da - db
      })
    : businesses

  // Recent searches
  const RECENT_KEY = 'carefind_recent_searches'
  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
  })
  const [showRecent, setShowRecent] = useState(false)
  const searchInputRef = useRef(null)
  const recentRef = useRef(null)

  const addRecentSearch = useCallback((term) => {
    if (!term.trim()) return
    setRecentSearches(prev => {
      const next = [term.trim(), ...prev.filter(s => s.toLowerCase() !== term.trim().toLowerCase())].slice(0, 8)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const removeRecentSearch = useCallback((term) => {
    setRecentSearches(prev => {
      const next = prev.filter(s => s !== term)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  // Close recent dropdown on outside click
  useEffect(() => {
    if (!showRecent) return
    const handler = (e) => {
      if (recentRef.current && !recentRef.current.contains(e.target) &&
          searchInputRef.current && !searchInputRef.current.contains(e.target)) {
        setShowRecent(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showRecent])

  // Featured rail scroll is CSS-only (cf-marquee-track) — no JS RAF loop.
  // Keeps the compositor on transform (GPU) and respects prefers-reduced-motion.

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

  function runSearch(e) {
    if (e) e.preventDefault()
    setShowRecent(false)
    const q = query.trim()
    if (q) addRecentSearch(q)
    setSearchQuery(q)
  }

  const activeFilterCount = [
    saleType !== 'all',
    priceMin !== '',
    priceMax !== '',
    filterCategory !== 'all',
    showRxOnly,
    !inStockOnly,
    sort !== 'popular',
  ].filter(Boolean).length

  const bodyContent = (
    <div style={isMobile ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', padding: '0 16px', paddingBottom: 'calc(100px + env(safe-area-inset-bottom))', background: theme.bg, minHeight: '100vh', overflowX: 'hidden', boxSizing: 'border-box' } : { fontFamily: theme.fontFamily }}>
      <style>{`
        .mm-card { transition: transform 140ms cubic-bezier(0.16,1,0.3,1); }
        .mm-card:active { transform: scale(0.96); }
        .hide-scrollbar::-webkit-scrollbar { display:none; height:0; }
        .hide-scrollbar { scrollbar-width:none; -ms-overflow-style:none; }
        @media (prefers-reduced-motion: reduce) {
          .mm-card { transition: none; }
          .mm-card:active { transform: none; }
        }
        @media (hover: hover) and (pointer: fine) {
          .mm-card:hover { transform: translateY(-1px); }
          .mm-card:active { transform: scale(0.96); }
        }
      `}</style>

      {/* 1 — CareFind Header */}
      {isMobile && (
        <div style={{
          background: theme.heroGradient,
          margin: '0 -16px',
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

      {/* 2 — Tab Navigation (not sticky — flows naturally) */}
      <div style={{ padding: '12px 0 8px' }}>
        <MarketplaceTabs activeTab={tab} onChange={setTab} />
      </div>

      {/* 3 — Search Bar */}
      <div style={{ padding: '0 0 12px' }}>
        <form onSubmit={runSearch} role="search" aria-label="Marketplace search" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <SearchIcon size={18} color={theme.textMid} aria-hidden="true" style={{ position: 'absolute', left: 12, pointerEvents: 'none' }} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if (recentSearches.length > 0) setShowRecent(true) }}
              placeholder="Search medication, facility, professional..."
              aria-label="Search medication, facility, professional"
              aria-expanded={showRecent && recentSearches.length > 0}
              aria-haspopup="listbox"
              style={{
                width: '100%',
                minHeight: 44,
                padding: '11px 12px 11px 38px',
                fontSize: 16,
                border: `1px solid ${theme.border}`,
                borderRadius: 12,
                boxSizing: 'border-box',
                fontFamily: theme.fontFamily,
                background: '#fff',
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
            }}
          >
            Search
          </button>
        </form>
        {/* Recent searches dropdown */}
        {showRecent && recentSearches.length > 0 && (
          <div ref={recentRef} role="listbox" aria-label="Recent searches" style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
            background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', marginTop: 4, overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px 6px', borderBottom: `1px solid ${theme.border}` }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: theme.textLight, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recent</span>
              <button onClick={() => { setRecentSearches([]); try { localStorage.removeItem(RECENT_KEY) } catch {}; setShowRecent(false) }} style={{ fontSize: 11, color: theme.danger, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Clear all</button>
            </div>
            {recentSearches.map((term, i) => (
              <div key={i} role="option" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', borderBottom: i < recentSearches.length - 1 ? `1px solid ${theme.border}` : 'none' }}
                onMouseDown={(e) => { e.preventDefault(); setQuery(term); setShowRecent(false); searchInputRef.current?.blur() }}>
                <SearchIcon size={14} color={theme.textLight} />
                <span style={{ flex: 1, fontSize: 14, color: theme.navy }}>{term}</span>
                <button onClick={(e) => { e.stopPropagation(); removeRecentSearch(term) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.textLight }} aria-label={`Remove ${term} from recent searches`}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4 — Location + Filter FAB (one row) */}
      <div style={{ padding: '0 0 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
          <MapPin size={16} color={theme.textMid} aria-hidden="true" style={{ position: 'absolute', left: 12, pointerEvents: 'none' }} />
          <input
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            placeholder="City or state"
            aria-label="Filter by city or state"
            list="carefind-locations"
            style={{
              width: '100%',
              minHeight: 40,
              padding: '9px 12px 9px 36px',
              fontSize: 13,
              border: `1px solid ${theme.border}`,
              borderRadius: 10,
              boxSizing: 'border-box',
              fontFamily: theme.fontFamily,
              background: '#fff',
            }}
          />
        </div>
        <FilterFAB onClick={() => setFilterOpen(true)} activeCount={activeFilterCount} />
        <datalist id="carefind-locations">
          {NG_STATES.map(s => <option key={s} value={s} />)}
        </datalist>
      </div>

      {/* Specialty filter — professionals tab only */}
      {tab === 'professionals' && (
        <div style={{ padding: '0 0 12px' }}>
          <input value={specialtyFilter} onChange={(e) => setSpecialtyFilter(e.target.value)} placeholder="Filter by specialty..." aria-label="Filter by specialty"
            style={{ width: '100%', minHeight: 40, padding: '9px 12px', fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 10, boxSizing: 'border-box', fontFamily: theme.fontFamily, background: '#fff' }} />
        </div>
      )}

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div style={{ padding: '0 0 12px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: theme.textMid }}>Active:</span>
          {saleType !== 'all' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 999, background: theme.tealMist, color: theme.tealDeep, fontSize: 11, fontWeight: 700 }}>
              {saleType} <button onClick={() => setSaleType('all')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: theme.tealDeep, fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          )}
          {priceMin && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 999, background: theme.tealMist, color: theme.tealDeep, fontSize: 11, fontWeight: 700 }}>
              Min ₦{priceMin} <button onClick={() => setPriceMin('')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: theme.tealDeep, fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          )}
          {priceMax && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 999, background: theme.tealMist, color: theme.tealDeep, fontSize: 11, fontWeight: 700 }}>
              Max ₦{priceMax} <button onClick={() => setPriceMax('')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: theme.tealDeep, fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          )}
          {showRxOnly && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 999, background: theme.tealMist, color: theme.tealDeep, fontSize: 11, fontWeight: 700 }}>
              Rx only <button onClick={() => setShowRxOnly(false)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: theme.tealDeep, fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          )}
          <button onClick={() => { setSaleType('all'); setPriceMin(''); setPriceMax(''); setFilterCategory('all'); setShowRxOnly(false); setInStockOnly(true); setSort('popular') }}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: theme.tealDeep, fontSize: 11, fontWeight: 700, textDecoration: 'underline' }}>
            Clear all
          </button>
        </div>
      )}

      {/* 5 — Featured/Trending Rail (products tab only, static) */}
      {tab === 'products' && !query.trim() && featured.length > 0 && (
        <div style={{ padding: '0 0 16px' }}>
          <p style={{ margin: '0 0 10px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={16} color={theme.tealDeep} aria-hidden="true" /> {featuredType === 'promo' ? 'Featured promotions' : 'Trending Now'}
            </span>
          </p>
          <div style={{ overflow: 'hidden', width: '100%', maskImage: 'linear-gradient(90deg, transparent 0%, black 4%, black 96%, transparent 100%)', WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 4%, black 96%, transparent 100%)' }}>
            <div className="cf-marquee-track" ref={trackRef} aria-hidden="true">
              {[...featured, ...featured].map((p, i) => (
                featuredType === 'promo' ? (
                  <Link key={i} className="mm-card" to={p.link_url || '/search'} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 200 }}>
                    <Card style={{ overflow: 'hidden' }}>
                      <div style={{ height: 110, background: p.image_url ? `url(${p.image_url})` : theme.navy, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'flex-start', padding: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: '#fff', background: theme.tealDeep, padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase' }}>Promo</span>
                      </div>
                      <div style={{ padding: '10px 12px 12px' }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: theme.navy, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.title}</p>
                      </div>
                    </Card>
                  </Link>
                ) : (
                  <Link key={i} className="mm-card" to={`/drug/${encodeURIComponent(p.name)}`} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 140 }}>
                    <Card style={{ padding: 12, textAlign: 'center' }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: theme.radius.md, margin: '0 auto 8px',
                        background: theme.tealMist, color: theme.tealDeep,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}><PillIcon size={22} aria-hidden="true" /></div>
                      <p style={{ margin: '0 0 3px 0', fontSize: 13, fontWeight: 700, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                      {canShowPrice(p)
                        ? <p style={{ margin: '0 0 2px 0', fontSize: 12, fontWeight: 700, color: theme.tealDeep }}>₦{Number(p.price).toLocaleString()}</p>
                        : <p style={{ margin: '0 0 2px 0', fontSize: 11, fontWeight: 700, color: theme.textMid }}>Ask for price</p>}
                      <p style={{ margin: 0, fontSize: 11, color: theme.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.businesses?.name || ''}</p>
                    </Card>
                  </Link>
                )
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6 — Marketplace Content */}
      <div style={{ paddingBottom: 16 }}>
        {/* Shop heading */}
        {tab === 'shop' && (
          <div style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: theme.navy, letterSpacing: '-0.02em' }}>Shop</h2>
            <p style={{ margin: '2px 0 0 0', fontSize: 12, color: theme.textMid }}>Health products from trusted sellers near you.</p>
          </div>
        )}

        {/* Loading states */}
        {loading && tab !== 'shop' && (
          <ProductGrid rows={[]} loading={true} skeletonType={tab === 'products' ? 'grid' : 'list'} variant={tab === 'products' ? 'products' : 'shop'} />
        )}

        {/* Shop tab — delegates to Shop component */}
        {!loading && tab === 'shop' && (
          <Shop segment={saleType} query={query} embedded />
        )}

        {/* Products tab — original CareFind healthcare product cards */}
        {!loading && tab === 'products' && products.length === 0 && (query.trim() || stateFilter) && (
          <Empty icon={<SearchX size={44} color={theme.gray300} strokeWidth={1.5} />} cause="filtered" message={<><div style={{ fontSize: 14, fontWeight: 700, color: theme.navy, marginBottom: 4 }}>No products found</div><div style={{ fontSize: 12, color: theme.textMid }}>Try another name or state.</div></>} />
        )}
        {!loading && tab === 'products' && sortedProducts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sortedProducts.map((p, idx) => {
              const waLink = whatsappLink(sellerContact(p), `Hi, I'm interested in "${p.name}" on CareFind.`)
              const callLink = telLink(sellerPhone(p))
              return (
                <Card key={p.id} className="mm-card" style={{ animationDelay: `${Math.min(idx * 0.04, 0.4)}s`, padding: 12 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    {p.image_url
                      ? <div style={{ width: 46, height: 46, borderRadius: 10, background: `url(${p.image_url}) center/cover`, flexShrink: 0 }} />
                      : <div style={{
                          width: 46, height: 46, borderRadius: 10, flexShrink: 0,
                          background: theme.tealMist, color: theme.tealDeep,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}><PillIcon size={22} aria-hidden="true" /></div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
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
                            return loc ? <span style={{ color: theme.gray400, fontWeight: 400 }}> · {loc}</span> : null
                          })()}
                          <ChevronRight size={12} aria-hidden="true" />
                        </Link>
                      ) : p.owner_id ? (
                        <Link to={`/u/${p.owner_id}`} style={{ margin: 0, fontSize: 12, color: theme.tealDeep, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          {sellerName(p)}
                          {(() => {
                            const loc = p.seller_location
                            return loc ? <span style={{ color: theme.gray400, fontWeight: 400 }}> · {loc}</span> : null
                          })()}
                          <ChevronRight size={12} aria-hidden="true" />
                        </Link>
                      ) : (
                        <p style={{ margin: 0, fontSize: 12, color: theme.textMid }}>
                          {(() => {
                            const loc = p.seller_location
                            return loc ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} aria-hidden="true" /> {loc}</span> : null
                          })()}
                        </p>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {(() => {
                        const dist = distanceLabel(p, userCoords)
                        return dist ? (
                          <p style={{ margin: '0 0 4px 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.textMid, fontWeight: 600 }}>
                            <MapPin size={11} aria-hidden="true" /> {dist}
                          </p>
                        ) : null
                      })()}
                      {canShowPrice(p) ? (
                        <>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: theme.tealDeep }}>₦{Number(p.price).toLocaleString()}</p>
                          {p.price_unit && <p style={{ margin: 0, fontSize: 9.5, color: theme.textMid }}>per {p.price_unit}</p>}
                        </>
                      ) : (
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: theme.textMid }}>Ask for price</p>
                      )}
                    </div>
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
                        <a href={waLink} target="_blank" rel="noreferrer" onClick={() => recordContactLead({ businessId: p.business_id, productId: p.id, productName: p.name, channel: 'whatsapp' })} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '9px 12px', background: '#25D366', color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 13, textDecoration: 'none', boxSizing: 'border-box' }}>
                          <MessageCircle size={16} aria-hidden="true" /> WhatsApp
                        </a>
                      )}
                      {callLink && (
                        <a href={callLink} onClick={() => recordContactLead({ businessId: p.business_id, productId: p.id, productName: p.name, channel: 'call' })} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '9px 12px', background: theme.tealDeep, color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 13, textDecoration: 'none', boxSizing: 'border-box' }}>
                          <Phone size={16} aria-hidden="true" /> Call
                        </a>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}

        {/* Businesses tab */}
        {!loading && tab === 'businesses' && sortedBusinesses.length === 0 && (
          <Empty icon={<SearchX size={44} color={theme.gray300} strokeWidth={1.5} />} cause="filtered" message={<><div style={{ fontSize: 14, fontWeight: 700, color: theme.navy, marginBottom: 4 }}>No health facilities found</div><div style={{ fontSize: 12, color: theme.textMid }}>Try another state.</div></>} />
        )}
        {!loading && tab === 'businesses' && sortedBusinesses.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sortedBusinesses.map((b) => {
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
                <div key={b.id} style={{ padding: 16, border: `1px solid ${theme.border}`, borderRadius: 14, background: '#fff' }}>
                  <Link to={`/business/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: b.cover_url ? `url(${b.cover_url})` : theme.navy, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, flexShrink: 0 }}>
                      {!b.cover_url && (b.name?.[0]?.toUpperCase() || <Building2 size={20} aria-hidden="true" />)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 2px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>{b.name}</p>
                      <p style={{ margin: 0, fontSize: 13, color: theme.textMid, textTransform: 'capitalize' }}>{b.business_type} · {b.city}{b.state ? `, ${b.state}` : ''}</p>
                      {(() => {
                        const bc = businessCoords(b)
                        const dist = (bc && userCoords) ? formatDistance(haversineMeters(bc.lat, bc.lng, userCoords.lat, userCoords.lng)) : null
                        return dist ? <p style={{ margin: '3px 0 0 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: theme.tealDeep, fontWeight: 600 }}><MapPin size={11} aria-hidden="true" /> {dist}</p> : null
                      })()}
                    </div>
                  </Link>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <Link to={`/business/${b.id}`} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '9px 12px', background: '#fff', color: theme.tealDeep, border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 700, fontSize: 13, textDecoration: 'none', boxSizing: 'border-box' }}>View Profile</Link>
                    <button onClick={handleBook} aria-label={isBookable ? 'Book Appointment' : 'Book Appointment unavailable'} aria-disabled={!isBookable} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '9px 12px', background: isBookable ? theme.tealDeep : '#e2e8f0', color: isBookable ? '#fff' : theme.textMid, border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: isBookable ? 1 : 0.9, boxSizing: 'border-box' }}>Book Appointment</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Professionals tab */}
        {!loading && tab === 'professionals' && professionals.length === 0 && (
          <Empty icon={<SearchX size={44} color={theme.gray300} strokeWidth={1.5} />} cause="filtered" message={<><div style={{ fontSize: 14, fontWeight: 700, color: theme.navy, marginBottom: 4 }}>No professionals found</div><div style={{ fontSize: 12, color: theme.textMid }}>Try another specialty or state.</div></>} />
        )}
        {!loading && tab === 'professionals' && professionals.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {professionals.map((pr) => (
              <Link key={pr.id} to={`/u/${pr.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12, padding: 16, border: `1px solid ${theme.border}`, borderRadius: 14, background: '#fff', alignItems: 'center' }}>
                <StoryAvatar userId={pr.id} stories={proStories} viewedIds={proViewed} size={48} src={pr.avatar_url} name={pr.full_name || pr.display_name} onClick={async (e) => { e.preventDefault(); const data = await healthcareRepository.getStoriesByUser(pr.id); if (data?.length) setStoryViewer({ stories: data, index: 0, userId: pr.id }) }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 2px 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 15, fontWeight: 800, color: theme.navy }}>{pr.full_name || pr.display_name}<BadgeCheck size={14} color={theme.tealDeep} aria-label="Verified" /></p>
                  <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>{pr.verification_label || pr.specialty}{pr.location ? ` · ${pr.location}` : ''}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {isMobile && <BottomNav />}
      <Toast msg={toast.msg} />

      {/* Filter Bottom Sheet */}
      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        saleType={saleType}
        onSaleTypeChange={setSaleType}
        priceMin={priceMin}
        onPriceMinChange={setPriceMin}
        priceMax={priceMax}
        onPriceMaxChange={setPriceMax}
        category={filterCategory}
        onCategoryChange={setFilterCategory}
        categories={filterCategories}
        showRxOnly={showRxOnly}
        onShowRxOnlyChange={setShowRxOnly}
        inStockOnly={inStockOnly}
        onInStockOnlyChange={setInStockOnly}
        sort={sort}
        onSortChange={setSort}
        onClear={() => { setSaleType('all'); setPriceMin(''); setPriceMax(''); setFilterCategory('all'); setShowRxOnly(false); setInStockOnly(true); setSort('popular') }}
      />
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
