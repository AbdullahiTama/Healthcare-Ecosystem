import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { callAdminAuth } from './adminApi'

export default function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    try {
      const token = localStorage.getItem('admin_token')
      if (token) {
        const decoded = atob(token)
        const parts = decoded.split('|')
        if (parts.length === 3 && Date.now() - parseInt(parts[2]) < 86400000) {
          navigate('/admin-panel')
          return
        }
      }
      localStorage.removeItem('admin_token')
      localStorage.removeItem('admin_user')
    } catch {}
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token, admin } = await callAdminAuth('login', { email: email.toLowerCase(), password })
      localStorage.setItem('admin_token', token)
      localStorage.setItem('admin_user', JSON.stringify(admin))
      navigate('/admin-panel')
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0B4A3E', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #1A8A72, #0E6F5A)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24, fontWeight: 900, color: '#fff' }}>C</div>
          <h1 style={{ color: '#fff', fontSize: 22, fontWeight: 900, margin: '0 0 4px 0' }}>CareFind Admin</h1>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: 0 }}>Secure Admin Portal</p>
        </div>
        <div style={{ background: '#155A4B', borderRadius: 20, padding: 24 }}>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 700, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Admin Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@carefind.ng" required
                style={{ width: '100%', padding: 13, fontSize: 14, background: '#0B4A3E', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 700, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required
                style={{ width: '100%', padding: 13, fontSize: 14, background: '#0B4A3E', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            {error && <div style={{ background: '#fef2f2', borderRadius: 10, padding: '10px 14px' }}><p style={{ margin: 0, fontSize: 13, color: '#dc2626', fontWeight: 600 }}>⚠️ {error}</p></div>}
            <button type="submit" disabled={loading} style={{ padding: 14, background: 'linear-gradient(135deg, #1A8A72, #0E6F5A)', color: '#fff', border: 'none', borderRadius: 13, fontWeight: 800, fontSize: 15, marginTop: 4 }}>
              {loading ? 'Signing in...' : 'Sign In to Admin'}
            </button>
          </form>
        </div>
        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Restricted to authorized CareFind staff only.</p>
      </div>
    </div>
  )
}
