import { Avatar } from '../ui'
import { useAuth } from '../../providers/AuthProvider'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'

// `onMenuClick` is accepted but intentionally not rendered here — the shell
// (BusinessDashboard.jsx) renders one floating menu trigger that works
// uniformly across every route, including the handful (POS, Warehouses,
// Territories, Messages, Stock, Orders, Activity) that don't render TopBar
// at all. A second, TopBar-local button would either duplicate that one or
// leave those other routes without any trigger, so this stays a single
// global affordance rather than a per-header one.
export default function TopBar({ title, brand, role }) {
  const { auth } = useAuth()
  const { isMobile } = useBreakpoint()
  const userName = auth?.staff ? auth.staff.full_name : (brand?.owner || 'Owner')

  return (
    <header role="banner" style={{ background: theme.cardBg, borderBottom: `1px solid ${theme.border}`, padding: isMobile ? '12px 16px 12px 52px' : '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: 12 }}>
      <h1 style={{ fontWeight: '800', fontSize: '16px', color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, margin: 0 }}>{title}</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        {role && role !== 'Owner' && (
          <span style={{ padding: '4px 10px', borderRadius: '8px', background: theme.tealMist, color: theme.tealDeep, fontSize: '11px', fontWeight: '700' }}>
            {role}
          </span>
        )}
        <Avatar name={userName} size={34} />
      </div>
    </header>
  )
}
