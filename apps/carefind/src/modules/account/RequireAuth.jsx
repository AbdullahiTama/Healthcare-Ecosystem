import { Navigate } from 'react-router-dom'
import { useAuth } from '../../providers/AuthContext'
import { Loading } from '../../components/ui'

export default function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Loading text="Checking your session..." />
  if (!user) return <Navigate to="/login" replace />
  return children
}
