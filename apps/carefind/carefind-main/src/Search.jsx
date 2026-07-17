import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'

const NG_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta',
  'Ebonyi','Edo','Ekiti','Enugu','FCT - Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina',
  'Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers',
  'Sokoto','Taraba','Yobe','Zamfara',
]

function Search() {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('products')
  const [stateFilter, setStateFilter] = useState('')
  const [specialtyFilter, setSpecialtyFilter] = useState('')
  const [businesses, setBusinesses] = useState([])
  const [products, setProducts] = useState([])
  const [professionals, setProfessionals] = useState([])
  const [loading, setLoading] = useState(false)
  const [featured, setFeatured] = useState([])
  const [featuredType, setFeaturedType] = useState('promo') // 'promo' or 'product'
  const trackRef = useRef(null)

  // JS-driven marquee — works even in iOS Low Power Mode (CSS animations get paused, JS doesn't)
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
  useEffect(() => { runSearch() }, [tab, stateFilter, specialtyFilter])

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
      .select('id, name, emoji, price, business_id, list_on_carefind, businesses(name)')
      .order('created_at', { ascending: false })
      .limit(14)
    setFeatured((prods || []).filter(p => p.list_on_carefind !== false))
    setFeaturedType('product')
  }

  async function runSearch(e) {
    if (e) e.preventDefault()
    setLoading(true)
    const q = query.trim()
    let resultCount = 0

    if (tab === 'products') {
      let pq = supabase.from('products').select('id, name, emoji, price, category, generic_name, whatsapp, image_url, sale_type, price_unit, min_purchase, seller_location, business_id, list_on_carefind, businesses(name, city, state, whatsapp)')
      if (q) pq = pq.or(`name.ilike.%${q}%,generic_name.ilike.%${q}%,category.ilike.%${q}%`)
      const { data } = await pq.limit(40)
      let list = (data || []).filter(p => p.list_on_carefind !== false)
      if (stateFilter) list = list.filter(p => (p.businesses?.state || '').toLowerCase().includes(stateFilter.toLowerCase()))
      setProducts(list)
      setBusinesses([]); setProfessionals([])
      resultCount = list.length
    }
    else if (tab === 'businesses') {
      let bq = supabase.from('businesses').select('id, name, business_type, city, state, cover_url, whatsapp').eq('visible_on_carefind', true)
      if (q) bq = bq.ilike('name', `%${q}%`)
      if (stateFilter) bq = bq.ilike('state', `%${stateFilter}%`)
      const { data } = await bq.limit(40)
      setBusinesses(data || [])
      setProducts([]); setProfessionals([])
      resultCount = (data || []).length
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
      if (logErr) alert('Search log failed: ' + logErr.message)
    }
  }

  const showingFeatured = tab === 'products' && !query.trim()

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
      <style>{`
        @keyframes medmarket-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .mm-track { display: flex; gap: 12px; width: max-content; will-change: transform; }
        .mm-card { transition: transform 0.12s ease; }
        .mm-card:active { transform: scale(0.96); }
      `}</style>

      <div style={{ background: theme.heroGradient, padding: '24px 18px 22px', borderRadius: '0 0 26px 26px', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 24 }}>🛒</span>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 900, letterSpacing: '-0.02em' }}>MedMarket</h1>
        </div>
        <p style={{ margin: '0 0 16px 0', fontSize: 13.5, color: 'rgba(255,255,255,0.72)', lineHeight: 1.45 }}>
          Your health marketplace — find medications, trusted health facilities, hospitals, clinics, skincare brands, wellness products, laboratories and verified health professionals near you, all in one place.
        </p>
        <form onSubmit={runSearch}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search medication, facility, doctor…" style={{ flex: 1, padding: 13, fontSize: 14, border: 'none', borderRadius: 13, boxSizing: 'border-box' }} />
            <button type="submit" style={{ padding: '0 18px', background: '#fff', color: theme.tealDeep, border: 'none', borderRadius: 13, fontWeight: 800, fontSize: 14 }}>Go</button>
          </div>
        </form>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '14px 16px 6px' }}>
        {[
          { key: 'products', label: 'Products', icon: '💊' },
          { key: 'businesses', label: 'Health Facilities', icon: '🏥' },
          { key: 'professionals', label: 'Professionals', icon: '🩺' },
        ].map((c) => (
          <button key={c.key} onClick={() => setTab(c.key)} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '12px 4px',
            borderRadius: 14, border: tab === c.key ? `2px solid ${theme.tealDeep}` : `1px solid ${theme.border}`,
            background: tab === c.key ? '#ecfdf5' : theme.cardBg, cursor: 'pointer',
          }}>
            <span style={{ fontSize: 22 }}>{c.icon}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: theme.navy }}>{c.label}</span>
          </button>
        ))}
      </div>

      <div style={{ padding: '4px 16px 0' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={{ flex: 1, padding: 11, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 11, background: '#fff', color: stateFilter ? theme.navy : theme.textLight }}>
            <option value="">📍 All states</option>
            {NG_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {tab === 'professionals' && (
            <input value={specialtyFilter} onChange={(e) => setSpecialtyFilter(e.target.value)} placeholder="Specialty" style={{ flex: 1, padding: 11, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 11, boxSizing: 'border-box' }} />
          )}
        </div>
        {stateFilter && (
          <button onClick={() => setStateFilter('')} style={{ marginTop: 6, padding: '4px 10px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: 10, fontSize: 11, color: theme.textLight }}>Clear location</button>
        )}
      </div>

      {showingFeatured && featured.length > 0 && (
        <div style={{ padding: '14px 0 4px' }}>
          <p style={{ margin: '0 0 10px 16px', fontSize: 12, fontWeight: 900, color: theme.navy }}>{featuredType === 'promo' ? '✨ Featured Promotions' : '✨ Featured on MedMarket'}</p>
          <div style={{ overflow: 'hidden', width: '100%' }}>
            <div className="mm-track" ref={trackRef}>
              {[...featured, ...featured].map((p, i) => (
                featuredType === 'promo' ? (
                  <Link key={i} className="mm-card" to={p.link_url || '/search'} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 200 }}>
                    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, overflow: 'hidden', background: theme.cardBg }}>
                      <div style={{ height: 110, background: p.image_url ? `url(${p.image_url})` : theme.heroGradient, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'flex-start', padding: 8 }}>
                        <span style={{ fontSize: 8.5, fontWeight: 900, letterSpacing: '0.06em', color: '#fff', background: theme.tealDeep, padding: '2px 8px', borderRadius: 20, textTransform: 'uppercase' }}>Promo</span>
                      </div>
                      <div style={{ padding: '9px 11px 12px' }}>
                        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: theme.navy, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.title}</p>
                      </div>
                    </div>
                  </Link>
                ) : (
                  <Link key={i} className="mm-card" to={`/drug/${encodeURIComponent(p.name)}`} style={{ textDecoration: 'none', color: 'inherit', flexShrink: 0, width: 130 }}>
                    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.cardBg, textAlign: 'center' }}>
                      <div style={{ fontSize: 30, marginBottom: 6 }}>{p.emoji || '💊'}</div>
                      <p style={{ margin: '0 0 3px 0', fontSize: 12.5, fontWeight: 800, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                      {p.price != null && <p style={{ margin: '0 0 2px 0', fontSize: 12, fontWeight: 700, color: theme.tealDeep }}>₦{Number(p.price).toLocaleString()}</p>}
                      <p style={{ margin: 0, fontSize: 10, color: theme.textLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.businesses?.name || ''}</p>
                    </div>
                  </Link>
                )
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '14px 16px 0' }}>
        {loading && <p style={{ color: theme.textLight, fontSize: 13 }}>Loading…</p>}

        {!loading && tab === 'products' && products.length === 0 && (query.trim() || stateFilter) && (
          <EmptyState label="No products found" hint="Try another name or state." />
        )}
        {!loading && tab === 'businesses' && businesses.length === 0 && (
          <EmptyState label="No health facilities found" hint="Try another state." />
        )}
        {!loading && tab === 'professionals' && professionals.length === 0 && (
          <EmptyState label="No professionals found" hint="Try another specialty or state." />
        )}

        {products.map((p, idx) => {
          // WhatsApp: product's own number, else the business's number (CareHub inventory)
          const rawWa = p.whatsapp || p.businesses?.whatsapp
          let waLink = null
          if (rawWa) {
            let num = rawWa.replace(/\D/g, '')
            if (num.startsWith('0')) num = '234' + num.slice(1)
            else if (!num.startsWith('234')) num = '234' + num
            waLink = `https://wa.me/${num}?text=${encodeURIComponent(`Hi, I'm interested in "${p.name}" on CareFind.`)}`
          }
          return (
            <div key={p.id} className="mm-card" style={{ animationDelay: `${Math.min(idx * 0.04, 0.4)}s`, padding: 12, border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 8, background: theme.cardBg }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {p.image_url
                  ? <div style={{ width: 46, height: 46, borderRadius: 10, background: `url(${p.image_url}) center/cover`, flexShrink: 0 }} />
                  : <div style={{ fontSize: 26 }}>{p.emoji || '💊'}</div>}
                <div style={{ flex: 1 }}>
                  <Link to={`/drug/${encodeURIComponent(p.name)}`} style={{ textDecoration: 'none' }}>
                    <p style={{ margin: '0 0 2px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>{p.name}{p.category && <span style={{ fontSize: 9, fontWeight: 800, color: theme.tealDeep, background: '#ecfdf5', padding: '1px 6px', borderRadius: 10, marginLeft: 6 }}>{p.category}</span>}</p>
                    {p.generic_name && <p style={{ margin: '0 0 2px 0', fontSize: 11.5, color: theme.textMid, fontStyle: 'italic' }}>{p.generic_name}</p>}
                    <p style={{ margin: '0 0 3px 0', fontSize: 10.5, color: theme.tealDeep, fontWeight: 700 }}>⭐ See reviews ›</p>
                  </Link>
                  {p.business_id ? (
                    <Link to={`/business/${p.business_id}`} style={{ margin: 0, fontSize: 12, color: theme.tealDeep, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
                      {p.businesses?.name || 'View business'}
                      {(() => {
                        const loc = p.seller_location || p.businesses?.state || p.businesses?.city
                        return loc ? <span style={{ color: theme.textLight, fontWeight: 400 }}> · 📍 {loc}</span> : null
                      })()}
                      {' ›'}
                    </Link>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>
                      {(() => {
                        const loc = p.seller_location
                        return loc ? <span>📍 {loc}</span> : null
                      })()}
                    </p>
                  )}
                </div>
                {p.price != null && (
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: theme.tealDeep }}>₦{Number(p.price).toLocaleString()}</p>
                    {p.price_unit && <p style={{ margin: 0, fontSize: 9.5, color: theme.textLight }}>per {p.price_unit}</p>}
                  </div>
                )}
              </div>
              {(p.sale_type || p.min_purchase) && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {p.sale_type && <span style={{ fontSize: 9.5, fontWeight: 800, color: p.sale_type === 'wholesale' ? '#7c3aed' : theme.tealDeep, background: p.sale_type === 'wholesale' ? '#f3e8ff' : '#ecfdf5', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>{p.sale_type}</span>}
                  {p.min_purchase && <span style={{ fontSize: 9.5, fontWeight: 700, color: theme.textMid, background: theme.bg, padding: '2px 8px', borderRadius: 10 }}>Min {p.min_purchase} {p.price_unit || ''}{p.min_purchase > 1 ? 's' : ''}</span>}
                </div>
              )}
              {waLink && (
                <a href={waLink} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, padding: '9px 12px', background: '#25D366', color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 13, textDecoration: 'none' }}>
                  💬 Message on WhatsApp
                </a>
              )}
            </div>
          )
        })}

        {businesses.map((b, idx) => (
          <Link key={b.id} className="mm-card" to={`/business/${b.id}`} style={{ animationDelay: `${Math.min(idx * 0.04, 0.4)}s`, textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12, padding: 12, border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 8, background: theme.cardBg }}>
            <div style={{ width: 46, height: 46, borderRadius: 10, background: b.cover_url ? `url(${b.cover_url})` : theme.navy, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, flexShrink: 0 }}>
              {!b.cover_url && (b.name?.[0]?.toUpperCase() || '🏥')}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 2px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>{b.name}</p>
              <p style={{ margin: 0, fontSize: 12, color: theme.textLight, textTransform: 'capitalize' }}>{b.business_type} · {b.city}{b.state ? `, ${b.state}` : ''}</p>
              <p style={{ margin: '3px 0 0 0', fontSize: 10.5, color: theme.tealDeep, fontWeight: 700 }}>⭐ See profile & reviews ›</p>
            </div>
          </Link>
        ))}

        {professionals.map((pr, idx) => (
          <Link key={pr.id} className="mm-card" to={`/u/${pr.id}`} style={{ animationDelay: `${Math.min(idx * 0.04, 0.4)}s`, textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12, padding: 12, border: `1px solid ${theme.border}`, borderRadius: 14, marginBottom: 8, background: theme.cardBg, alignItems: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: theme.tealGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, flexShrink: 0 }}>
              {(pr.full_name?.[0] || pr.display_name?.[0] || '?').toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 2px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>{pr.full_name || pr.display_name} <span style={{ color: theme.tealDeep }}>✓</span></p>
              <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>{pr.verification_label || pr.specialty}{pr.location ? ` · ${pr.location}` : ''}</p>
            </div>
          </Link>
        ))}
      </div>

      <BottomNav />
    </div>
  )
}

function EmptyState({ label, hint }) {
  return (
    <div style={{ textAlign: 'center', padding: '30px 20px' }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
      <p style={{ fontSize: 14, fontWeight: 700, color: theme.navy, margin: '0 0 4px 0' }}>{label}</p>
      <p style={{ fontSize: 12.5, color: theme.textLight, margin: 0 }}>{hint}</p>
    </div>
  )
}

export default Search
