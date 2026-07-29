import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../providers/AuthProvider'
import { getNavItems } from '../../lib/permissions'
import { businessName } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import NotificationBell from './NotificationBell'
import { Logo, Avatar } from '../ui'
import { X, LogOut } from 'lucide-react'

const { tealDeep, tealMist, border, gray600, gray400, navy } = theme

// Collapse behavior (docs/design/NAVIGATION.md):
//  - Laptop/Desktop/Large Desktop: persistent full sidebar (icon + label), unchanged.
//  - Tablet: icon-only rail — labels hidden, tooltips via title attr. CareHub's
//    screens skew toward dense tables (Inventory, Billing, queues), which is
//    exactly the case NAVIGATION.md calls out for a rail over a drawer: the
//    content area needs the reclaimed width more than the labels are needed.
//  - Mobile: off-canvas drawer only, closed by default, opened via TopBar's
//    hamburger (RESPONSIVENESS.md — CareHub does not persist a nav rail at
//    a width with no room to spare).
export default function Sidebar({ brand, role, mobileOpen, onClose }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { auth, logout } = useAuth()
  const { isMobile, isTablet } = useBreakpoint()
  const userName = auth?.staff?.full_name || brand?.owner || 'Owner'
  const bType = brand?.business_type || brand?.type || 'skincare'
  const navItems = getNavItems(role, bType)
  const current = location.pathname.split('/').pop() || 'dashboard'
  const collapsed = isTablet

  function go(id) {
    navigate('/dashboard/' + id)
    if (isMobile) onClose?.()
  }

  const content = (
    <div style={{ width: isMobile ? '100%' : collapsed ? '64px' : '210px', flexShrink: 0, background: 'white', borderRight: `1px solid ${border}`, display: 'flex', flexDirection: 'column', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {/* Brand header */}
      <div style={{ padding: collapsed ? '16px 8px' : '16px 14px', borderBottom: `1px solid ${border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: collapsed ? 'center' : 'flex-start' }}>
          <Logo size={36} />
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <div style={{ color: navy, fontWeight: '800', fontSize: '13px', lineHeight: '1.3' }}>
                CareHub
              </div>
              <div style={{ color: tealDeep, fontSize: '10.5px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {brand?.name || businessName(bType)}
              </div>
            </div>
          )}
          {isMobile && (
            <button onClick={onClose} aria-label="Close menu" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: gray400, cursor: 'pointer', padding: '4px 6px', display: 'flex' }}>
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: collapsed ? '8px 6px' : '8px' }}>
        {!collapsed && (
          <div style={{ marginBottom: '6px' }}>
            <NotificationBell brand={brand} />
          </div>
        )}

        {navItems.map(([id, Icon, label]) => {
          const active = current === id || (id === 'dashboard' && current === 'dashboard')
          return (
            <button key={id} onClick={() => go(id)} title={collapsed ? label : undefined}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                padding: collapsed ? '10px 0' : '9px 10px', justifyContent: collapsed ? 'center' : 'flex-start',
                borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: '600', fontSize: '12px',
                marginBottom: '1px', textAlign: 'left', boxSizing: 'border-box',
                background: active ? tealMist : 'transparent', color: active ? tealDeep : gray600,
              }}>
              <Icon size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
              {!collapsed && label}
              {!collapsed && id === 'carefind' && (brand?.visible_on_carefind || brand?.visibleOnCareFind) && (
                <span style={{ marginLeft: 'auto', width: '6px', height: '6px', borderRadius: '50%', background: tealDeep }} />
              )}
            </button>
          )
        })}
      </nav>

      {/* Footer — signed-in identity (avatar + name + role) with Sign Out,
          matching the dashboard template. Collapsed rail shows just the avatar
          and a sign-out icon, both with tooltips. */}
      <div style={{ padding: collapsed ? '10px 6px' : '10px 12px', borderTop: `1px solid ${border}` }}>
        {collapsed ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <Avatar name={userName} size={30} />
            <button onClick={logout} title='Sign Out' aria-label='Sign Out' style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', color: gray400 }}>
              <LogOut size={15} />
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={userName} size={34} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '12.5px', fontWeight: '800', color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
              <div style={{ fontSize: '10.5px', color: gray400 }}>{role || 'Owner'}</div>
            </div>
            <button onClick={logout} title='Sign Out' aria-label='Sign Out' style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', color: gray400, flexShrink: 0, padding: 4 }}>
              <LogOut size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  )

  if (!isMobile) return content

  // Mobile: off-canvas drawer over a backdrop, closed unless mobileOpen.
  if (!mobileOpen) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex' }}>
      <button onClick={onClose} aria-label="Close navigation" style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.5)', border: 'none', cursor: 'pointer', width: '100%' }} />
      <div style={{ position: 'relative', height: '100%', width: '240px', maxWidth: '80vw' }}>
        {content}
      </div>
    </div>
  )
}
