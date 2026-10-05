import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { DashboardShell, useBreakpoint } from '@care-ecosystem/design-system/components/ui'
import { Loading } from '../../../components/ui'
import { theme } from '../../../styles/theme'
import { useAdmin } from '../AdminGate.jsx'
import { useAdminActivity } from '../AdminFeedback.jsx'
import { usePendingCounts } from '../data/queues'
import { useRealtimeChannel } from '../hooks/useRealtimeChannel'
import { pathFor, screenForPath } from '../navigation'
import CommandPalette from '../CommandPalette.jsx'
import useCommandPalette from '../useCommandPalette.js'
import AdminAiCopilot from '../AdminAiCopilot.jsx'
import Sidebar, { NAV_WIDTH, NAV_COLLAPSED_WIDTH } from './Sidebar.jsx'
import TopBar from './TopBar.jsx'

const COLLAPSE_KEY = 'carefind_sidebar_collapsed'
const POLL_MS = 30000

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === 'true' } catch { return false }
}

export default function AdminShell() {
  const { adminUser, permissions, signOut } = useAdmin()
  const { isMobile, isMobileOrTablet } = useBreakpoint()
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { counts, total, failed } = usePendingCounts()
  const { recentActions, recordAction } = useAdminActivity()
  const { open: cmdOpen, setOpen: setCmdOpen, addToRecent } = useCommandPalette()

  const [userCollapsed, setUserCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [copilotOpen, setCopilotOpen] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, String(userCollapsed)) } catch { /* private mode */ }
  }, [userCollapsed])

  // Tablet has no room for the expanded rail, so it is collapsed there
  // regardless of the saved preference.
  const collapsed = !isMobile && (isMobileOrTablet || userCollapsed)

  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ['admin'] }) }, [qc])

  useRealtimeChannel({ channelName: 'admin-notifications', subscription: { schema: 'public', table: 'verification_requests' }, onInsert: refresh, onUpdate: refresh, pollInterval: POLL_MS, pollFn: refresh })
  useRealtimeChannel({ channelName: 'admin-posts', subscription: { schema: 'public', table: 'posts' }, onInsert: refresh, pollInterval: POLL_MS, pollFn: refresh })
  useRealtimeChannel({ channelName: 'admin-reports', subscription: { schema: 'public', table: 'reports' }, onInsert: refresh, onUpdate: refresh, pollInterval: POLL_MS, pollFn: refresh })
  useRealtimeChannel({ channelName: 'admin-news', subscription: { schema: 'public', table: 'news', filter: 'status=eq.pending' }, onInsert: refresh, onUpdate: refresh, pollInterval: POLL_MS, pollFn: refresh })

  const goTo = useCallback((key) => {
    navigate(pathFor(key))
    addToRecent(key)
    setCmdOpen(false)
  }, [navigate, addToRecent, setCmdOpen])

  const currentKey = screenForPath(location.pathname)?.key || 'overview'

  return (
    <>
      <DashboardShell
        collapsed={collapsed}
        navWidth={NAV_WIDTH}
        navCollapsedWidth={NAV_COLLAPSED_WIDTH}
        contentMaxWidth={1280}
        nav={(
          <Sidebar
            collapsed={collapsed}
            onToggleCollapse={() => setUserCollapsed(v => !v)}
            counts={counts}
            countsFailed={failed}
            isMobile={isMobile}
            mobileOpen={mobileOpen}
            onCloseMobile={() => setMobileOpen(false)}
          />
        )}
        topbar={(
          <TopBar isMobile={isMobile} onOpenMenu={() => setMobileOpen(true)} onOpenSearch={() => setCmdOpen(true)} alertsCount={total} />
        )}
      >
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </DashboardShell>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={goTo}
        onSignOut={signOut}
        onRefresh={refresh}
        permissions={permissions}
        adminUser={adminUser}
      />

      <button
        onClick={() => setCopilotOpen(true)}
        aria-label="Open the AI copilot"
        style={{ position: 'fixed', bottom: 20, right: 20, width: 52, height: 52, borderRadius: '50%', background: theme.tealDeep, border: 'none', boxShadow: theme.elevation[2], cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 150 }}
      >
        <Sparkles size={22} color="white" aria-hidden="true" />
      </button>
      <AdminAiCopilot
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        currentTab={currentKey}
        recentActions={recentActions}
        onFeedback={(suggestionId, accepted) => recordAction({ action: accepted ? 'copilot_accept' : 'copilot_reject', target: suggestionId })}
      />
    </>
  )
}
