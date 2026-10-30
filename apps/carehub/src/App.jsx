import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Landing from './pages/Landing'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import AcceptInvite from './pages/auth/AcceptInvite'
import AdminDashboard from './pages/admin/AdminDashboard'
import BusinessDashboard from './pages/dashboard/BusinessDashboard'
import AgentLogin from './pages/agent/AgentLogin'
import ApplyAgent from './pages/agent/ApplyAgent'
import AgentDashboard from './modules/referral-agent/AgentDashboard'
import { authClient } from './lib/authClient'
import { resolveAccountByEmail } from './services/supabase'
import AuthProvider from './providers/AuthProvider'

export default function App() {
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

  // Shown on the login page when the session ended on its own (revoked,
  // refresh refused) rather than because this user clicked Log out.
  const [sessionNotice, setSessionNotice] = useState(null)

  const login = (brand, staff = null, extra = {}) => {
    const authData = { brand, staff, role: staff ? staff.role : 'Owner', loginTime: Date.now(), ...extra }
    setAuth(authData)
    setSessionNotice(null)
    localStorage.setItem('carehub_auth', JSON.stringify(authData))
  }

  // scope 'local' revokes THIS device's session only. The default ('global')
  // revoked every session of the account, and shops commonly sign several
  // tills into one account: one cashier logging out signed every other till
  // out at its next token refresh, mid-shift (production logs, 2026-10-29).
  const logout = () => {
    setAuth(null)
    localStorage.removeItem('carehub_auth')
    authClient.auth.signOut({ scope: 'local' }).catch(() => {})
  }

  const loginAgent = (agentRow) => {
    setAgent(agentRow)
    localStorage.setItem('carehub_agent_auth', JSON.stringify(agentRow))
  }

  const logoutAgent = () => {
    setAgent(null)
    localStorage.removeItem('carehub_agent_auth')
    authClient.auth.signOut({ scope: 'local' }).catch(() => {})
  }

  // The Supabase session is the source of truth; carehub_auth and
  // carehub_agent_auth are only caches of who it belongs to. When it ends,
  // drop both so the routes send the user to sign in, instead of leaving a
  // dashboard whose every request is refused. That includes a Log out in
  // another tab, which clears the shared cache but not this tab's state.
  // The notice is only for a session that ended on its own: an explicit
  // Log out clears the cache before signing out, so it finds nothing here.
  // Reads localStorage and uses setters only, so it is safe from any closure.
  const endExpiredSession = () => {
    const endedOnItsOwn = !!localStorage.getItem('carehub_auth') || !!localStorage.getItem('carehub_agent_auth')
    localStorage.removeItem('carehub_auth')
    localStorage.removeItem('carehub_agent_auth')
    setAuth(null)
    setAgent(null)
    if (endedOnItsOwn) {
      console.warn('[session] the Supabase session ended; returning to sign in')
      setSessionNotice('Your session has ended. Please sign in again.')
    }
  }

  useEffect(() => {
    // Only sets state: supabase-js warns against awaiting its own calls
    // inside this callback.
    const { data } = authClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') endExpiredSession()
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const isAdmin = () => auth?.isAdmin === true

  // Reconciles with a real Supabase Auth session on load, for accounts that have
  // already been migrated (see Login.jsx/Register.jsx). This is what keeps a
  // migrated account correctly logged in across reloads/new tabs, and is the
  // only thing that actually populates auth.uid() for future RLS work — the
  // localStorage cache above only ever proved someone logged in once, not that
  // they still have a valid session now.
  useEffect(() => {
    let cancelled = false
    authClient.auth.getSession().then(async ({ data, error }) => {
      const session = data?.session
      if (cancelled) return
      if (!session) {
        // No session and no error: signed out for good while the tab was
        // closed or discarded. An error means we could not reach the server
        // (still offline after waking): keep the cache, and requests renew
        // the session once the connection is back.
        if (!error) endExpiredSession()
        return
      }
      const account = await resolveAccountByEmail(session.user.email)
      if (!account || cancelled) return
      if (account.biz.is_platform_admin) {
        login(account.biz, null, { isAdmin: true, role: 'SuperAdmin' })
      } else if (account.biz.status === 'active') {
        login(account.biz, account.staff)
      }
      // A pending/suspended business with a lingering real session is a narrow
      // edge case left alone here — Login.jsx already blocks that status at
      // sign-in time; enforcing it retroactively is Phase 2 (RLS) territory.
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  return (
    <AuthProvider value={{ auth, setAuth, login, logout, isAdmin, agent, loginAgent, logoutAgent, sessionNotice }}>
      <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <Routes>
          <Route path='/' element={<Landing />} />
          <Route path='/login' element={auth && !auth.isAdmin ? <Navigate to='/dashboard' /> : <Login />} />
          <Route path='/register' element={<Register />} />
          <Route path='/apply-agent' element={<ApplyAgent />} />
          {/* Public: staff invitation links. Deliberately not redirected when
              signed in — the page handles a session for someone else. */}
          <Route path='/accept-invite' element={<AcceptInvite />} />
          <Route path='/agent/login' element={agent ? <Navigate to='/agent' /> : <AgentLogin />} />
          <Route path='/agent/*' element={agent ? <AgentDashboard /> : <Navigate to='/agent/login' />} />
          <Route path='/admin' element={auth?.isAdmin ? <AdminDashboard /> : <Navigate to='/login' />} />
          <Route path='/dashboard/*' element={auth && !auth.isAdmin ? <BusinessDashboard /> : <Navigate to='/login' />} />
          <Route path='*' element={<Navigate to='/' />} />
        </Routes>
      </div>
    </AuthProvider>
  )
}
