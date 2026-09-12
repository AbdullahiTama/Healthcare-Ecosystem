import { useState } from 'react'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { Button, Card, Input, Select, Loading, ErrorState, Empty } from '../../components/ui'

const NIGERIAN_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River',
  'Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano',
  'Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo',
  'Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara',
]

const TIER_DEFAULTS = { agent: 10, community_coordinator: 5, state_coordinator: 3, unplaced: 0 }

function hashPassword(password) {
  // Mirrors admin-auth simple hash for carefind agents (no Supabase Auth for agents)
  // Storage uses password_hash column; login checks same prefix
  return `cf_agent_${password}`
}

export async function registerAgent({ full_name, email, password, state }) {
  const payload = {
    full_name: full_name.trim(),
    email: email.trim().toLowerCase(),
    password_hash: hashPassword(password),
    tier: 'unplaced',
    status: 'pending',
    state: state || null,
    commission_pct: null,
  }
  // eslint-disable-next-line no-console
  console.info('[AgentRegistration] insert', { email: payload.email, state: payload.state })
  const { data, error } = await supabase
    .from('agents')
    .insert(payload)
    .select('id, full_name, email, referral_code, tier, status, state, commission_pct, created_at')
    .single()
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[AgentRegistration] insert failed', error.message)
    throw error
  }
  // eslint-disable-next-line no-console
  console.info('[AgentRegistration] success', { id: data.id, referral_code: data.referral_code })
  return data
}

// Handles business signup referral attribution: if referral_code supplied and valid, insert agent_referrals
export async function recordBusinessReferral({ businessId, referralCode }) {
  if (!referralCode || !businessId) return null
  const code = String(referralCode).trim().toUpperCase()
  if (!code) return null
  // eslint-disable-next-line no-console
  console.info('[AgentRegistration] record referral', { businessId, code })
  const { data: agent, error: agentErr } = await supabase
    .from('agents')
    .select('id, referral_code, status')
    .eq('referral_code', code)
    .maybeSingle()
  if (agentErr) {
    // eslint-disable-next-line no-console
    console.warn('[AgentRegistration] referral lookup failed', agentErr.message)
    return null
  }
  if (!agent || !agent.id) {
    // Invalid code → no referral, no error (per spec)
    // eslint-disable-next-line no-console
    console.warn('[AgentRegistration] invalid referral_code', code)
    return null
  }
  // Insert referral attribution; unique on business_id ensures one referral per business
  const { data, error } = await supabase
    .from('agent_referrals')
    .insert({ agent_id: agent.id, business_id: businessId, referral_code: code })
    .select('id, agent_id, business_id')
    .single()
  if (error) {
    // duplicate business (already referred) → 23505, treat as no-op
    if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
      // eslint-disable-next-line no-console
      console.warn('[AgentRegistration] referral already exists for business', businessId)
      return null
    }
    // eslint-disable-next-line no-console
    console.warn('[AgentRegistration] referral insert failed', error.message)
    return null
  }
  // eslint-disable-next-line no-console
  console.info('[AgentRegistration] referral recorded', { agent_id: agent.id, business_id: businessId })
  return data
}

export default function AgentRegistration() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [stateVal, setStateVal] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null) // { referral_code, id, full_name }
  const [fieldErrors, setFieldErrors] = useState({})

  function validate() {
    const fe = {}
    if (!fullName.trim()) fe.full_name = 'Full name is required'
    if (!email.trim()) fe.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fe.email = 'Enter a valid email'
    if (!password) fe.password = 'Password is required'
    else if (password.length < 6) fe.password = 'Password must be at least 6 characters'
    if (!stateVal) fe.state = 'State is required'
    setFieldErrors(fe)
    return Object.keys(fe).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!validate()) return
    setLoading(true)
    try {
      const data = await registerAgent({ full_name: fullName, email, password, state: stateVal })
      setSuccess(data)
      // clear form
      setFullName('')
      setEmail('')
      setPassword('')
      setStateVal('')
    } catch (err) {
      const msg = err.message || 'Registration failed'
      if (err.code === '23505' || /duplicate|unique|already/i.test(msg)) {
        setError('This email is already registered. Please use a different email or log in.')
        setFieldErrors((prev) => ({ ...prev, email: 'Email already in use' }))
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div data-testid="registration-success" style={{ fontFamily: theme.fontFamily, maxWidth: 520, margin: '0 auto', padding: 16 }}>
        <Card style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: theme.successBg, color: theme.success, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24 }} aria-hidden="true">✓</div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: theme.type.h2.size, fontWeight: theme.type.h2.weight, color: theme.navy }}>Registration submitted</h2>
          <p style={{ margin: '0 0 16px 0', fontSize: 13, color: theme.textMid, lineHeight: 1.6 }}>
            Your application is <strong style={{ color: theme.warning }}>pending</strong> review. Tier: <code>unplaced</code>, Status: <code>pending</code>.
          </p>
          <div data-testid="referral-code-display" style={{ background: theme.gray100, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: theme.textLight, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Your referral code</div>
            <div style={{ fontFamily: theme.fontMono, fontSize: 20, fontWeight: 800, color: theme.tealDeep, letterSpacing: '0.08em' }}>{success.referral_code || 'CF-XXXXXX'}</div>
            <div style={{ fontSize: 11, color: theme.textLight, marginTop: 6 }}>Share this code with businesses. They enter it at signup.</div>
          </div>
          <p style={{ fontSize: 12, color: theme.textLight, marginBottom: 16 }}>
            Save your code now. Admin will review and place you in a tier (agent / community coordinator / state coordinator) with a commission rate.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setSuccess(null)}>Register another agent</Button>
        </Card>
      </div>
    )
  }

  return (
    <div data-testid="agent-registration" style={{ fontFamily: theme.fontFamily, maxWidth: 520, margin: '0 auto', padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: '0 0 4px 0', fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.navy, letterSpacing: theme.type.h1.letterSpacing }}>Become a CareFind Agent</h1>
        <p style={{ margin: 0, fontSize: theme.type.body.size, color: theme.textLight }}>Self-register to get your <code>CF-</code> referral code. Admin will review and place you.</p>
      </div>

      <Card style={{ padding: 20 }}>
        <form onSubmit={handleSubmit} noValidate aria-label="Agent registration form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input
            label="Full name"
            value={fullName}
            onChange={setFullName}
            placeholder="e.g. Ada Okoro"
            required
            error={fieldErrors.full_name}
            id="agent-full-name"
          />
          <Input
            label="Email address"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="ada@example.com"
            required
            error={fieldErrors.email}
            id="agent-email"
            helperText="Lowercase email is stored unique; used for login."
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 6 characters"
            required
            error={fieldErrors.password}
            id="agent-password"
            helperText="Stored as password_hash; checked via crypt on login."
          />
          <Select
            label="State"
            value={stateVal}
            onChange={setStateVal}
            options={NIGERIAN_STATES.map((s) => ({ value: s, label: s }))}
            required
            error={fieldErrors.state}
            id="agent-state"
            placeholder="Select your state"
            helperText="Used for state coordinator earnings hierarchy."
          />

          {error && (
            <div data-testid="registration-error" role="alert" aria-live="assertive" style={{ background: theme.dangerBg, border: `1px solid ${theme.danger}`, color: theme.danger, borderRadius: theme.radius.md, padding: '10px 12px', fontSize: 13 }}>
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="md" loading={loading} loadingText="Registering..." fullWidth disabled={loading} aria-label="Submit agent registration">
            Register as agent
          </Button>

          <p style={{ margin: 0, fontSize: 11, color: theme.textLight, textAlign: 'center' }}>
            On submit: <code>tier=unplaced</code>, <code>status=pending</code>, referral_code <code>CF-xxxxxx</code> unique via trigger.
          </p>
        </form>
      </Card>

      <div style={{ marginTop: 12, fontSize: 11, color: theme.textLight, textAlign: 'center' }}>
        Already registered? <a href="/agent-login" style={{ color: theme.tealDeep, fontWeight: 700, textDecoration: 'none' }}>Agent login</a>
      </div>
    </div>
  )
}
