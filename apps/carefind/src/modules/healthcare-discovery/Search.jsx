import { useEffect, useState, useRef, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import Shop from '../shop/Shop'
import ShopHero from '../shop/ShopHero.jsx'
import { useAuth } from '../../providers/AuthContext'
import {
  BadgeCheck, ChevronRight, MapPin, Pill as PillIcon, Search as SearchIcon, SearchX, ShoppingBag,
  Sparkles, Star, Stethoscope,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import { useGeolocation } from '../../hooks/useGeolocation'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { Avatar, Card, Empty, Toast, useToast } from '../../components/ui'
import StoryAvatar from '../../components/StoryAvatar.jsx'
import StoryViewer from '../social-feed/components/StoryViewer.jsx'
import { markStoriesViewed } from '../social-feed/storyViews.js'
import { canShowPrice, SALE_TYPE_LABELS, productCoords, businessCoords, haversineMeters, formatDistance, distanceLabel } from '../utils/marketplace.js'
import { recordContactLead } from '../utils/contactLeads.js'
import MarketplaceTabs from '../marketplace/MarketplaceTabs.jsx'
import Logo from '../social-feed/Logo.jsx'
import { useCart } from '../shop/CartProvider'
import FilterSheet from '../../components/FilterSheet.jsx'
import FilterFAB from '../../components/FilterFAB.jsx'
import ProductGrid from '../marketplace/ProductGrid.jsx'
import ProductResultCard from './components/ProductResultCard.jsx'
import FacilityCard from './components/FacilityCard.jsx'
import { useFeatured, useSearchResults } from '../../hooks/queries'
import { healthcareRepository } from './repositories'
import { replaceUrlParams } from '../../utils/urlParams.js'

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
  const [searchParams] = useSearchParams()
  // Seed both the input and the executed query from ?q= so a search is
  // linkable and bookmarkable — the marketing landing page's category tiles
  // deep-link here (/search?tab=businesses&q=pharmacy), and a shared URL now
  // reproduces the same result set instead of an empty page. `q` is a text
  // match: healthcareRepository.searchBusinesses already ilike-matches it
  // against name, business_type, city and state.
  const [query, setQuery] = useState(() => searchParams.get('q') || '')
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
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
  // The Shop tab fetches its own catalogue (useSearchResults is disabled for it), so its categories come from Shop.
  const [shopCategories, setShopCategories] = useState(['all'])

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

  // Distance label for a facility row, resolved from the user's geolocation
  // when both coordinates exist. Passed to <FacilityCard> so the card itself
  // stays free of geolocation concerns.
  const facilityDistance = useCallback((b) => {
    const bc = businessCoords(b)
    if (!bc || !userCoords) return null
    return formatDistance(haversineMeters(bc.lat, bc.lng, userCoords.lat, userCoords.lng))
  }, [userCoords])

  // Booking from a result row: bookable facilities jump to the booking card on
  // their profile; the rest register booking interest once per session so the
  // business is told someone tried to book.
  const handleBook = useCallback((b) => {
    if (b.booking_enabled) {
      navigate(`/business/${b.id}#booking`)
      return
    }
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
    } catch (e) { /* storage unavailable — interest signal is best-effort */ }
  }, [navigate, toast])

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

  // Mirror the active tab into ?tab= so a tab is linkable and survives a reload.
  // A missing ?tab= means the default tab ('shop'), so only write when the URL
  // genuinely disagrees. Through replaceUrlParams, never setSearchParams — see
  // utils/urlParams.js: on bare /search the router version looped forever
  // (default tab, no ?tab=, "differs" every time, each replace remounted the
  // page) and wiped the typed query on every tab switch.
  useEffect(() => {
    if ((new URLSearchParams(window.location.search).get('tab') || 'shop') === tab) return
    replaceUrlParams((params) => {
      if (tab === 'shop') params.delete('tab')
      else params.set('tab', tab)
    })
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
    // Keep ?q= in the URL so the result set is shareable and survives a reload.
    replaceUrlParams((params) => {
      if (q) params.set('q', q)
      else params.delete('q')
    })
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

      {/* 2b — Shop banner (Shop tab only) */}
      {tab === 'shop' && <ShopHero />}

      {/* 3 — Search card: query + Search, then location + Filters (one row on desktop — see .cf-search-card) */}
      <div className="cf-search-card-wrap" style={{ padding: '0 0 12px', position: 'relative' }}>
        <form onSubmit={runSearch} role="search" aria-label="Marketplace search" className="cf-search-card">
          <div className="cf-search-card__q" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
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
                // No `outline: 'none'` here: an inline style outranks the
                // stylesheet, so it would suppress the global 2px teal
                // :focus-visible ring (styles/global.css:137) and leave this
                // input with no focus indicator at all. ACCESSIBILITY.md:16.
                WebkitTextSizeAdjust: '100%',
              }}
            />
          </div>

          <div className="cf-search-card__loc" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <MapPin size={16} color={theme.textMid} aria-hidden="true" style={{ position: 'absolute', left: 12, pointerEvents: 'none' }} />
            <input
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              placeholder="City or state"
              aria-label="Filter by city or state"
              list="carefind-locations"
              style={{
                width: '100%',
                minHeight: 44,
                padding: '9px 12px 9px 36px',
                fontSize: 14,
                border: `1px solid ${theme.border}`,
                borderRadius: 12,
                boxSizing: 'border-box',
                fontFamily: theme.fontFamily,
                background: '#fff',
              }}
            />
            <datalist id="carefind-locations">
              {NG_STATES.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>

          <button
            type="submit"
            aria-label="Search"
            className="cf-search-card__go"
            style={{
              minHeight: 44,
              padding: '0 22px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: theme.tealGradient,
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
            <SearchIcon size={16} aria-hidden="true" />
            Search
          </button>

          <div className="cf-search-card__filt">
            <FilterFAB onClick={() => setFilterOpen(true)} activeCount={activeFilterCount} />
          </div>
        </form>
        {/* Recent searches dropdown */}
        {showRecent && recentSearches.length > 0 && (
          <div ref={recentRef} role="listbox" aria-label="Recent searches" style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
            background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', marginTop: -8, overflow: 'hidden',
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
        {/* Loading states */}
        {loading && tab !== 'shop' && (
          <ProductGrid rows={[]} loading={true} skeletonType={tab === 'products' ? 'grid' : 'list'} variant={tab === 'products' ? 'products' : 'shop'} />
        )}

        {/* Shop tab — delegates to Shop component */}
        {!loading && tab === 'shop' && (
          <Shop
            segment={saleType}
            query={query}
            embedded
            filters={{ priceMin, priceMax, category: filterCategory, showRxOnly, inStockOnly, sort }}
            onCategoriesChange={setShopCategories}
            userCoords={userCoords}
          />
        )}

        {/* Products tab — original CareFind healthcare product cards */}
        {!loading && tab === 'products' && products.length === 0 && (query.trim() || stateFilter) && (
          <Empty icon={<SearchX size={44} color={theme.gray300} strokeWidth={1.5} />} cause="filtered" message={<><div style={{ fontSize: 14, fontWeight: 700, color: theme.navy, marginBottom: 4 }}>No products found</div><div style={{ fontSize: 12, color: theme.textMid }}>Try another name or state.</div></>} />
        )}
        {!loading && tab === 'products' && sortedProducts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sortedProducts.map((p, idx) => (
              <ProductResultCard
                key={p.id}
                product={p}
                index={idx}
                distance={distanceLabel(p, userCoords)}
                onContact={recordContactLead}
              />
            ))}
          </div>
        )}

        {/* Businesses tab */}
        {!loading && tab === 'businesses' && sortedBusinesses.length === 0 && (
          <Empty icon={<SearchX size={44} color={theme.gray300} strokeWidth={1.5} />} cause="filtered" message={<><div style={{ fontSize: 14, fontWeight: 700, color: theme.navy, marginBottom: 4 }}>No health facilities found</div><div style={{ fontSize: 12, color: theme.textMid }}>Try another state.</div></>} />
        )}
        {!loading && tab === 'businesses' && sortedBusinesses.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sortedBusinesses.map((b) => (
              <FacilityCard
                key={b.id}
                business={b}
                distance={facilityDistance(b)}
                onBook={() => handleBook(b)}
              />
            ))}
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
        categories={tab === 'shop' ? shopCategories : filterCategories}
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
