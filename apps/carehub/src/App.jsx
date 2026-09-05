import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Landing from './pages/Landing'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import AdminDashboard from './pages/admin/AdminDashboard'
import BusinessDashboard from './pages/dashboard/BusinessDashboard'
import AgentLogin from './pages/agent/AgentLogin'
import ApplyAgent from './pages/agent/ApplyAgent'
import AgentDashboard from './modules/referral-agent/AgentDashboard'
import ReceiptPage from './pages/ReceiptPage'
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

  const login = (brand, staff = null, extra = {}) => {
    const authData = { brand, staff, role: staff ? staff.role : 'Owner', loginTime: Date.now(), ...extra }
    setAuth(authData)
    localStorage.setItem('carehub_auth', JSON.stringify(authData))
  }

  const logout = () => {
    setAuth(null)
    localStorage.removeItem('carehub_auth')
    authClient.auth.signOut().catch(() => {})
  }

  const loginAgent = (agentRow) => {
    setAgent(agentRow)
    localStorage.setItem('carehub_agent_auth', JSON.stringify(agentRow))
  }

  const logoutAgent = () => {
    setAgent(null)
    localStorage.removeItem('carehub_agent_auth')
    authClient.auth.signOut().catch(() => {})
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
      if (!session || cancelled) return
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
    <AuthProvider value={{ auth, setAuth, login, logout, isAdmin, agent, loginAgent, logoutAgent }}>
      <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <Routes>
          <Route path='/' element={<Landing />} />
          <Route path='/login' element={auth && !auth.isAdmin ? <Navigate to='/dashboard' /> : <Login />} />
          <Route path='/register' element={<Register />} />
          <Route path='/forgot-password' element={<ForgotPassword />} />
          <Route path='/reset-password' element={<ResetPassword />} />
          <Route path='/apply-agent' element={<ApplyAgent />} />
          <Route path='/agent/login' element={agent ? <Navigate to='/agent' /> : <AgentLogin />} />
          <Route path='/agent/*' element={agent ? <AgentDashboard /> : <Navigate to='/agent/login' />} />
          <Route path='/admin' element={auth?.isAdmin ? <AdminDashboard /> : <Navigate to='/login' />} />
          <Route path='/dashboard/*' element={auth && !auth.isAdmin ? <BusinessDashboard /> : <Navigate to='/login' />} />
          <Route path='/receipt/:id' element={<ReceiptPage />} />
          <Route path='*' element={<Navigate to='/' />} />
        </Routes>
      </div>
    </AuthProvider>
  )
}
