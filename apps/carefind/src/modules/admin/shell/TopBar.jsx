import { Link } from 'react-router-dom'
import { Menu, Search, Bell } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { useAdmin } from '../AdminGate.jsx'
import { ALERTS, canAccess, pathFor } from '../navigation'

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)

const square = {
  width: 40, height: 40, borderRadius: theme.radius.md, border: `1px solid ${theme.border}`,
  background: theme.cardBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: theme.textMid, cursor: 'pointer', flexShrink: 0, position: 'relative', textDecoration: 'none',
}

export default function TopBar({ isMobile, onOpenMenu, onOpenSearch, alertsCount = 0 }) {
  const admin = useAdmin()
  const showBell = canAccess(ALERTS, admin)
  return (
    <div style={{ height: 56, display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '0 12px' : '0 20px', background: theme.cardBg, borderBottom: `1px solid ${theme.border}`, boxSizing: 'border-box' }}>
      {isMobile && (
        <button onClick={onOpenMenu} aria-label="Open menu" style={square}><Menu size={18} aria-hidden="true" /></button>
      )}
      <button
        onClick={onOpenSearch}
        aria-label="Search the admin console"
        style={{ flex: 1, maxWidth: 420, height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, background: theme.bg, color: theme.textLight, fontSize: 13, cursor: 'pointer', fontFamily: theme.fontFamily, textAlign: 'left' }}
      >
        <Search size={15} aria-hidden="true" />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Search screens and actions…</span>
        {!isMobile && (
          <span aria-hidden="true" style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 6px', borderRadius: theme.radius.sm, border: `1px solid ${theme.border}`, background: theme.cardBg }}>
            {isMac ? '⌘K' : 'Ctrl K'}
          </span>
        )}
      </button>
      <div style={{ flex: 1 }} />
      {showBell && (
        <Link to={pathFor(ALERTS.key)} aria-label={alertsCount > 0 ? `Alerts, ${alertsCount} pending` : 'Alerts'} style={square}>
          <Bell size={17} aria-hidden="true" />
          {alertsCount > 0 && (
            <span aria-hidden="true" style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: theme.danger, color: 'white', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
              {alertsCount > 99 ? '99+' : alertsCount}
            </span>
          )}
        </Link>
      )}
    </div>
  )
}
