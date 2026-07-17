import { Navigate } from 'react-router-dom'
import { useAuth } from '../../providers/AuthContext'

// Route-level guard for CareFind's consumer routes. Most pages already
// redirect/block internally when logged out (see Dashboard.jsx, Profile.jsx,
// etc.) — this makes that consistent and enforced at the router instead of
// per-page, and closes two pages (PlaylistCreate.jsx, ProfessionalMonetization.jsx)
// that had no such check at all and would crash on `user.id` for a logged-out visitor.
export default function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null // AuthProvider is still resolving the initial session — avoid a flash-redirect
  if (!user) return <Navigate to="/login" replace />
  return children
}
