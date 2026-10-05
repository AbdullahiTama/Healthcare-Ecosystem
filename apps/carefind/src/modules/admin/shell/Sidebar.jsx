import { NavLink } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen, LogOut, AlertTriangle, X } from 'lucide-react'
import Logo from '../../social-feed/Logo'
import { theme } from '../../../styles/theme'
import { useAdmin } from '../AdminGate.jsx'
import { visibleGroups, pathFor } from '../navigation'

export const NAV_WIDTH = 256
export const NAV_COLLAPSED_WIDTH = 64

const iconButton = {
  width: 32, height: 32, borderRadius: theme.radius.md, border: `1px solid ${theme.border}`,
  background: theme.cardBg, cursor: 'pointer', display: 'flex', alignItems: 'center',
  justifyContent: 'center', color: theme.textMid, flexShrink: 0,
}

function NavItem({ item, count, collapsed, onNavigate }) {
  const Icon = item.icon
  const hasCount = typeof count === 'number' && count > 0
  const name = hasCount ? `${item.label}, ${count} pending` : item.label
  return (
    <NavLink
      to={pathFor(item.key)}
      end={item.path === ''}
      aria-label={name}
      title={collapsed ? name : undefined}
      onClick={onNavigate}
      className="cf-admin-nav-item"
      style={({ isActive }) => ({
        position: 'relative', display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10,
        justifyContent: collapsed ? 'center' : 'flex-start',
        padding: collapsed ? '10px 0' : '8px 12px', marginBottom: 2,
        borderRadius: theme.radius.md, textDecoration: 'none', fontSize: 13, fontWeight: 600,
        background: isActive ? theme.tealMist : 'transparent',
        color: isActive ? theme.tealDeep : theme.textMid,
      })}
    >
      <Icon size={16} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0 }} />
      {!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>}
      {hasCount && !collapsed && (
        <span aria-hidden="true" style={{ minWidth: 20, padding: '1px 7px', borderRadius: theme.radius.full, background: theme.warningBg, color: theme.warning, fontSize: 11, fontWeight: 800, textAlign: 'center' }}>
          {count > 99 ? '99+' : count}
        </span>
      )}
      {hasCount && collapsed && (
        <span aria-hidden="true" style={{ position: 'absolute', top: 5, right: 12, width: 8, height: 8, borderRadius: '50%', background: theme.warning }} />
      )}
    </NavLink>
  )
}

export default function Sidebar({ collapsed, onToggleCollapse, counts = {}, countsFailed = false, isMobile, mobileOpen, onCloseMobile }) {
  const admin = useAdmin()
  const { adminUser, signOut } = admin
  const groups = visibleGroups(admin)
  const isCollapsed = !isMobile && collapsed

  if (isMobile && !mobileOpen) return null

  const panel = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: isMobile ? NAV_WIDTH : '100%', maxWidth: '86vw', background: theme.cardBg, borderRight: `1px solid ${theme.border}`, boxSizing: 'border-box' }}>
      <div style={{ padding: isCollapsed ? '14px 8px' : '14px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'space-between', gap: 8 }}>
        {!isCollapsed && <Logo size={26} />}
        {isMobile ? (
          <button onClick={onCloseMobile} aria-label="Close menu" style={iconButton}><X size={16} aria-hidden="true" /></button>
        ) : (
          <button onClick={onToggleCollapse} aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} style={iconButton}>
            {isCollapsed ? <PanelLeftOpen size={15} aria-hidden="true" /> : <PanelLeftClose size={15} aria-hidden="true" />}
          </button>
        )}
      </div>

      <nav aria-label="Admin" style={{ flex: 1, overflowY: 'auto', padding: isCollapsed ? '8px 6px' : '8px 10px' }}>
        {groups.map((group, gi) => (
          <div key={group.id} style={{ marginBottom: 4 }}>
            {!isCollapsed && group.label && (
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: theme.textLight, padding: '12px 12px 4px' }}>
                {group.label}
              </div>
            )}
            {isCollapsed && gi > 0 && <div style={{ height: 1, background: theme.border, margin: '6px 0' }} />}
            {group.screens.map(item => (
              <NavItem key={item.key} item={item} collapsed={isCollapsed} count={item.countKey ? counts[item.countKey] : null} onNavigate={isMobile ? onCloseMobile : undefined} />
            ))}
          </div>
        ))}
      </nav>

      {countsFailed && !isCollapsed && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 11, color: theme.warning, borderTop: `1px solid ${theme.border}` }}>
          <AlertTriangle size={13} aria-hidden="true" /> Some counts could not be loaded
        </div>
      )}

      <div style={{ padding: isCollapsed ? '10px 6px' : '10px 12px', borderTop: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8, justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
        {!isCollapsed && (
          <>
            <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: '50%', background: theme.tealMist, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: theme.tealDeep, flexShrink: 0 }}>
              {(adminUser?.full_name || 'A')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: theme.textDark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{adminUser?.full_name || 'Admin'}</div>
              <div style={{ fontSize: 10.5, color: theme.textLight }}>{adminUser?.role?.replace(/_/g, ' ') || 'admin'}</div>
            </div>
          </>
        )}
        <button onClick={signOut} aria-label="Sign out" style={{ ...iconButton, border: 'none', background: 'none' }}><LogOut size={16} aria-hidden="true" /></button>
      </div>
    </div>
  )

  if (!isMobile) return panel

  return (
    <>
      <div onClick={onCloseMobile} style={{ position: 'fixed', inset: 0, background: theme.overlay, zIndex: 200 }} />
      <div style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 201 }}>{panel}</div>
    </>
  )
}
