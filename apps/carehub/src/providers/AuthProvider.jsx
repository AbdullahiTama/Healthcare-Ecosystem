import { createContext, useContext } from 'react'

// ── AUTH CONTEXT ──────────────────────────────────────────────────────────────
// The Context object and its consumer hook live here. The provider VALUE
// itself ({ auth, setAuth, login, logout, isAdmin }) is still built in
// App.jsx, since it depends on App's own state (localStorage-backed auth,
// the Supabase session reconciliation effect, etc.) — this component just
// wraps AuthContext.Provider around whatever value App.jsx hands it.
export const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export default function AuthProvider({ value, children }) {
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
