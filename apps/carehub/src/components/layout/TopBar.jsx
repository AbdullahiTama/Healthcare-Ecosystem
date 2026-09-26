import { Avatar } from '../ui'
import { useAuth } from '../../providers/AuthProvider'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import BranchSwitcher from './BranchSwitcher'
import { PageHeader } from '@care-ecosystem/design-system/components/layout/PageHeader'
import { MOBILE_MENU_LEFT, MOBILE_MENU_SIZE } from './shellConstants'

// `onMenuClick` is accepted but intentionally not rendered here — the shell
// (BusinessDashboard.jsx) renders one floating menu trigger that works
// uniformly across every route, including the handful (POS, Warehouses,
// Territories, Messages, Stock, Orders, Activity) that don't render TopBar
// at all. A second, TopBar-local button would either duplicate that one or
// leave those other routes without any trigger, so this stays a single
// global affordance rather than a per-header one.
//
// Mobile left clearance (12 + 44 + 8 = 64px) comes from shellConstants.js —
// the same MOBILE_MENU_* geometry BusinessDashboard uses, so the trigger and
// the clearance can never drift apart.
export default function TopBar({ title, brand, role }) {
  const { auth } = useAuth()
  const { isMobile } = useBreakpoint()
  const userName = auth?.staff ? auth.staff.full_name : (brand?.owner || 'Owner')

  return (
    <PageHeader
      compact
      title={title}
      rightSlot={
        <>
          <BranchSwitcher />
          {role && role !== 'Owner' && (
            <span style={{ padding: '4px 10px', borderRadius: '8px', background: theme.tealMist, color: theme.tealDeep, fontSize: '11px', fontWeight: '700' }}>
              {role}
            </span>
          )}
          <Avatar name={userName} size={34} />
        </>
      }
      style={isMobile ? { paddingLeft: MOBILE_MENU_LEFT + MOBILE_MENU_SIZE + 8, paddingRight: 16 } : undefined}
    />
  )
}