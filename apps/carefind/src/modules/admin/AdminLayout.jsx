import { theme } from '../../styles/theme'
import AdminSidebar from './AdminSidebar'

export default function AdminLayout({
  children,
  activeTab,
  onTabChange,
  adminUser,
  permissions,
  notifCount,
  onSignOut,
}) {
  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      fontFamily: theme.fontFamily,
      background: theme.bg,
    }}>
      <AdminSidebar
        activeTab={activeTab}
        onTabChange={onTabChange}
        adminUser={adminUser}
        permissions={permissions}
        notifCount={notifCount}
        onSignOut={onSignOut}
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
            padding: '24px 20px 40px',
          }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
