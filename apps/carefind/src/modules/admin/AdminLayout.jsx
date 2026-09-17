import { useState, useEffect } from 'react'
import AdminSidebar from './AdminSidebar'

const EXPANDED_WIDTH = 256
const COLLAPSED_WIDTH = 64

export default function AdminLayout({
  children,
  activeTab,
  onTabChange,
  adminUser,
  permissions,
  notifCount,
  onSignOut,
  onOpenCmdPalette,
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('carefind_sidebar_collapsed') === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem('carefind_sidebar_collapsed', String(collapsed)) } catch {}
  }, [collapsed])

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const upd = () => setIsMobile(mq.matches)
    upd()
    mq.addEventListener ? mq.addEventListener('change', upd) : mq.addListener(upd)
    return () => mq.removeEventListener ? mq.removeEventListener('change', upd) : mq.removeListener(upd)
  }, [])

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--bg)',
      color: 'var(--fg)',
    }}>
      <AdminSidebar
        activeTab={activeTab}
        onTabChange={onTabChange}
        adminUser={adminUser}
        permissions={permissions}
        notifCount={notifCount}
        onSignOut={onSignOut}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        onOpenCmdPalette={onOpenCmdPalette}
      />
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minWidth: 0,
      }}>
        <div style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}>
          <div style={{
            maxWidth: 960,
            margin: '0 auto',
            padding: isMobile ? '56px 16px 40px' : '24px 20px 40px',
          }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
