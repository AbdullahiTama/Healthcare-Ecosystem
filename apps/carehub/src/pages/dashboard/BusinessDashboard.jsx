import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useState, useEffect, Suspense, lazy } from 'react'
import { Menu } from 'lucide-react'
import { useAuth } from '../../providers/AuthProvider'
import Sidebar from '../../components/layout/Sidebar'
import TopBar from '../../components/layout/TopBar'
import PlanExpiryBanner from '../../components/layout/PlanExpiryBanner'
import { Toast, useToast, DashboardShell, Loading } from '../../components/ui'
import { useProductCatalog } from '../../modules/inventory/hooks/useProductCatalog'
// Cross-aggregate read: the permission flags a staff member's role grants are
// owned by the staff module.
import { staffRepository } from '../../modules/staff/repositories'
import { saleRepository } from '../../modules/pos/repositories'
import { getNavItems, getPerms, getReportTabs, landingRoute, ROLES } from '../../lib/permissions'
import { businessName } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { MOBILE_MENU_TOP, MOBILE_MENU_LEFT, MOBILE_MENU_SIZE, MOBILE_MENU_CLEAR } from '../../components/layout/shellConstants'
import { startRolePrefetching, stopPrefetching } from '../../utils/modulePrefetch'
import OutboxRunner from '../../modules/live-activity/outbox/OutboxRunner'

// Lazy-loaded modules for code splitting
const DashboardHome = lazy(() => import('../../modules/dashboard-home/DashboardHome'))
const POS = lazy(() => import('../../modules/pos/POS'))
const SalesReport = lazy(() => import('../../modules/pos/SalesReport'))
const Inventory = lazy(() => import('../../modules/inventory/Inventory'))
const StockManagement = lazy(() => import('../../modules/stock-management/StockManagement'))
const Clients = lazy(() => import('../../modules/clients/Clients'))
const Appointments = lazy(() => import('../../modules/appointments/Appointments'))
const Expenses = lazy(() => import('../../modules/expenses/Expenses'))
const Debts = lazy(() => import('../../modules/debts/Debts'))
const Wallet = lazy(() => import('../../modules/wallet/Wallet'))
const Purchases = lazy(() => import('../../modules/purchases/Purchases'))
const Demand = lazy(() => import('../../modules/demand/Demand'))
const Staff = lazy(() => import('../../modules/staff/Staff'))
const ReportsHub = lazy(() => import('../../modules/reports/ReportsHub'))
const Settings = lazy(() => import('../../modules/settings/Settings'))
const CareFind = lazy(() => import('../../modules/carefind/CareFind'))
const Locations = lazy(() => import('../../modules/locations/Locations'))
const MasterCatalog = lazy(() => import('../../modules/master-catalog/MasterCatalog'))
const Ecommerce = lazy(() => import('../../modules/ecommerce/Ecommerce'))
const Warehouses = lazy(() => import('../../modules/warehouses/Warehouses'))
const Territories = lazy(() => import('../../modules/territories/Territories'))
const Messages = lazy(() => import('../../modules/messages/Messages'))
const Stock = lazy(() => import('../../modules/stock/Stock'))
const Orders = lazy(() => import('../../modules/orders/Orders'))
const LiveActivity = lazy(() => import('../../modules/live-activity/LiveActivity'))
const TeamLocations = lazy(() => import('../../modules/checkins/TeamLocations'))
const PlacesToConfirm = lazy(() => import('../../modules/live-activity/PlacesToConfirm'))
const CustomersPage = lazy(() => import('../../modules/live-activity/customers/CustomersPage'))
const TeamMapPage = lazy(() => import('../../modules/live-activity/teamMap/TeamMapPage'))
const ReportFieldsSetup = lazy(() => import('../../modules/live-activity/ReportFieldsSetup'))
const FacilityDiscovery = lazy(() => import('../../modules/facility-discovery/FacilityDiscovery'))
const Reception = lazy(() => import('./hospital/Reception'))
const Triage = lazy(() => import('./hospital/Triage'))
const Doctor = lazy(() => import('./hospital/Doctor'))
const RxInbox = lazy(() => import('./hospital/RxInbox'))
const Lab = lazy(() => import('./hospital/Lab'))
const Imaging = lazy(() => import('./hospital/Imaging'))
const Consultation = lazy(() => import('../../modules/consultation/Consultation'))
const Overview = lazy(() => import('../../modules/overview/Overview'))
const AdrReportPage = lazy(() => import('../../modules/adr/AdrReportPage'))
const PvTracker = lazy(() => import('../../modules/adr/PvTracker'))
const PvCaseDetail = lazy(() => import('../../modules/adr/PvCaseDetail'))

const PAGE_TITLES = {
  dashboard: 'Dashboard', pos: 'POS / Sales', inventory: 'Inventory', mastercatalog: 'Master Catalog',
  clients: 'Clients', appointments: 'Appointments', consultation: 'Consultations',
  expenses: 'Expenses', debts: 'Debts', purchases: 'Purchases', demand: 'Demand',
  staff: 'Staff', reports: 'Financial Reports', settings: 'Settings', carefind: 'CareFind Profile',
  reception: 'Reception', triage: 'Triage', doctor: 'Doctor Consultation', rx_inbox: 'Prescription Inbox',
  overview: 'Overview', 'adr-reports': 'Pharmacovigilance (ADR)', ecommerce: 'Online Store',
  discovery: 'Facility Discovery', activity: 'Live Field Activity',
}

const shortReason = (msg) => String(msg || '').replace(/^Supabase error \(\d{3}\):\s*/, '')

export default function BusinessDashboard() {
  const { auth, logout } = useAuth()
  const brand = auth?.brand
  const staffUser = auth?.staff
  const role = staffUser?.role || 'Owner'
  const [customRoles, setCustomRoles] = useState({})
  const [rolesLoaded, setRolesLoaded] = useState(false)
  // Custom business-defined roles (Staff.jsx → roles table): name → permissions
  // jsonb. getPerms/getNavItems override presets with these so custom-role
  // staff see exactly the modules their owner configured.
  useEffect(() => {
    if (!brand?.id) { setRolesLoaded(true); return }
    staffRepository.getRoles(brand.id).then(r => {
      const map = {}
      ;(r || []).forEach(x => { map[x.name] = x.permissions || {} })
      setCustomRoles(map)
    }).catch(() => {}).finally(() => setRolesLoaded(true))
  }, [brand?.id])
  // A role that is neither the owner nor a preset can only be judged once its custom permissions have loaded.
  // Judging it earlier treats it as the fallback menu for a moment, and the guard's redirect remounts the whole
  // tree (App keys <Routes> on location.key), which fetches the roles again: an endless redirect.
  const waitingForRoles = role !== 'Owner' && !ROLES[role] && !rolesLoaded
  const perms = getPerms(role, customRoles)
  const navigate = useNavigate()
  // Same business-type resolution Sidebar.jsx uses — kept identical so the
  // guard below never disagrees with what the sidebar actually shows.
  const bType = brand?.business_type || brand?.type || 'skincare'
  const allowedRouteKeys = getNavItems(role, bType, customRoles).map(item => item[0])

  // Role-based module prefetching: pre-load commonly-used modules during idle time
  useEffect(() => {
    if (role && bType && Object.keys(customRoles).length > 0) {
      startRolePrefetching(role, bType, customRoles)
    }
    return () => stopPrefetching()
  }, [role, bType, customRoles])

  // Route-level enforcement of lib/permissions.js's role/business-type matrix.
  // Previously this matrix only filtered what the Sidebar rendered — a user
  // could still reach any nested route by typing the URL directly, since the
  // one guard at App.jsx's level only checked "is someone logged in," not
  // "is this specific page allowed for their role/business type."
  // A refused or unknown page sends the person to their landing page: the dashboard if they have it, else
  // their Field page (a rep). Never to a page they cannot open, which would redirect forever.
  const landing = landingRoute(allowedRouteKeys)
  const guard = (routeKey, element) => (allowedRouteKeys.includes(routeKey) ? element : <Navigate to={'/dashboard/' + landing} replace />)
  // The product catalog is loaded once per business and shared by every page
  // (Inventory, POS, stock validation, CareFind…). Loading, error, offline and
  // saved-copy states live in useProductCatalog; pages read them from `catalog`.
  const catalog = useProductCatalog(brand?.id)
  const { products, setProducts, reload: loadProducts } = catalog
  const [syncing, setSyncing] = useState(false)
  const { isMobile, isTablet } = useBreakpoint()
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()
  // The enterprise screens (warehouses/stock/orders/etc.) render their own
  // top-left H1 with no TopBar, which on mobile sits under the shell's
  // floating menu. bareGuard adds top clearance for just those routes so the
  // heading clears it (POS handles its own via its sticky header's padding).
  const bareGuard = (routeKey, element) => guard(routeKey, isMobile ? <div style={{ paddingTop: MOBILE_MENU_CLEAR }}>{element}</div> : element)
  // The Reports Hub is reachable when the role has ANY report tab, not just the
  // legacy `reports` key — a Pharmacist who owns ADR must reach /dashboard/reports.
  // Same mobile top clearance as bareGuard so the hub's own header clears the
  // floating menu trigger.
  const reportTabs = getReportTabs(role, bType, customRoles)
  const reportHubGuard = (element) => (reportTabs.length > 0 ? (isMobile ? <div style={{ paddingTop: MOBILE_MENU_CLEAR }}>{element}</div> : element) : <Navigate to={'/dashboard/' + landing} replace />)
  // Sidebar.jsx's own nav handler closes this after a route change on mobile.
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (!brand?.id) return
    if (navigator.onLine) {
      saleRepository.syncQueued(brand.id).then(r => {
        if (r.synced > 0) showToast(r.synced + ' offline sale(s) synced!')
        if (r.rejected.length > 0) showToast(r.rejected.length + ' queued sale(s) were blocked by the server: ' + shortReason(r.rejected[0].error), { type: 'warning' })
      }).catch(() => {})
    }
  }, [brand?.id])

  const handleSync = async () => {
    setSyncing(true)
    const r = await saleRepository.syncQueued(brand?.id)
    if (r.rejected.length > 0) {
      showToast((r.synced > 0 ? r.synced + ' sale(s) synced. ' : '') + r.rejected.length + ' sale(s) blocked by the server: ' + shortReason(r.rejected[0].error), { type: 'warning' })
    } else {
      showToast(r.synced > 0 ? r.synced + ' sale(s) synced!' : 'All sales already synced.')
    }
    setSyncing(false)
  }

  const online = useOnlineStatus()

  const pageProps = { brand, products, setProducts, catalog, role, perms, showToast, loadProducts, staffName: staffUser?.full_name || '' }

  return (
    <>
      <OutboxRunner />
      <DashboardShell
        gutter={0}
        // Sidebar's literal widths (210 desktop / 64 tablet) — must stay in
        // lockstep with Sidebar.jsx, which owns those numbers.
        collapsed={isTablet}
        navWidth={210}
        navCollapsedWidth={64}
        nav={<Sidebar brand={brand} role={role} customRoles={customRoles} mobileOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />}
        topbar={
          <>
            {/* Fallback menu trigger for routes that render their own header
                instead of TopBar (POS, Warehouses, Territories, Messages, Stock,
                Orders, Activity) — mobile always needs a way to reach the drawer
                regardless of which page's chrome is on screen. */}
            {isMobile && !drawerOpen && (
              <button
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
                style={{
                  position: 'absolute', top: MOBILE_MENU_TOP, left: MOBILE_MENU_LEFT, zIndex: 20,
                  width: MOBILE_MENU_SIZE, height: MOBILE_MENU_SIZE, borderRadius: theme.radius.md,
                  border: `1px solid ${theme.border}`, background: theme.cardBg, color: theme.textDark,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  boxShadow: theme.elevation[2],
                  transition: `background ${theme.motion.fast} ${theme.motion.easeOut}`,
                }}
              >
                <Menu size={22} strokeWidth={2.2} aria-hidden="true" />
              </button>
            )}
            {!online && (
              <div style={{ padding: '8px 20px', background: theme.danger, color: '#fff', fontSize: '13px', fontWeight: '700', textAlign: 'center' }}>
                You are offline. Sales are saved on this device and will sync when you reconnect.
              </div>
            )}
            <PlanExpiryBanner brand={brand} />
          </>
        }
      >
        <>
          <Suspense fallback={<Loading text='Loading module...' />}>
            {waitingForRoles ? <Loading text='Loading your workspace...' /> : (
            // Keyed by the business: switching location remounts every module, so nothing from the previous location
            // (a cart, a half-filled form) survives the switch.
            <Routes key={brand?.id || 'none'}>
              {/* Overview renders its own full-bleed header (cross-branch stats),
                  so it skips the generic TopBar — see Overview.jsx. Owner-only. */}
              <Route path='overview' element={guard('overview', <Overview brand={brand} role={role} perms={perms} />)} />
              {/* Dashboard renders its own full-bleed header (date + branch +
                  sync status + New sale), so it skips the generic TopBar and the
                  standard content padding — see DashboardHome.jsx. */}
              <Route path='dashboard' element={guard('dashboard', <DashboardHome {...pageProps} staffId={staffUser?.id || null} customRoles={customRoles} />)} />
              <Route path='pos' element={guard('pos', <POS {...pageProps} />)} />
              {/* The till's Sales & Accounts report, opened from the POS search bar. Same
                  permission as the POS itself, so it exists for every business type that sells. */}
              <Route path='pos/report' element={bareGuard('pos', <SalesReport {...pageProps} />)} />
              <Route path='inventory' element={guard('inventory', <><TopBar title='Stock Management' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><StockManagement {...pageProps} /></div></>)} />
              <Route path='clients' element={guard('clients', <><TopBar title={brand?.business_type === 'hospital' ? 'Patients' : 'Clients'} brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Clients {...pageProps} /></div></>)} />
              <Route path='appointments' element={guard('appointments', <><TopBar title='Appointments' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Appointments {...pageProps} /></div></>)} />
              <Route path='consultation' element={guard('consultation', <><TopBar title='Consultations' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Consultation {...pageProps} /></div></>)} />
              <Route path='expenses' element={guard('expenses', <><TopBar title='Expenses' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Expenses {...pageProps} /></div></>)} />
              <Route path='debts' element={guard('debts', <><TopBar title='Debts' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Debts {...pageProps} /></div></>)} />
              <Route path='wallet' element={guard('wallet', <><TopBar title='Wallet' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Wallet {...pageProps} /></div></>)} />
              <Route path='purchases' element={guard('purchases', <><TopBar title='Purchases' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Purchases {...pageProps} /></div></>)} />
              <Route path='demand' element={guard('demand', <><TopBar title='Demand' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Demand {...pageProps} /></div></>)} />
              <Route path='staff' element={guard('staff', <><TopBar title='Staff' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Staff {...pageProps} /></div></>)} />
              <Route path='reports' element={reportHubGuard(<ReportsHub {...pageProps} role={role} customRoles={customRoles} />)} />
              <Route path='reports/:tab' element={reportHubGuard(<ReportsHub {...pageProps} role={role} customRoles={customRoles} />)} />
              {/* Back-compat: the legacy /dashboard/adr-reports list now lives at
                  the hub's ADR tab; typed/bookmarked URLs redirect there. Detail
                  pages keep their own URL below. */}
              <Route path='adr-reports' element={guard('adr-reports', <Navigate to='/dashboard/reports/adr' replace />)} />
              <Route path='adr-reports/:reportId/detail' element={bareGuard('adr-reports', <AdrReportPageRoute />)} />
              <Route path='reports/pv-tracker' element={guard('pv-tracker', <><TopBar title='PV Tracker' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><PvTracker {...pageProps} /></div></>)} />
              <Route path='reports/pv-tracker/:reportId' element={guard('pv-tracker', <><TopBar title='PV Case' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><PvCaseRoute {...pageProps} /></div></>)} />
              <Route path='settings' element={guard('settings', <><TopBar title='Settings' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Settings {...pageProps} /></div></>)} />
              <Route path='carefind' element={guard('carefind', <><TopBar title='CareFind Profile' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><CareFind {...pageProps} /></div></>)} />
              <Route path='locations' element={guard('locations', <><TopBar title='Locations' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Locations {...pageProps} /></div></>)} />
              <Route path='mastercatalog' element={guard('mastercatalog', <><TopBar title='Master Catalog' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><MasterCatalog {...pageProps} /></div></>)} />
              <Route path='ecommerce' element={guard('ecommerce', <><TopBar title='Online Store' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Ecommerce {...pageProps} /></div></>)} />
              {/* a shop order opened from a notification: the same page, with that order's drawer open */}
              <Route path='ecommerce/orders/:orderId' element={guard('ecommerce', <><TopBar title='Online Store' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Ecommerce {...pageProps} /></div></>)} />
              <Route path='warehouses' element={bareGuard('warehouses', <Warehouses {...pageProps} />)} />
              <Route path='territories' element={bareGuard('territories', <Territories {...pageProps} />)} />
              <Route path='messages' element={bareGuard('messages', <Messages {...pageProps} />)} />
              <Route path='stock' element={bareGuard('stock', <Stock {...pageProps} />)} />
              <Route path='orders' element={bareGuard('orders', <Orders {...pageProps} />)} />
              <Route path='activity' element={bareGuard('activity', <LiveActivity {...pageProps} />)} />
              {/* Field team: managing the field team. Each is guarded by its access-ruled module (lib/permissions.js). */}
              <Route path='field-team/reports' element={bareGuard('field-reports', <LiveActivity {...pageProps} mode='team' />)} />
              <Route path='field-team/map' element={guard('field-map', <><TopBar title='Team map' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><TeamMapPage brand={brand} customRoles={customRoles} /></div></>)} />
              <Route path='field-team/customers' element={guard('field-customers', <><TopBar title='Customers' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><CustomersPage brand={brand} /></div></>)} />
              <Route path='field-team/checkins' element={guard('field-checkins', <><TopBar title='Team check-ins' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><TeamLocations businessId={brand?.id} /></div></>)} />
              <Route path='field-team/approvals' element={bareGuard('field-approvals', <Orders {...pageProps} view='approvals' />)} />
              <Route path='field-team/places' element={guard('field-places', <><TopBar title='Places to confirm' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><PlacesToConfirm businessId={brand?.id} /></div></>)} />
              <Route path='field-team/fields' element={guard('field-fields', <><TopBar title='Report fields' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><ReportFieldsSetup businessId={brand?.id} /></div></>)} />
              <Route path='discovery' element={bareGuard('discovery', <FacilityDiscovery {...pageProps} />)} />
              {/* The Business Directory, Business Discovery and Territory Intelligence live only in the platform
                  admin console now; keep old bookmarks from dead-ending. */}
              <Route path='directory' element={<Navigate to='/dashboard' replace />} />
              <Route path='business-discovery' element={<Navigate to='/dashboard/activity' replace />} />
              <Route path='intelligence' element={<Navigate to='/dashboard' replace />} />
              <Route path='reception' element={guard('reception', <><TopBar title='Reception' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Reception {...pageProps} /></div></>)} />
              <Route path='triage' element={guard('triage', <><TopBar title='Triage' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Triage {...pageProps} /></div></>)} />
              <Route path='doctor' element={guard('doctor', <><TopBar title='Doctor Consultation' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Doctor {...pageProps} /></div></>)} />
              <Route path='rx_inbox' element={guard('rx_inbox', <><TopBar title='Prescription Inbox' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><RxInbox {...pageProps} /></div></>)} />
              <Route path='lab' element={guard('lab', <><TopBar title='Laboratory' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Lab {...pageProps} /></div></>)} />
              <Route path='imaging' element={guard('imaging', <><TopBar title='Imaging / Radiology' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Imaging {...pageProps} /></div></>)} />
              <Route path='*' element={<Navigate to={'/dashboard/' + landing} replace />} />
            </Routes>
            )}
          </Suspense>
        </>
      </DashboardShell>
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </>
  )
}

// Reads the :reportId URL param for the ADR report detail route so the page
// component stays prop-driven (matches how hospital detail routes thread ids).
function AdrReportPageRoute() {
  const { reportId } = useParams()
  return <AdrReportPage reportId={reportId} />
}

function PvCaseRoute({ brand }) {
  const { reportId } = useParams()
  return <PvCaseDetail brand={brand} reportId={reportId} />
}
