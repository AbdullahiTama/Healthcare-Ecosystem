import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { Loading } from '../../components/ui'
import { callAdminAuth, SESSION_EXPIRED_EVENT } from './adminApi'

export const AdminContext = createContext(null)

export function useAdmin() {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used inside AdminGate')
  return ctx
}

function clearAdminCache() {
  localStorage.removeItem('admin_user')
  localStorage.removeItem('admin_permissions')
}

// The client gate exists for a sensible experience only. The admin API and
// the database policies remain the authority on what an admin may do.
export function AdminGate({ children }) {
  // useNavigate returns a new function whenever the address changes. Held in a
  // ref so that moving between screens does not re-run the verify effect.
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const [state, setState] = useState({ status: 'checking', adminUser: null, permissions: {} })
  const leaving = useRef(false)

  const leave = useCallback(async ({ serverLogout = false } = {}) => {
    if (leaving.current) return
    leaving.current = true
    if (serverLogout) {
      try { await callAdminAuth('logout') } catch { /* best-effort */ }
    }
    try { await supabase.auth.signOut() } catch { /* access is denied either way */ }
    clearAdminCache()
    setState({ status: 'denied', adminUser: null, permissions: {} })
    navigateRef.current('/login', { replace: true })
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error || !session) {
          clearAdminCache()
          if (alive) { setState({ status: 'denied', adminUser: null, permissions: {} }); navigateRef.current('/login', { replace: true }) }
          return
        }
        const verified = await callAdminAuth('verify')
        if (!verified?.admin?.id) throw new Error('Could not verify admin access.')
        // A sign-out or expiry may have begun while verify was in flight.
        if (alive && !leaving.current) {
          localStorage.setItem('admin_user', JSON.stringify(verified.admin))
          localStorage.setItem('admin_permissions', JSON.stringify(verified.permissions || {}))
          setState({ status: 'ready', adminUser: verified.admin, permissions: verified.permissions || {} })
        }
      } catch {
        if (alive) leave()
      }
    })()
    return () => { alive = false }
  }, [leave])

  useEffect(() => {
    const onExpired = () => leave()
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [leave])

  const signOut = useCallback(() => leave({ serverLogout: true }), [leave])

  const value = useMemo(
    () => ({ adminUser: state.adminUser, permissions: state.permissions, signOut }),
    [state.adminUser, state.permissions, signOut],
  )

  if (state.status === 'checking') return <Loading fullScreen />
  if (state.status !== 'ready') return null
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}
