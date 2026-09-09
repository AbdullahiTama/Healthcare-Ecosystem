import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { callAdminAuth } from './adminApi'
import { theme } from '../../styles/theme'
import { Shield, Eye, EyeOff, AlertCircle } from 'lucide-react'

export default function AdminLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) {
      setError('Please enter both email and password')
      return
    }

    setLoading(true)
    setError('')

    try {
      const { token, admin, permissions } = await callAdminAuth('login', { email, password })
      
      localStorage.setItem('admin_token', token)
      localStorage.setItem('admin_user', JSON.stringify(admin))
      if (permissions) {
        localStorage.setItem('admin_permissions', JSON.stringify(permissions))
      }

      navigate('/admin/dashboard')
    } catch (err) {
      setError(err.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: theme.bg,
      padding: 20,
      fontFamily: theme.fontFamily,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
      }}>
        <div style={{
          textAlign: 'center',
          marginBottom: 32,
        }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: theme.heroGradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: theme.elevation[2],
          }}>
            <Shield size={28} color="#fff" strokeWidth={2.2} />
          </div>
          <h1 style={{
            fontSize: theme.typography.h1.size,
            fontWeight: theme.typography.h1.weight,
            color: theme.navy,
            margin: '0 0 6px',
            letterSpacing: theme.typography.h1.tracking,
          }}>
            CareFind Admin
          </h1>
          <p style={{
            fontSize: theme.typography.body.color,
            color: theme.textMid,
            margin: 0,
          }}>
            Platform management console
          </p>
        </div>

        <div style={{
          background: theme.cardBg,
          borderRadius: theme.radius.lg,
          padding: 28,
          boxShadow: theme.elevation[1],
          border: `1px solid ${theme.border}`,
        }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label style={{
                display: 'block',
                fontSize: theme.typography.caption.size,
                fontWeight: theme.typography.caption.weight,
                color: theme.textMid,
                marginBottom: 8,
                letterSpacing: theme.typography.caption.tracking,
                textTransform: 'uppercase',
              }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@carefind.ng"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  fontSize: theme.typography.body.size,
                  border: `1px solid ${theme.border}`,
                  borderRadius: theme.radius.md,
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: `border-color ${theme.motion.fast}`,
                  background: theme.bg,
                  color: theme.textDark,
                }}
                onFocus={(e) => e.target.style.borderColor = theme.tealDeep}
                onBlur={(e) => e.target.style.borderColor = theme.border}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{
                display: 'block',
                fontSize: theme.typography.caption.size,
                fontWeight: theme.typography.caption.weight,
                color: theme.textMid,
                marginBottom: 8,
                letterSpacing: theme.typography.caption.tracking,
                textTransform: 'uppercase',
              }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '12px 44px 12px 14px',
                    fontSize: theme.typography.body.size,
                    border: `1px solid ${theme.border}`,
                    borderRadius: theme.radius.md,
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: `border-color ${theme.motion.fast}`,
                    background: theme.bg,
                    color: theme.textDark,
                  }}
                  onFocus={(e) => e.target.style.borderColor = theme.tealDeep}
                  onBlur={(e) => e.target.style.borderColor = theme.border}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                    color: theme.textLight,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '12px 14px',
                background: theme.dangerBg,
                borderRadius: theme.radius.md,
                marginBottom: 20,
                border: `1px solid ${theme.dangerBorder}`,
              }}>
                <AlertCircle size={16} color={theme.alert} style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{
                  margin: 0,
                  fontSize: theme.typography.bodySm.size,
                  color: theme.alert,
                  fontWeight: theme.typography.bodySm.weight,
                  lineHeight: 1.4,
                }}>
                  {error}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '13px 20px',
                fontSize: theme.typography.body.fontWeight,
                fontWeight: 700,
                background: loading ? theme.textLight : theme.tealGradient,
                color: '#fff',
                border: 'none',
                borderRadius: theme.radius.md,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: `all ${theme.motion.fast}`,
                boxShadow: theme.elevation[1],
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p style={{
          textAlign: 'center',
          marginTop: 24,
          fontSize: theme.typography.caption.size,
          color: theme.textLight,
        }}>
          Authorized personnel only
        </p>
      </div>
    </div>
  )
}
