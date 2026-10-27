import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect, Suspense, lazy } from 'react'
import { initSentry, Sentry } from './lib/sentry'
import { authClient } from './lib/authClient'
import { resolveAccountByEmail, getBusinessById } from './services/supabase'
import { keepReachableLocation } from './lib/locationSwitch'
import { clearAllDraftBackups } from './modules/adr/draftBackup'
import { purgeUnsentReports } from './modules/live-activity/outbox/purge'
import AuthProvider from './providers/AuthProvider'

// Lazy-loaded pages for code splitting
const Landing = lazy(() => import('./pages/Landing'))
const Login = lazy(() => import('./pages/auth/Login'))
const Register = lazy(() => import('./pages/auth/Register'))
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'))
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'))
const LinkExpired = lazy(() => import('./pages/auth/LinkExpired'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const BusinessDashboard = lazy(() => import('./pages/dashboard/BusinessDashboard'))
const AgentLogin = lazy(() => import('./pages/agent/AgentLogin'))
const ApplyAgent = lazy(() => import('./pages/agent/ApplyAgent'))
const AgentDashboard = lazy(() => import('./modules/referral-agent/AgentDashboard'))
const ReceiptPage = lazy(() => import('./pages/ReceiptPage'))

// Loading fallback component
const LoadingFallback = () => (
  <div style={{ 
    minHeight: '100vh', 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center',
    background: 'var(--bg, #f8f6f0)'
  }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{ 
        width: 40, 
        height: 40, 
        borderRadius: '50%', 
        border: '3px solid #e2e8f0', 
        borderTopColor: '#0E6F5A', 
        animation: 'spin 0.7s linear infinite',
        margin: '0 auto 16px'
      }} />
      <div style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>Loading...</div>
    </div>
  </div>
)

export default function App() {
  initSentry()
  const location = useLocation()
  const [auth, setAuth] = useState(() => {
    try {
      const saved = localStorage.getItem('carehub_auth')
      return saved ? JSON.parse(saved) : null
    } catch (e) { return null }
  })

  // Independent identity lane for Referral Agents — a separate surface from
  // businesses/staff (an agent is not a business account), with its own
  // localStorage cache, same save/load idiom.
  const [agent, setAgent] = useState(() => {
    try {
      const saved = localStorage.getItem('carehub_agent_auth')
      return saved ? JSON.parse(saved) : null
    } catch (e) { return null }
  })

  const login = (brand, staff = null, extra = {}) => {
    const authData = { brand, staff, role: staff ? staff.role : 'Owner', loginTime: Date.now(), ...extra }
    setAuth(authData)
    localStorage.setItem('carehub_auth', JSON.stringify(authData))
  }

let loggingOut = false

  // `keepUnsentReports` is for the forced sign-out of an expired session: field reports written offline
  // must survive it and send after the next sign-in. A deliberate sign-out (the Sign Out buttons pass a
  // click event, never this option) takes them off a shared device.
  const logout = async (options) => {
    if (loggingOut) return
    loggingOut = true
    setAuth(null)
    localStorage.removeItem('carehub_auth')
    // ADR draft backups carry full patient/reporter rows: a shared device
    // must not retain them after sign-out. Never throws (logout proceeds).
    try { clearAllDraftBackups() } catch (e) {}
    if (!(options && options.keepUnsentReports === true)) {
      try { await purgeUnsentReports() } catch (e) {}
    }
    try { await authClient.auth.signOut() } catch (e) {}
    loggingOut = false
    window.location.href = '/login'
  }

  const loginAgent = (agentRow) => {
    setAgent(agentRow)
    localStorage.setItem('carehub_agent_auth', JSON.stringify(agentRow))
  }

  const logoutAgent = async () => {
    setAgent(null)
    localStorage.removeItem('carehub_agent_auth')
    try { clearAllDraftBackups() } catch (e) {}
    try { await purgeUnsentReports() } catch (e) {}
    try { await authClient.auth.signOut() } catch (e) {}
    window.location.href = '/login'
  }

  const isAdmin = () => auth?.isAdmin === true

  // Reconciles with a real Supabase Auth session on load, for accounts that have
  // already been migrated (see Login.jsx/Register.jsx). This is what keeps a
  // migrated account correctly logged in across reloads/new tabs, and is the
  // only thing that actually populates auth.uid() for future RLS work — the
  // localStorage cache above only ever proved someone logged in once, not that
  // they still have a valid session now.
  useEffect(() => {
    let cancelled = false
    authClient.auth.getSession().then(async ({ data }) => {
      const session = data?.session
      if (cancelled) return
      if (!session) {
        // A cached business identity with no Supabase session can only be an
        // expired one: Login.jsx routes every sign-in through
        // signInWithPassword and bails without a session, and legacy accounts
        // were backfilled to confirmed auth users — so "no session" is never a
        // legitimate state. Leaving it cached is what let the dashboard stay
        // reachable while every sbFetch fell back to the anon key, so RLS
        // denied each read with "permission denied for function
        // can_access_adr_report_row". logout() clears the cache (plus the ADR
        // draft backups) and suppresses the SIGNED_OUT bounce via loggingOut.
        if (auth) await logout({ keepUnsentReports: true })
        return
      }
      const account = await resolveAccountByEmail(session.user.email)
      if (!account || cancelled) return
      if (account.biz.is_platform_admin) {
        login(account.biz, null, { isAdmin: true, role: 'SuperAdmin' })
      } else if (account.biz.status === 'active') {
        // The account resolves to the owner's MAIN business. An owner who switched to a branch keeps it across a
        // reload, if they can still reach it (lib/locationSwitch); staff always work in their own business.
        const brand = account.staff ? account.biz : await keepReachableLocation(account.biz, auth && auth.brand, getBusinessById)
        if (cancelled) return
        login(brand, account.staff)
      }
      // A pending/suspended business with a lingering real session is a narrow
      // edge case left alone here — Login.jsx already blocks that status at
      // sign-in time; enforcing it retroactively is Phase 2 (RLS) territory.
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Listen for auth state changes — redirect to login when session expires
  useEffect(() => {
    const { data: { subscription } } = authClient.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        if (!loggingOut) {
          window.location.href = '/login'
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <Sentry.ErrorBoundary>
    <AuthProvider value={{ auth, setAuth, login, logout, isAdmin, agent, loginAgent, logoutAgent }}>
      <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <Suspense fallback={<LoadingFallback />}>
          <Routes key={location.key}>
            <Route path='/' element={<Landing />} />
            <Route path='/login' element={auth && !auth.isAdmin ? <Navigate to='/dashboard' /> : <Login />} />
            <Route path='/register' element={<Register />} />
            <Route path='/forgot-password' element={<ForgotPassword />} />
            <Route path='/reset-password' element={<ResetPassword />} />
            <Route path='/link-expired' element={<LinkExpired />} />
            <Route path='/apply-agent' element={<ApplyAgent />} />
            <Route path='/agent/login' element={agent ? <Navigate to='/agent' /> : <AgentLogin />} />
            <Route path='/agent/*' element={agent ? <AgentDashboard /> : <Navigate to='/agent/login' />} />
            <Route path='/admin' element={auth?.isAdmin ? <AdminDashboard /> : <Navigate to='/login' />} />
            <Route path='/dashboard/*' element={auth && !auth.isAdmin ? <BusinessDashboard /> : <Navigate to='/login' />} />
            <Route path='/receipt/:id' element={<ReceiptPage />} />
            <Route path='*' element={<Navigate to='/' />} />
          </Routes>
        </Suspense>
      </div>
    </AuthProvider>
    </Sentry.ErrorBoundary>
  )
}
