import { Link } from 'react-router-dom'
import { MapPin, User } from 'lucide-react'
import { theme } from '../../styles/theme'

export default function MarketplaceHeader({ userCoords }) {
  return (
    <header
      role="banner"
      aria-label="CareFind marketplace header"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        background: 'linear-gradient(90deg, rgba(227,238,232,0.9) 0%, #FBFAF6 45%, #FFFFFF 100%)',
        borderBottom: `1px solid ${theme.hairline}`,
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Left: CareFind brand — text identity, not MedMarket */}
      <Link to="/feed" aria-label="CareFind home" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontFamily: theme.fontFamily,
            fontSize: 18,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            color: theme.navy,
            lineHeight: 1,
          }}
        >
          CareFind
        </span>
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: theme.tealDeep,
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
      </Link>

      {/* Right: location + profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          aria-label={userCoords ? 'Location enabled' : 'Location'}
          title={userCoords ? 'Location enabled' : 'Enable location for Near me'}
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            border: `1px solid ${theme.border}`,
            background: userCoords ? theme.tealMist : '#fff',
            color: userCoords ? theme.tealDeep : theme.textLight,
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
          }}
        >
          <MapPin size={18} strokeWidth={2.1} aria-hidden="true" />
        </button>
        <Link
          to="/profile"
          aria-label="Profile"
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            border: `1px solid ${theme.border}`,
            background: '#fff',
            color: theme.navy,
            display: 'grid',
            placeItems: 'center',
            textDecoration: 'none',
          }}
        >
          <User size={18} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
    </header>
  )
}
