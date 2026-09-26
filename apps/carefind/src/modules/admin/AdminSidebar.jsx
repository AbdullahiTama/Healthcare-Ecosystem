import { useState, useEffect } from 'react'
import {
  LayoutDashboard, UserCheck, Flag, FileText, Image, Newspaper, Radio,
  ShoppingBag, DollarSign, Landmark, Building2, Users, Shield,
  Pill, ClipboardList, Target, Search, Bell, LogOut, Menu, X,
  ChevronDown, Settings, Mail, Layers, ClipboardCheck, AlertTriangle,
  PanelLeftClose, PanelLeftOpen, Command,
} from 'lucide-react'
import Logo from '../social-feed/Logo'

const NAV_GROUPS = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { key: 'overview', label: 'Dashboard', icon: LayoutDashboard },
      { key: 'notifications', label: 'Alerts', icon: Bell },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    items: [
      { key: 'moderation', label: 'Moderation Queue', icon: Layers },
      { key: 'verifications', label: 'Verifications', icon: UserCheck },
      { key: 'reports', label: 'Reports', icon: Flag },
      { key: 'posts', label: 'Posts', icon: FileText },
      { key: 'stories', label: 'Stories', icon: Image },
      { key: 'news', label: 'News', icon: Newspaper },
      { key: 'golive', label: 'Go Live', icon: Radio },
    ],
  },
  {
    id: 'commerce',
    label: 'Commerce',
    items: [
      { key: 'shop', label: 'Shop', icon: ShoppingBag },
      { key: 'revenue', label: 'Revenue', icon: DollarSign },
      { key: 'orders', label: 'Orders', icon: ClipboardCheck },
      { key: 'withdrawals', label: 'Withdrawals', icon: Landmark },
      { key: 'businesses', label: 'Companies', icon: Building2 },
    ],
  },
  {
    id: 'users',
    label: 'Users',
    items: [
      { key: 'users', label: 'Users', icon: Users },
      { key: 'claims', label: 'Claims', icon: Shield },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { key: 'audit_log', label: 'Audit Log', icon: ClipboardCheck },
      { key: 'errors', label: 'Errors', icon: AlertTriangle },
      { key: 'teams', label: 'Teams', icon: Users },
      { key: 'drugs', label: 'Drug Intel', icon: Pill },
      { key: 'tasks', label: 'Tasks', icon: ClipboardList },
      { key: 'promotions', label: 'Promotions', icon: Target },
      { key: 'searches', label: 'Searches', icon: Search },
      { key: 'email_templates', label: 'Email Templates', icon: Mail },
    ],
  },
]

export { NAV_GROUPS }

const EXPANDED_WIDTH = 256
const COLLAPSED_WIDTH = 64

export default function AdminSidebar({
  activeTab,
  onTabChange,
  adminUser,
  permissions,
  notifCount,
  onSignOut,
  collapsed,
  onToggleCollapse,
  onOpenCmdPalette,
}) {
  const [isMobile, setIsMobile] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const upd = () => setIsMobile(mq.matches)
    upd()
    mq.addEventListener ? mq.addEventListener('change', upd) : mq.addListener(upd)
    return () => mq.removeEventListener ? mq.removeEventListener('change', upd) : mq.removeListener(upd)
  }, [])

  const filteredGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => permissions[item.key] !== false),
  })).filter(group => group.items.length > 0)

  function getBadgeCount(key) {
    if (key === 'notifications') return notifCount
    return null
  }

  function NavItem({ item, isCollapsed }) {
    const active = activeTab === item.key
    const badge = getBadgeCount(item.key)
    const Icon = item.icon

    return (
      <button
        onClick={() => {
          onTabChange(item.key)
          if (isMobile) setDrawerOpen(false)
        }}
        title={isCollapsed ? item.label : undefined}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: isCollapsed ? 0 : 10,
          justifyContent: isCollapsed ? 'center' : 'flex-start',
          padding: isCollapsed ? '10px 0' : '9px 12px',
          borderRadius: 10,
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 13,
          textAlign: 'left',
          boxSizing: 'border-box',
          marginBottom: 2,
          background: active ? 'var(--teal)' : 'transparent',
          color: active ? 'white' : 'var(--muted)',
          transition: 'background 140ms ease-out',
        }}
      >
        <Icon size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
        {!isCollapsed && (
          <>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.label}
            </span>
            {badge != null && badge > 0 && (
              <span style={{
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                background: 'var(--red)',
                color: 'white',
                fontSize: 9,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 5px',
              }}>
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </>
        )}
        {isCollapsed && badge != null && badge > 0 && (
          <span style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--red)',
          }} />
        )}
      </button>
    )
  }

  function SidebarContent({ isCollapsed }) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: isCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
        background: 'var(--panel)',
        borderRight: '1px solid var(--border)',
        boxSizing: 'border-box',
        transition: 'width 200ms cubic-bezier(0.16,1,0.3,1)',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        {/* Logo + collapse toggle */}
        <div style={{
          padding: isCollapsed ? '16px 8px' : '16px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'space-between',
        }}>
          {isCollapsed ? (
            <Logo size={28} markOnly />
          ) : (
            <Logo size={26} />
          )}
          {!isCollapsed && (
            <button
              onClick={onToggleCollapse}
              title="Collapse sidebar"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--panel)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--muted)',
                flexShrink: 0,
              }}
            >
              <PanelLeftClose size={14} />
            </button>
          )}
          {isCollapsed && (
            <button
              onClick={onToggleCollapse}
              title="Expand sidebar"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--panel)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--muted)',
                flexShrink: 0,
                position: 'absolute',
                top: 16,
                right: -14,
                zIndex: 10,
              }}
            >
              <PanelLeftOpen size={14} />
            </button>
          )}
        </div>

        {/* Cmd+K hint */}
        {!isCollapsed && (
          <button
            onClick={onOpenCmdPalette}
            style={{
              margin: '8px 10px',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--panel)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--muted)',
              fontSize: 12,
              fontWeight: 600,
              transition: 'background 140ms ease-out',
            }}
          >
            <Command size={14} />
            <span style={{ flex: 1, textAlign: 'left' }}>Search...</span>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              background: 'var(--hairline)',
              padding: '2px 6px',
              borderRadius: 4,
              color: 'var(--muted-2)',
            }}>
              {typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K'}
            </span>
          </button>
        )}

        {/* Nav groups */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: isCollapsed ? '8px 6px' : '8px 10px' }}>
          {filteredGroups.map((group, gi) => (
            <div key={group.id} style={{ marginBottom: 4 }}>
              {!isCollapsed && (
                <div style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'var(--muted-2)',
                  padding: '12px 10px 4px',
                }}>
                  {group.label}
                </div>
              )}
              {isCollapsed && gi > 0 && (
                <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
              )}
              {group.items.map(item => (
                <NavItem key={item.key} item={item} isCollapsed={isCollapsed} />
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom: user + logout */}
        <div style={{
          padding: isCollapsed ? '10px 6px' : '10px 12px',
          borderTop: '1px solid var(--border)',
        }}>
          {!isCollapsed ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'var(--teal-mist)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 13,
                color: 'var(--teal-deep)',
                flexShrink: 0,
              }}>
                {(adminUser?.full_name || 'A')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: 'var(--fg)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {adminUser?.full_name || 'Admin'}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                  {adminUser?.role?.replace(/_/g, ' ') || 'admin'}
                </div>
              </div>
              <button
                onClick={onSignOut}
                title="Sign out"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: 'var(--muted)',
                }}
              >
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <button
              onClick={onSignOut}
              title="Sign out"
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '8px 0',
                color: 'var(--muted)',
              }}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // Mobile: hamburger + overlay drawer
  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            position: 'fixed',
            top: 12,
            left: 12,
            width: 40,
            height: 40,
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--panel)',
            boxShadow: 'var(--elevation-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 100,
          }}
        >
          <Menu size={20} strokeWidth={2.2} color="var(--fg)" />
        </button>

        {drawerOpen && (
          <>
            <div
              onClick={() => setDrawerOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'var(--overlay)',
                zIndex: 200,
              }}
            />
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              bottom: 0,
              width: EXPANDED_WIDTH,
              maxWidth: '80vw',
              zIndex: 201,
            }}>
              <SidebarContent isCollapsed={false} />
            </div>
          </>
        )}
      </>
    )
  }

  // Desktop: persistent sidebar rail
  return (
    <div style={{
      position: 'relative',
      height: '100%',
      flexShrink: 0,
    }}>
      <SidebarContent isCollapsed={collapsed} />
    </div>
  )
}
