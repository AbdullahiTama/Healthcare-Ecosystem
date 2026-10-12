import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../../config/supabaseClient'
import { callAdminAuth } from '../adminApi'
import { useRealtimeChannel } from '../hooks/useRealtimeChannel'
import { ConfirmDialog, Loading, Toast, useToast } from '../../../components/ui'

// What every admin screen shares: who the admin is, what their role has
// switched off, toasts, the confirm dialog, refreshing data, and sign-out.
// The checks are the same as before the redesign. The session is verified
// against the server on mount (`verify`); `permissions` only decides what the
// UI offers, and the server remains the boundary for every action.

const AdminContext = createContext(null)

export function useAdmin() {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used inside <AdminProvider>')
  return ctx
}

function clearAdminCache() {
  localStorage.removeItem('admin_user')
  localStorage.removeItem('admin_permissions')
}

const MAX_ACTIONS = 50

export function AdminProvider({ children }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [adminUser, setAdminUser] = useState(null)
  const [permissions, setPermissions] = useState({})
  const [loading, setLoading] = useState(true)
  const [confirmState, setConfirmState] = useState(null)
  const [actionHistory, setActionHistory] = useState([])
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()
  const signingOut = useRef(false)

  const invalidateAdmin = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['admin'] })
  }, [qc])

  // Generic confirmation dialog: { title, consequence, confirmLabel, action }.
  // `action` is the real, destructive operation, deferred until the admin
  // confirms (SCREEN_PATTERNS.md pattern 29: state the consequence).
  const askConfirm = useCallback(({ title, consequence, confirmLabel = 'Delete', action }) => {
    setConfirmState({ title, consequence, confirmLabel, action })
  }, [])

  // Recent admin actions, offered to the AI Copilot as context.
  const recordAction = useCallback((entry) => {
    setActionHistory(prev => [...prev.slice(-(MAX_ACTIONS - 1)), { timestamp: new Date().toISOString(), ...entry }])
  }, [])

  const signOut = useCallback(async () => {
    if (signingOut.current) return
    signingOut.current = true
    try {
      await callAdminAuth('logout')
    } catch { /* best-effort server logout */ }
    try { await supabase.auth.signOut() } catch { /* local sign-out is best effort */ }
    clearAdminCache()
    navigate('/login')
    setTimeout(() => { signingOut.current = false }, 1000)
  }, [navigate])

  useEffect(() => {
    const verifySession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error || !session) {
          clearAdminCache()
          navigate('/login')
          return
        }

        const verified = await callAdminAuth('verify')
        const parsedAdmin = verified.admin
        if (!parsedAdmin?.id) throw new Error('Could not verify admin access.')
        localStorage.setItem('admin_user', JSON.stringify(parsedAdmin))
        localStorage.setItem('admin_permissions', JSON.stringify(verified.permissions || {}))

        setAdminUser(parsedAdmin)
        setPermissions(verified.permissions || {})
        setLoading(false)
      } catch {
        try {
          await supabase.auth.signOut()
        } catch {
          // Access is denied even if local sign-out fails.
        }
        clearAdminCache()
        setAdminUser(null)
        setPermissions({})
        setLoading(false)
        navigate('/login')
      }
    }

    verifySession()
  // Verify once per mount, as before.
  }, [])

  useEffect(() => {
    if (adminUser) invalidateAdmin()
  // Refresh the admin data once the admin is first known.
  }, [adminUser])

  useRealtimeChannel({
    channelName: 'admin-notifications',
    subscription: { schema: 'public', table: 'verification_requests' },
    onInsert: invalidateAdmin,
    onUpdate: invalidateAdmin,
    pollInterval: 30000,
    pollFn: invalidateAdmin,
  })

  useRealtimeChannel({
    channelName: 'admin-posts',
    subscription: { schema: 'public', table: 'posts' },
    onInsert: invalidateAdmin,
    pollInterval: 30000,
    pollFn: invalidateAdmin,
  })

  useRealtimeChannel({
    channelName: 'admin-reports',
    subscription: { schema: 'public', table: 'reports' },
    onInsert: invalidateAdmin,
    onUpdate: invalidateAdmin,
    pollInterval: 30000,
    pollFn: invalidateAdmin,
  })

  useRealtimeChannel({
    channelName: 'admin-news',
    subscription: { schema: 'public', table: 'news', filter: 'status=eq.pending' },
    onInsert: invalidateAdmin,
    onUpdate: invalidateAdmin,
    pollInterval: 30000,
    pollFn: invalidateAdmin,
  })

  const value = useMemo(() => ({
    adminUser, permissions, showToast, askConfirm, invalidateAdmin, signOut, recordAction, actionHistory,
  }), [adminUser, permissions, showToast, askConfirm, invalidateAdmin, signOut, recordAction, actionHistory])

  // Fail closed: nothing of the admin renders without a server-verified admin,
  // including the instant before a failed verification redirects to /login.
  if (loading || !adminUser) return <Loading fullScreen aria-live="polite" aria-busy="true" />

  return (
    <AdminContext.Provider value={value}>
      {children}
      <ConfirmDialog
        show={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { const action = confirmState?.action; setConfirmState(null); if (action) action() }}
        title={confirmState?.title}
        consequence={confirmState?.consequence}
        confirmLabel={confirmState?.confirmLabel || 'Delete'}
      />
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </AdminContext.Provider>
  )
}
