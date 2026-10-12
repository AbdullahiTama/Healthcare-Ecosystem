import { useCallback, useEffect, useState } from 'react'
import { DashboardShell, useBreakpoint } from '@care-ecosystem/design-system/components/ui'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { useAdminData, useAdminNews } from '../../../hooks/queries'
import { findItem, visibleGroups } from '../navigation'
import CommandPalette from '../CommandPalette.jsx'
import AdminAiCopilot from '../AdminAiCopilot.jsx'
import useCommandPalette from '../useCommandPalette.js'
import AdminNav from './AdminNav.jsx'
import Topbar from './Topbar.jsx'

const COLLAPSE_KEY = 'carefind_sidebar_collapsed'

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === 'true' } catch { return false }
}

// Navigation, topbar and the page area. It owns no data of its own beyond the
// alerts count; the active section is rendered by the caller as `children`.
export default function AdminShell({ tab, onTabChange, children }) {
  const { adminUser, permissions, signOut, invalidateAdmin, recordAction, actionHistory, showToast } = useAdmin()
  const { data: adminData } = useAdminData(true)

  // An expired session shows up first as a failed admin request. Tell the admin
  // on any screen, not only the one that happened to make the request.
  const { error: newsError } = useAdminNews(true)
  useEffect(() => {
    if (newsError && /invalid|expired|unauthori[sz]ed|session/i.test(newsError.message || '')) {
      showToast('Session expired, re-login', { type: 'error' })
    }
  }, [newsError, showToast])

  const { isMobile, isTablet } = useBreakpoint()
  const { open: paletteOpen, setOpen: setPaletteOpen, addToRecent } = useCommandPalette()
  const [userCollapsed, setUserCollapsed] = useState(readCollapsed)
  const [navOpen, setNavOpen] = useState(false)
  const [copilotOpen, setCopilotOpen] = useState(false)

  const go = useCallback((key) => {
    onTabChange(key)
    addToRecent(key)
    setNavOpen(false)
    setPaletteOpen(false)
  }, [onTabChange, addToRecent, setPaletteOpen])

  const toggleCollapsed = () => {
    setUserCollapsed(prev => {
      try { localStorage.setItem(COLLAPSE_KEY, String(!prev)) } catch { /* preference only */ }
      return !prev
    })
  }

  const current = findItem(tab)

  return (
    <DashboardShell
      collapsed={userCollapsed || isTablet}
      contentMaxWidth={1440}
      nav={(
        <AdminNav
          groups={visibleGroups(permissions)}
          activeTab={tab}
          onSelect={go}
          collapsed={userCollapsed || isTablet}
          onToggleCollapse={toggleCollapsed}
          mobile={isMobile}
          open={navOpen}
          onClose={() => setNavOpen(false)}
        />
      )}
      topbar={(
        <Topbar
          crumbGroup={current?.group}
          crumbLabel={current?.label || 'Dashboard'}
          adminUser={adminUser}
          notifCount={adminData?.roleNotifCount || 0}
          showMenuButton={isMobile}
          onOpenMenu={() => setNavOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenAlerts={() => go('notifications')}
          onOpenCopilot={() => setCopilotOpen(true)}
          onSignOut={signOut}
        />
      )}
    >
      {children}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={go}
        onSignOut={signOut}
        onRefresh={invalidateAdmin}
        permissions={permissions}
      />
      <AdminAiCopilot
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        currentTab={tab}
        recentActions={actionHistory}
        onFeedback={(suggestionId, accepted) => recordAction({ action: accepted ? 'copilot_accept' : 'copilot_reject', target: suggestionId })}
      />
    </DashboardShell>
  )
}
