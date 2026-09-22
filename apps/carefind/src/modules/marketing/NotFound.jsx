import { Link, useNavigate } from 'react-router-dom'
import { Search, Home, ArrowLeft } from 'lucide-react'
import { theme } from '../../styles/theme'
import Logo from '../social-feed/Logo.jsx'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <main style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '32px 24px',
      background: theme.bg, fontFamily: theme.fontFamily, textAlign: 'center',
    }}>
      <Link to="/" aria-label="CareFind home" style={{ marginBottom: 32 }}>
        <Logo size={32} tone="dark" />
      </Link>
      <div style={{
        width: 72, height: 72, borderRadius: '50%', background: theme.cardBg,
        border: `1px solid ${theme.border}`, display: 'flex',
        alignItems: 'center', justifyContent: 'center', marginBottom: 20, color: theme.textLight,
      }}>
        <Search size={28} aria-hidden="true" />
      </div>
      <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 900, color: theme.navy, fontFamily: theme.fontDisplay, letterSpacing: '-0.02em' }}>
        Page not found
      </h1>
      <p style={{ margin: '0 0 28px', fontSize: 15, color: theme.textMid, maxWidth: 420, lineHeight: 1.6 }}>
        The page you’re looking for doesn’t exist or was moved. Check the link or head back to what matters.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="cf-press"
          style={{
            minHeight: 44, padding: '10px 20px', background: '#fff', color: theme.navy,
            border: `1px solid ${theme.border}`, borderRadius: theme.radius.full,
            cursor: 'pointer', fontSize: 14, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 8,
          }}
        >
          <ArrowLeft size={16} aria-hidden="true" /> Go back
        </button>
        <Link
          to="/feed"
          className="cf-press"
          style={{
            minHeight: 44, padding: '10px 20px', background: theme.tealDeep, color: '#fff',
            border: 'none', borderRadius: theme.radius.full, textDecoration: 'none',
            fontSize: 14, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 8,
          }}
        >
          <Home size={16} aria-hidden="true" /> Go to feed
        </Link>
        <Link
          to="/search"
          className="cf-press"
          style={{
            minHeight: 44, padding: '10px 20px', background: theme.navy, color: '#fff',
            border: 'none', borderRadius: theme.radius.full, textDecoration: 'none',
            fontSize: 14, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 8,
          }}
        >
          <Search size={16} aria-hidden="true" /> Search care
        </Link>
      </div>
    </main>
  )
}
