import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import '../../styles/tokens.css'
import { Loading } from '../../components/ui'
import { AdminGate, useAdmin } from './AdminGate.jsx'
import { AdminFeedbackProvider } from './AdminFeedback.jsx'
import AdminShell from './shell/AdminShell.jsx'
import { ADMIN_ROOT, ALERTS, LEGACY_REDIRECTS, SCREENS, canAccess, firstAccessiblePath, screenByKey } from './navigation'
import { NoAccess, AdminNotFound } from './ui/NoAccess.jsx'

const LegacyScreens = lazy(() => import('./legacy/LegacyScreens.jsx'))

// Screens that have their own component. Every other screen renders through
// the legacy adapter with its permission key as the tab.
const SCREEN_COMPONENTS = {
  businesses_hub: lazy(() => import('../businesses-hub/BusinessesHub.jsx')),
  business_import: lazy(() => import('../business-directory/BusinessDirectoryPage')),
  agent_applications: lazy(() => import('../agents-hub/AgentApproval.jsx')),
  agent_earnings: lazy(() => import('../agents-hub/AgentEarnings.jsx')),
  agent_transfers: lazy(() => import('../agents-hub/AgentTransfer.jsx')),
  verifications: lazy(() => import('./screens/moderation/VerificationsScreen.jsx')),
  reports: lazy(() => import('./screens/moderation/ReportsScreen.jsx')),
  claims: lazy(() => import('./screens/moderation/ClaimsScreen.jsx')),
  moderation: lazy(() => import('./screens/moderation/QueueScreen.jsx')),
  overview: lazy(() => import('./screens/home/HomeScreen.jsx')),
  feed_ranking: lazy(() => import('./screens/platform/FeedRankingScreen.jsx')),
}

function ScreenElement({ item }) {
  const Component = SCREEN_COMPONENTS[item.key]
  return Component ? <Component /> : <LegacyScreens tab={item.permission} />
}

function Guard({ item, children }) {
  const admin = useAdmin()
  return canAccess(item, admin) ? children : <NoAccess />
}

// Home is the landing address. A role without it is sent to its first
// permitted screen instead of meeting a dead end.
function HomeRoute() {
  const admin = useAdmin()
  const home = screenByKey('overview')
  if (canAccess(home, admin)) return <ScreenElement item={home} />
  const first = firstAccessiblePath(admin)
  return first ? <Navigate to={first} replace /> : <NoAccess />
}

function LegacyRedirect({ to }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

export default function AdminApp() {
  return (
    <AdminGate>
      <AdminFeedbackProvider>
        <Suspense fallback={<Loading fullScreen />}>
          <Routes>
            {LEGACY_REDIRECTS.map(r => (
              <Route key={r.from} path={r.from} element={<LegacyRedirect to={r.to} />} />
            ))}
            <Route path={ADMIN_ROOT} element={<AdminShell />}>
              <Route index element={<HomeRoute />} />
              {SCREENS.filter(s => s.path).map(item => (
                <Route key={item.key} path={item.path} element={<Guard item={item}><ScreenElement item={item} /></Guard>} />
              ))}
              <Route path={ALERTS.path} element={<Guard item={ALERTS}><LegacyScreens tab={ALERTS.key} /></Guard>} />
              <Route path="*" element={<AdminNotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </AdminFeedbackProvider>
    </AdminGate>
  )
}
