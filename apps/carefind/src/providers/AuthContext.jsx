import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../config/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

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
    return supabase.auth.signUp({ email, password, options: { data: metadata } })
  }

  async function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password })
  }

  async function resetPassword(email) {
    // Redirect back to the in-app reset page, which swaps in the new-password
    // form when Supabase fires the PASSWORD_RECOVERY event on load.
    return supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
  }

  async function updatePassword(newPassword) {
    return supabase.auth.updateUser({ password: newPassword })
  }

  async function signOut() {
    return supabase.auth.signOut()
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
