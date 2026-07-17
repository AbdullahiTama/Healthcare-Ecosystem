import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'

function ClaimStaffPosition() {
  const { user, loading: authLoading } = useAuth()
  const [query, setQuery] = useState('')
  const [businessResults, setBusinessResults] = useState([])
  const [selectedBusiness, setSelectedBusiness] = useState(null)
  const [staffList, setStaffList] = useState([])
  const [searching, setSearching] = useState(false)
  const [loadingStaff, setLoadingStaff] = useState(false)
  const [myClaims, setMyClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [verifyingId, setVerifyingId] = useState(null)
  const [emailInput, setEmailInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [claimError, setClaimError] = useState('')

  useEffect(() => {
    async function load() {
      if (!user) { setLoading(false); return }
      await refreshMyClaims()
      setLoading(false)
    }
    if (!authLoading) load()
  }, [user, authLoading])

  async function refreshMyClaims() {
    const { data } = await supabase
      .from('staff_claims')
      .select('id, staff_id, status, staff:staff_id(full_name, public_title, businesses(name))')
      .eq('user_id', user.id)
    setMyClaims(data || [])
  }

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setSelectedBusiness(null)
    setStaffList([])
    const { data } = await supabase
      .from('businesses')
      .select('id, name, address, city, state, business_type')
      .ilike('name', `%${query}%`)
    setBusinessResults(data || [])
    setSearching(false)
  }

  async function selectBusiness(biz) {
    setSelectedBusiness(biz)
    setLoadingStaff(true)
    setVerifyingId(null)
    setEmailInput('')
    setClaimError('')
    const { data } = await supabase
      .from('staff_directory')
      .select('staff_id, full_name, public_title, role, business_name')
      .eq('business_id', biz.id)
    setStaffList(data || [])
    setLoadingStaff(false)
  }

  function startVerify(staffId) {
    setVerifyingId(staffId)
    setEmailInput('')
    setClaimError('')
  }

  async function submitClaim(staffId) {
    if (!emailInput.trim()) { setClaimError('Enter the work email on your staff account.'); return }
    setSubmitting(true)
    setClaimError('')
    const { data, error } = await supabase.rpc('attempt_staff_claim', {
      p_staff_id: staffId,
      p_email: emailInput.trim(),
    })
    setSubmitting(false)
    if (error) { setClaimError('Something went wrong. Please try again.'); return }
    if (data === 'no_match') { setClaimError("That email doesn't match our records for this position."); return }
    if (data === 'already_claimed') { setClaimError('You already have a claim in for this position.'); return }
    if (data === 'not_logged_in') { setClaimError('Please log in again.'); return }
    // ok
    setVerifyingId(null)
    setEmailInput('')
    await refreshMyClaims()
  }

  function alreadyClaimed(staffId) {
    return myClaims.some((c) => c.staff_id === staffId)
  }

  if (authLoading || loading) return <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>Loading...</div>

  if (!user) {
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: theme.textMid }}>Log in to claim your position.</p>
        <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log In</Link>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
      <div style={{ background: theme.heroGradient, padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
        <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>
        <h1 style={{ fontSize: 21, fontWeight: 900, margin: '14px 0 4px 0' }}>Claim Your Position</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '0 0 16px 0' }}>
          Find your company, then verify with your work email
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
              placeholder="Search your company name..."
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
                  <div>
                    <p style={{ margin: '0 0 2px 0', fontSize: 13.5, fontWeight: 700, color: theme.navy }}>{c.staff?.public_title || 'Team Member'}</p>
                    <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>{c.staff?.businesses?.name}</p>
                  </div>
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

        {!selectedBusiness && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {businessResults.map((biz) => (
              <div key={biz.id} onClick={() => selectBusiness(biz)} style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', cursor: 'pointer' }}>
                <h3 style={{ margin: '0 0 4px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>{biz.name}</h3>
                <p style={{ margin: 0, color: theme.textLight, fontSize: 12.5, textTransform: 'capitalize' }}>
                  {biz.business_type} · {biz.city}, {biz.state}
                </p>
                <p style={{ margin: '8px 0 0 0', fontSize: 12, color: theme.tealDeep, fontWeight: 700 }}>Tap to see team →</p>
              </div>
            ))}
          </div>
        )}

        {selectedBusiness && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <p style={{ margin: '0 0 2px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>{selectedBusiness.name}</p>
                <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>Find your name below</p>
              </div>
              <button onClick={() => { setSelectedBusiness(null); setStaffList([]); setVerifyingId(null) }} style={{ background: 'none', border: 'none', color: theme.tealDeep, fontSize: 13, fontWeight: 700 }}>Change company</button>
            </div>

            {loadingStaff && <p style={{ color: theme.textMid, fontSize: 13 }}>Loading team...</p>}

            {!loadingStaff && staffList.length === 0 && (
              <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 20, textAlign: 'center', background: theme.cardBg }}>
                <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>
                  Nobody at this company is listed on CareFind yet. Ask your admin to add you as staff and turn on "Show on CareFind."
                </p>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {staffList.map((s) => (
                <div key={s.staff_id} style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>{s.full_name}</h3>
                  <p style={{ margin: '0 0 10px 0', color: theme.tealDeep, fontSize: 12.5, fontWeight: 700 }}>
                    {s.public_title || s.role}
                  </p>

                  {alreadyClaimed(s.staff_id) ? (
                    <div style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 12, background: theme.bg, color: theme.textLight, display: 'inline-block' }}>
                      Claim submitted
                    </div>
                  ) : verifyingId === s.staff_id ? (
                    <div>
                      <p style={{ margin: '0 0 8px 0', fontSize: 12, color: theme.textLight }}>
                        Enter the work email on your staff account to verify it's you:
                      </p>
                      <input
                        type="email"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="you@company.ng"
                        style={{ width: '100%', padding: 10, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 10, marginBottom: 8, boxSizing: 'border-box' }}
                      />
                      {claimError && <p style={{ margin: '0 0 8px 0', fontSize: 12, color: theme.alert }}>{claimError}</p>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => { setVerifyingId(null); setClaimError('') }}
                          style={{ flex: 1, padding: '8px 12px', fontSize: 13, fontWeight: 700, border: `1px solid ${theme.border}`, borderRadius: 12, background: '#fff', color: theme.textMid }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => submitClaim(s.staff_id)}
                          disabled={submitting}
                          style={{ flex: 2, padding: '8px 12px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 12, background: theme.tealGradient, color: '#fff' }}
                        >
                          {submitting ? 'Verifying...' : 'Verify & Submit Claim'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => startVerify(s.staff_id)}
                      style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 12, background: theme.tealGradient, color: '#fff' }}
                    >
                      This is me
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  )
}

export default ClaimStaffPosition
