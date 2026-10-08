import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { supabase } from '../config/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const loggingOut = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session ? data.session.user : null)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session ? session.user : null)
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  async function signUp(email, password, metadata = {}) {
    const result = await supabase.auth.signUp({ email, password, options: { data: metadata } })
    // Fire the templated welcome email (enqueue + flush via /api/auth-email).
    // Never block signup on email delivery.
    if (!result.error) {
      const fullName = metadata?.full_name || metadata?.name || ''
      const actions = ['customer_registration']
      if (!result.data?.session) {
        // Email confirmation is required — send our templated verification
        // email instead of Supabase's built-in confirmation.
        actions.push('email_verification')
      }
      for (const action of actions) {
        const payload = { action, email, fullName }
        if (action === 'email_verification') {
          payload.redirectTo = `${window.location.origin}/verify-email`
        }
        fetch('/api/auth-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {})
      }
    }
    return result
  }

  async function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password })
  }

  async function resetPassword(email) {
    // Reset link is minted server-side via admin.generateLink and delivered as
    // a templated email. Redirects back to the in-app reset page, which swaps
    // in the new-password form when Supabase fires PASSWORD_RECOVERY on load.
    try {
      const resp = await fetch('/api/auth-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'password_reset',
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        }),
      })
      if (!resp.ok) return { error: new Error('Could not send reset link') }
      return { error: null }
    } catch (e) {
      return { error: e }
    }
  }

  async function updatePassword(newPassword) {
    return supabase.auth.updateUser({ password: newPassword })
  }

  async function signOut() {
    if (loggingOut.current) return
    loggingOut.current = true
    try { return await supabase.auth.signOut() } finally { loggingOut.current = false }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, resetPassword, updatePassword, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
