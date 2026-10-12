import { Bell, LogOut, Menu, Search, Sparkles } from 'lucide-react'
import { UserMenu } from '@care-ecosystem/design-system/components/ui'
import './shell.css'

const isMac = () => typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)

// The bar above every section: where you are, search (opens the command
// palette), alerts, the AI Copilot, and the signed-in admin's menu.
export default function Topbar({ crumbGroup, crumbLabel, adminUser, notifCount, showMenuButton, onOpenMenu, onOpenPalette, onOpenAlerts, onOpenCopilot, onSignOut }) {
  const alertsLabel = notifCount > 0 ? `Alerts, ${notifCount} waiting` : 'Alerts'
  return (
    <header className="adm-top">
      {showMenuButton && (
        <button type="button" className="adm-icon-btn" aria-label="Open navigation" onClick={onOpenMenu}>
          <Menu size={18} aria-hidden="true" />
        </button>
      )}
      <div className="adm-crumb">
        {crumbGroup && <>{crumbGroup} / </>}<strong>{crumbLabel}</strong>
      </div>

      <button type="button" className="adm-search" aria-label="Search or jump to a section" onClick={onOpenPalette}>
        <Search size={15} aria-hidden="true" />
        <span>Search or jump to…</span>
        <kbd className="adm-kbd">{isMac() ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      <button type="button" className="adm-icon-btn" aria-label={alertsLabel} onClick={onOpenAlerts}>
        <Bell size={17} aria-hidden="true" />
        {notifCount > 0 && <span className="adm-bell-count adm-num" aria-hidden="true">{notifCount > 99 ? '99+' : notifCount}</span>}
      </button>
      <button type="button" className="adm-icon-btn" aria-label="Open AI Copilot" onClick={onOpenCopilot}>
        <Sparkles size={17} aria-hidden="true" />
      </button>
      <UserMenu
        name={adminUser?.full_name || 'Admin'}
        role={adminUser?.role?.replace(/_/g, ' ') || 'admin'}
        items={[{ label: 'Sign out', icon: <LogOut size={15} />, danger: true, onClick: onSignOut }]}
      />
    </header>
  )
}
