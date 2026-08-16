import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { Check, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Loading, ErrorState, Inp, TealBtn, BrandArt } from '../../components/ui'

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
  const { isMobileOrTablet } = useBreakpoint()

  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  const [checking, setChecking] = useState(false)
  const [available, setAvailable] = useState(null) // null | true | false
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [profileLoadKey, setProfileLoadKey] = useState(0)

  // If not logged in, send to login
  useEffect(() => {
    if (!authLoading && !user) navigate('/login')
  }, [authLoading, user, navigate])

  // Prefill from existing profile if present
  useEffect(() => {
    async function loadProfile() {
      if (!user) return
      try {
        const { data, error: err } = await supabase
          .from('profiles')
          .select('full_name, display_name, phone, location')
          .eq('id', user.id)
          .maybeSingle()
        if (err) throw err
        if (data) {
          setFullName(data.full_name || '')
          setUsername(data.display_name || '')
          setPhone(data.phone || '')
          setLocation(data.location || '')
        } else {
          // Fresh account: prefill location from what they typed at signup
          setLocation(user.user_metadata?.location || '')
        }
      } catch (e) {
        setLoadError('Could not load your profile. Check your connection and try again.')
      }
      setLoadingProfile(false)
    }
    loadProfile()
  }, [user, profileLoadKey])

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
      location: location.trim() || null,
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

    navigate('/feed')
  }

  if (authLoading || loadingProfile) {
    return <Loading fullScreen />
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => { setLoadError(''); setLoadingProfile(true); setProfileLoadKey(k => k + 1) }} />
  }

  const usernameStatus = username.length >= 3 && (
    <p style={{ margin: '6px 0 0 0', fontSize: 12, fontWeight: 600, color: checking ? theme.textLight : available ? theme.success : theme.alert }}>
      {checking
        ? 'Checking availability…'
        : available
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={13} strokeWidth={3} aria-hidden="true" /> Available</span>
          : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><X size={13} strokeWidth={3} aria-hidden="true" /> Taken: try another</span>}
    </p>
  )

  // One shared form body for both shells — the mobile hero-then-card column
  // and the laptop-centered card (LOGIN_SHELLS.md: same pattern Login uses
  // with its authForm). Fields are the shared Inp primitive, so radius,
  // focus states and the required indicator stay in one place.
  const formBody = (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Inp
        label="Full name"
        value={fullName}
        onChange={setFullName}
        placeholder="e.g. Dr. John Ade-Williams"
        required
      />

      <div>
        <label htmlFor="onboarding-username" style={{ display: 'block', fontSize: 11, fontWeight: 700, color: theme.gray600, marginBottom: 6 }}>
          Username<span style={{ color: theme.danger }} aria-hidden="true"> *</span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: theme.textLight }}>@</span>
          <Inp
            id="onboarding-username"
            value={username}
            onChange={(v) => setUsername(normalizeUsername(v))}
            placeholder="johnade"
            style={{ flex: 1 }}
          />
        </div>
        {usernameStatus}
        <p style={{ margin: '5px 0 0 0', fontSize: 11, color: theme.textLight }}>Lowercase letters, numbers and underscores only.</p>
      </div>

      <Inp
        label="Phone number"
        type="tel"
        value={phone}
        onChange={setPhone}
        placeholder="e.g. 08012345678"
        required
      />

      <div>
        <Inp
          label="Location"
          value={location}
          onChange={setLocation}
          placeholder="e.g. Lagos, Nigeria"
        />
        <p style={{ margin: '5px 0 0 0', fontSize: 11, color: theme.textLight }}>Anywhere in the world: helps buyers find your listings.</p>
      </div>

      {error && <p role="alert" style={{ color: theme.alert, fontSize: 13, margin: 0 }}>{error}</p>}

      <TealBtn
        type="submit"
        disabled={saving || checking || available === false}
        style={{
          padding: 13, fontSize: 14, fontWeight: 800,
          boxShadow: '0 3px 8px rgba(15,118,110,0.25)',
          opacity: (saving || available === false) ? 0.7 : 1,
        }}
      >
        {saving ? 'Saving…' : 'Save & Continue'}
      </TealBtn>

      <Link to="/" style={{ textAlign: 'center', fontSize: 13, color: theme.textLight, textDecoration: 'none', fontWeight: 600 }}>
        Skip for now
      </Link>
    </form>
  )

  if (isMobileOrTablet) {
    return (
      <div style={{ fontFamily: theme.fontFamily, maxWidth: 420, margin: '0 auto', minHeight: '100vh', background: theme.bg }}>
        <div style={{ background: theme.navy, padding: '24px 20px 50px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
          <BrandArt size={72} tone="light" style={{ marginBottom: 14 }} />
          <h1 style={{ fontSize: 23, fontWeight: 900, margin: '0 0 4px 0', letterSpacing: '-0.02em' }}>Complete your profile</h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0 }}>Just a few details to get you started on CareFind</p>
        </div>

        <div style={{ padding: '0 20px', marginTop: -28 }}>
          <div style={{ background: theme.cardBg, borderRadius: theme.radius.xl, padding: 18, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
            {formBody}
          </div>
        </div>
      </div>
    )
  }

  // Laptop+: centered on the viewport rather than a 420px mobile column with
  // an edge-to-edge hero bleed (RESPONSIVENESS.md: this is a one-time,
  // pre-app screen, so no persistent nav chrome here, same reasoning as Login).
  return (
    <div style={{ fontFamily: theme.fontFamily, minHeight: '100vh', background: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <BrandArt size={96} tone="dark" />
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 4px 0', letterSpacing: '-0.02em', color: theme.navy }}>Complete your profile</h1>
        <p style={{ fontSize: 13.5, color: theme.textLight, margin: '0 0 24px 0' }}>Just a few details to get you started on CareFind</p>

        <div style={{ background: theme.cardBg, borderRadius: theme.radius.xl, padding: 24, boxShadow: theme.elevation[2], border: `1px solid ${theme.border}` }}>
          {formBody}
        </div>
      </div>
    </div>
  )
}

export default Onboarding