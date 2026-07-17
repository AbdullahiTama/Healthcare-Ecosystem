import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'

function ClaimBusiness() {
  const { user, loading: authLoading } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [myClaims, setMyClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [submittingId, setSubmittingId] = useState(null)

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('business_claims')
        .select('id, business_id, status, businesses(name)')
        .eq('user_id', user.id)
      setMyClaims(data || [])
      setLoading(false)
    }
    if (!authLoading) load()
  }, [user, authLoading])

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    const { data } = await supabase
      .from('businesses')
      .select('id, name, address, city, state, business_type')
      .ilike('name', `%${query}%`)
    setResults(data || [])
    setSearching(false)
  }

  async function handleClaim(businessId) {
    if (!user) return
    setSubmittingId(businessId)
    const { error } = await supabase.from('business_claims').insert({
      user_id: user.id,
      business_id: businessId,
    })
    if (!error) {
      const { data } = await supabase
        .from('business_claims')
        .select('id, business_id, status, businesses(name)')
        .eq('user_id', user.id)
      setMyClaims(data || [])
    }
    setSubmittingId(null)
  }

  function alreadyClaimed(businessId) {
    return myClaims.some((c) => c.business_id === businessId)
  }

  if (authLoading || loading) return <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>Loading...</div>

  if (!user) {
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: theme.textMid }}>Log in to claim a business.</p>
        <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log In</Link>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
      <div style={{ background: theme.heroGradient, padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
        <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>
        <h1 style={{ fontSize: 21, fontWeight: 900, margin: '14px 0 4px 0' }}>Claim Your Business</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '0 0 16px 0' }}>
          Search and claim your business listing
        </p>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.18)', borderRadius: 16, padding: '11px 14px',
          }}>
            <span>🔍</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your business name..."
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: 14 }}
            />
          </div>
          <button type="submit" style={{ padding: '0 16px', fontSize: 13, fontWeight: 800, background: theme.tealBright, color: theme.navy, border: 'none', borderRadius: 16 }}>
            Go
          </button>
        </form>
      </div>

      <div style={{ padding: '20px 20px 0 20px' }}>
        {myClaims.length > 0 && (
          <>
            <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px 0' }}>
              My Claim Requests
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
              {myClaims.map((c) => (
                <div key={c.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: theme.cardBg }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: theme.navy }}>{c.businesses?.name}</span>
                  <span style={{
                    fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 20, textTransform: 'capitalize',
                    background: c.status === 'approved' ? '#ecfdf5' : c.status === 'rejected' ? '#fef2f2' : '#fef3c7',
                    color: c.status === 'approved' ? theme.success : c.status === 'rejected' ? theme.alert : theme.warning,
                  }}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {searching && <p style={{ color: theme.textMid }}>Searching...</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {results.map((biz) => (
            <div key={biz.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: '0 0 4px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>{biz.name}</h3>
              <p style={{ margin: '0 0 10px 0', color: theme.textLight, fontSize: 12.5, textTransform: 'capitalize' }}>
                {biz.business_type} · {biz.city}, {biz.state}
              </p>
              <button
                onClick={() => handleClaim(biz.id)}
                disabled={alreadyClaimed(biz.id) || submittingId === biz.id}
                style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 12,
                  background: alreadyClaimed(biz.id) ? theme.bg : theme.tealGradient,
                  color: alreadyClaimed(biz.id) ? theme.textLight : '#fff',
                }}
              >
                {alreadyClaimed(biz.id) ? 'Claim submitted' : submittingId === biz.id ? 'Submitting...' : 'Claim this business'}
              </button>
            </div>
          ))}
        </div>
      </div>
      <BottomNav />
    </div>
  )
}

export default ClaimBusiness
