import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'

// Username rule: lowercase letters, numbers, underscores. 3-20 chars.
function normalizeUsername(raw) {
  return (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20)
}

function Onboarding() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [checking, setChecking] = useState(false)
  const [available, setAvailable] = useState(null) // null | true | false
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(true)

  // If not logged in, send to login
  useEffect(() => {
    if (!authLoading && !user) navigate('/login')
  }, [authLoading, user, navigate])

  // Prefill from existing profile if present
  useEffect(() => {
    async function loadProfile() {
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('full_name, display_name, phone')
        .eq('id', user.id)
        .maybeSingle()
      if (data) {
        setFullName(data.full_name || '')
        setUsername(data.display_name || '')
        setPhone(data.phone || '')
      }
      setLoadingProfile(false)
    }
    loadProfile()
  }, [user])

  // Live username availability check (debounced)
  useEffect(() => {
    if (!username || username.length < 3) { setAvailable(null); return }
    let active = true
    setChecking(true)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .ilike('display_name', username)
        .maybeSingle()
      if (!active) return
      // Available if no row, or the only row is the current user
      setAvailable(!data || data.id === user?.id)
      setChecking(false)
    }, 450)
    return () => { active = false; clearTimeout(t) }
  }, [username, user])

  async function handleSave(e) {
    e.preventDefault()
    setError('')

    if (!fullName.trim()) { setError('Please enter your full name.'); return }
    if (username.length < 3) { setError('Username must be at least 3 characters.'); return }
    if (available === false) { setError('That username is taken. Try another.'); return }
    if (!phone.trim()) { setError('Please enter your phone number.'); return }

    setSaving(true)

    const { error: saveError } = await supabase.from('profiles').upsert({
      id: user.id,
      full_name: fullName.trim(),
      display_name: username,
      phone: phone.trim(),
    }, { onConflict: 'id' })

    if (saveError) {
      // Unique violation on username index
      if (saveError.code === '23505' || /duplicate|unique/i.test(saveError.message)) {
        setError('That username is taken. Try another.')
        setAvailable(false)
      } else {
        setError('Could not save: ' + saveError.message)
      }
      setSaving(false)
      return
    }

    navigate('/')
  }

  if (authLoading || loadingProfile) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
        <p style={{ color: theme.textLight }}>Loading...</p>
      </div>
    )
  }

  const inputStyle = { padding: 13, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 13, width: '100%', boxSizing: 'border-box' }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 420, margin: '0 auto', minHeight: '100vh', background: theme.bg }}>
      <div style={{ background: theme.heroGradient, padding: '24px 20px 50px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
        <h1 style={{ fontSize: 23, fontWeight: 900, margin: '0 0 4px 0', letterSpacing: '-0.02em' }}>Complete your profile</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0 }}>Just a few details to get you started on CareFind</p>
      </div>

      <div style={{ padding: '0 20px', marginTop: -28 }}>
        <div style={{ background: theme.cardBg, borderRadius: 20, padding: 18, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Full name */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: theme.navy, display: 'block', marginBottom: 5 }}>Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Dr. John Ade-Williams"
                style={inputStyle}
              />
            </div>

            {/* Username */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: theme.navy, display: 'block', marginBottom: 5 }}>Username</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: theme.textLight }}>@</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(normalizeUsername(e.target.value))}
                  placeholder="johnade"
                  style={inputStyle}
                />
              </div>
              {username.length >= 3 && (
                <p style={{ margin: '5px 0 0 0', fontSize: 12, fontWeight: 600, color: checking ? theme.textLight : available ? theme.success : theme.alert }}>
                  {checking ? 'Checking availability…' : available ? '✓ Available' : '✕ Taken — try another'}
                </p>
              )}
              <p style={{ margin: '5px 0 0 0', fontSize: 11, color: theme.textLight }}>Lowercase letters, numbers and underscores only.</p>
            </div>

            {/* Phone */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: theme.navy, display: 'block', marginBottom: 5 }}>Phone number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 08012345678"
                style={inputStyle}
              />
            </div>

            {error && <p style={{ color: theme.alert, fontSize: 13, margin: 0 }}>{error}</p>}

            <button
              type="submit"
              disabled={saving || checking || available === false}
              style={{
                padding: 13, fontSize: 14, background: theme.tealGradient, color: '#fff', border: 'none',
                borderRadius: 13, fontWeight: 800, boxShadow: '0 3px 8px rgba(15,118,110,0.25)',
                opacity: (saving || available === false) ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save & Continue'}
            </button>

            <Link to="/" style={{ textAlign: 'center', fontSize: 13, color: theme.textLight, textDecoration: 'none', fontWeight: 600 }}>
              Skip for now
            </Link>
          </form>
        </div>
      </div>
    </div>
  )
}

export default Onboarding
