import { useState, useEffect } from 'react'
import {
  LayoutDashboard, UserCheck, Flag, FileText, Image, Newspaper, Radio,
  ShoppingBag, DollarSign, Landmark, Building2, Users, Shield,
  Pill, ClipboardList, Target, Search, Bell, LogOut, Menu, X,
  ChevronDown, Settings
} from 'lucide-react'
import { theme } from '../../styles/theme'

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
      { key: 'teams', label: 'Teams', icon: Users },
      { key: 'drugs', label: 'Drug Intel', icon: Pill },
      { key: 'tasks', label: 'Tasks', icon: ClipboardList },
      { key: 'promotions', label: 'Promotions', icon: Target },
      { key: 'searches', label: 'Searches', icon: Search },
    ],
  },
]

function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1280)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

export default function AdminSidebar({
  activeTab,
  onTabChange,
  adminUser,
  permissions,
  notifCount,
  onSignOut,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const width = useWindowWidth()
  const isMobile = width < 768
  const isTablet = width >= 768 && width < 1024

  const filteredGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: group.items.filter(item => permissions[item.key] !== false),
  })).filter(group => group.items.length > 0)

  const sidebarWidth = isTablet ? 64 : 210

  function getBadgeCount(key) {
    if (key === 'notifications') return notifCount
    return null
  }

  function NavItem({ item, collapsed }) {
    const active = activeTab === item.key
    const badge = getBadgeCount(item.key)
    const Icon = item.icon

    return (
      <button
        onClick={() => {
          onTabChange(item.key)
          if (isMobile) setDrawerOpen(false)
        }}
        title={collapsed ? item.label : undefined}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: collapsed ? 0 : 8,
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? '10px 0' : '9px 10px',
          borderRadius: 10,
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 12,
          textAlign: 'left',
          boxSizing: 'border-box',
          marginBottom: 1,
          background: active ? theme.tealMist : 'transparent',
          color: active ? theme.tealDeep : theme.gray600,
          transition: `background ${theme.motion.fast} ${theme.motion.easeOut}`,
        }}
      >
        <Icon size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
        {!collapsed && (
          <>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.label}
            </span>
            {badge != null && badge > 0 && (
              <span style={{
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                background: theme.danger,
                color: '#fff',
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
        {collapsed && badge != null && badge > 0 && (
          <span style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: theme.danger,
          }} />
        )}
      </button>
    )
  }

  function SidebarContent({ collapsed }) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: theme.gray50,
        borderRight: `1px solid ${theme.border}`,
        boxSizing: 'border-box',
      }}>
        <div style={{
          padding: collapsed ? '16px 8px' : '16px 14px',
          borderBottom: `1px solid ${theme.border}`,
          textAlign: collapsed ? 'center' : 'left',
        }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: theme.heroGradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: collapsed ? '0 auto 4px' : '0 0 6px 0',
            fontWeight: 900,
            color: '#fff',
            fontSize: 16,
          }}>
            C
          </div>
          {!collapsed && (
            <>
              <div style={{ fontWeight: 800, fontSize: 13, color: theme.navy, lineHeight: 1.3 }}>
                CareFind Admin
              </div>
              <div style={{
                fontSize: 10.5,
                color: theme.tealDeep,
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {adminUser?.full_name || 'Admin'}
              </div>
            </>
          )}
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '8px 6px' : '8px 10px' }}>
          {filteredGroups.map((group, gi) => (
            <div key={group.id} style={{ marginBottom: 4 }}>
              {!collapsed && (
                <div style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: theme.gray400,
                  padding: '12px 10px 4px',
                }}>
                  {group.label}
                </div>
              )}
              {collapsed && gi > 0 && (
                <div style={{ height: 1, background: theme.border, margin: '6px 0' }} />
              )}
              {group.items.map(item => (
                <NavItem key={item.key} item={item} collapsed={collapsed} />
              ))}
            </div>
          ))}
        </nav>

        <div style={{
          padding: collapsed ? '10px 6px' : '10px 12px',
          borderTop: `1px solid ${theme.border}`,
        }}>
          {!collapsed ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: theme.tealMist,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 13,
                color: theme.tealDeep,
                flexShrink: 0,
              }}>
                {(adminUser?.full_name || 'A')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: theme.navy,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {adminUser?.full_name || 'Admin'}
                </div>
                <div style={{ fontSize: 10.5, color: theme.gray400 }}>
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
                  color: theme.gray400,
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
                color: theme.gray400,
              }}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>
    )
  }

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
            border: `1px solid ${theme.border}`,
            background: theme.cardBg,
            boxShadow: theme.elevation[2],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 100,
          }}
        >
          <Menu size={20} strokeWidth={2.2} color={theme.navy} />
        </button>

        {drawerOpen && (
          <>
            <div
              onClick={() => setDrawerOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                background: theme.overlay,
                zIndex: 200,
              }}
            />
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              bottom: 0,
              width: 240,
              maxWidth: '80vw',
              zIndex: 201,
            }}>
              <SidebarContent collapsed={false} />
            </div>
          </>
        )}
      </>
    )
  }

  return (
    <div style={{
      width: sidebarWidth,
      flexShrink: 0,
      height: '100%',
    }}>
      <SidebarContent collapsed={isTablet} />
    </div>
  )
}

export { NAV_GROUPS }
