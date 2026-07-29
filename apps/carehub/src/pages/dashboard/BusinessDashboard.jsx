import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../../providers/AuthProvider'
import Sidebar from '../../components/layout/Sidebar'
import TopBar from '../../components/layout/TopBar'
import PlanExpiryBanner from '../../components/layout/PlanExpiryBanner'
import { Toast, useToast } from '../../components/ui'
import { getProducts, cacheData, getCached, syncOfflineSales } from '../../services/supabase'
import { getNavItems, getPerms } from '../../lib/permissions'
import { businessName } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useBreakpoint } from '../../hooks/useBreakpoint'

// Pages
import DashboardHome from '../../modules/dashboard-home/DashboardHome'
import POS from '../../modules/pos/POS'
import Inventory from '../../modules/inventory/Inventory'
import Clients from '../../modules/clients/Clients'
import Appointments from '../../modules/appointments/Appointments'
import Expenses from '../../modules/expenses/Expenses'
import Debts from '../../modules/debts/Debts'
import Purchases from '../../modules/purchases/Purchases'
import Staff from '../../modules/staff/Staff'
import Reports from '../../modules/reports/Reports'
import Settings from '../../modules/settings/Settings'
import CareFind from '../../modules/carefind/CareFind'
import Locations from '../../modules/locations/Locations'
import Warehouses from '../../modules/warehouses/Warehouses'
import Territories from '../../modules/territories/Territories'
import Messages from '../../modules/messages/Messages'
import Stock from '../../modules/stock/Stock'
import Orders from '../../modules/orders/Orders'
import LiveActivity from '../../modules/live-activity/LiveActivity'
import Reception from './hospital/Reception'
import Triage from './hospital/Triage'
import Doctor from './hospital/Doctor'
import RxInbox from './hospital/RxInbox'
import Lab from './hospital/Lab'
import Imaging from './hospital/Imaging'
import ConsultationRouter from '../../modules/consultation/ConsultationRouter'

const PAGE_TITLES = {
  dashboard: 'Dashboard', pos: 'POS / Sales', inventory: 'Inventory',
  clients: 'Clients', appointments: 'Appointments', consultation: 'Consultations',
  expenses: 'Expenses', debts: 'Debts', purchases: 'Purchases',
  staff: 'Staff', reports: 'Reports', settings: 'Settings', carefind: 'CareFind Profile',
  reception: 'Reception', triage: 'Triage', doctor: 'Doctor Consultation', rx_inbox: 'Prescription Inbox',
}

export default function BusinessDashboard() {
  const { auth, logout } = useAuth()
  const brand = auth?.brand
  const staffUser = auth?.staff
  const role = staffUser?.role || 'Owner'
  const perms = getPerms(role)
  const navigate = useNavigate()
  // Same business-type resolution Sidebar.jsx uses — kept identical so the
  // guard below never disagrees with what the sidebar actually shows.
  const bType = brand?.business_type || brand?.type || 'skincare'
  const allowedRouteKeys = getNavItems(role, bType).map(item => item[0])
  // Route-level enforcement of lib/permissions.js's role/business-type matrix.
  // Previously this matrix only filtered what the Sidebar rendered — a user
  // could still reach any nested route by typing the URL directly, since the
  // one guard at App.jsx's level only checked "is someone logged in," not
  // "is this specific page allowed for their role/business type."
  const guard = (routeKey, element) => (allowedRouteKeys.includes(routeKey) ? element : <Navigate to='dashboard' replace />)
  const [products, setProducts] = useState([])
  const [syncing, setSyncing] = useState(false)
  const { isMobile } = useBreakpoint()
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()
  // The enterprise screens (warehouses/stock/orders/etc.) render their own
  // top-left H1 with no TopBar, which on mobile sits under the shell's
  // floating hamburger. bareGuard adds top clearance for just those routes so
  // the heading clears it (POS handles its own via its sticky header's padding).
  const bareGuard = (routeKey, element) => guard(routeKey, isMobile ? <div style={{ paddingTop: 40 }}>{element}</div> : element)
  // Sidebar.jsx's own nav handler closes this after a route change on mobile.
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (!brand?.id) return
    loadProducts()
    if (navigator.onLine) {
      syncOfflineSales(brand.id).then(n => { if (n > 0) showToast(n + ' offline sale(s) synced!') })
    }
  }, [brand?.id])

  async function loadProducts() {
    try {
      const p = await getProducts(brand.id)
      if (p && p.length > 0) {
        setProducts(p)
        cacheData('products_' + brand.id, p)
      } else {
        const cached = getCached('products_' + brand.id)
        if (cached) setProducts(cached)
      }
    } catch (e) {
      const cached = getCached('products_' + brand.id)
      if (cached) setProducts(cached)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    const n = await syncOfflineSales(brand?.id)
    showToast(n > 0 ? n + ' sale(s) synced!' : 'All sales already synced.')
    setSyncing(false)
  }

  const online = useOnlineStatus()

  const pageProps = { brand, products, setProducts, role, perms, showToast, loadProducts }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar brand={brand} role={role} mobileOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, position: 'relative' }}>
        {/* Fallback menu trigger for routes that render their own header
            instead of TopBar (POS, Warehouses, Territories, Messages, Stock,
            Orders, Activity) — mobile always needs a way to reach the drawer
            regardless of which page's chrome is on screen. */}
        {isMobile && !drawerOpen && (
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            style={{
              position: 'absolute', top: 10, left: 10, zIndex: 20,
              width: 36, height: 36, borderRadius: 10, border: 'none',
              background: 'rgba(15,23,42,0.75)', color: '#fff', fontSize: 17,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            ☰
          </button>
        )}
        {!online && (
          <div style={{ padding: '8px 20px', background: theme.danger, color: '#fff', fontSize: '13px', fontWeight: '700', textAlign: 'center' }}>
            No internet — Offline mode. Sales will sync when connected.
          </div>
        )}
        <PlanExpiryBanner brand={brand} />
        <div style={{ flex: 1, overflowY: 'auto', background: theme.bg }}>
          <Routes>
            {/* Dashboard renders its own full-bleed header (date + branch +
                sync status + New sale), so it skips the generic TopBar and the
                standard content padding — see DashboardHome.jsx. */}
            <Route path='dashboard' element={guard('dashboard', <DashboardHome {...pageProps} />)} />
            <Route path='pos' element={guard('pos', <POS {...pageProps} />)} />
            <Route path='inventory' element={guard('inventory', <><TopBar title='Inventory' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Inventory {...pageProps} /></div></>)} />
            <Route path='clients' element={guard('clients', <><TopBar title={brand?.business_type === 'hospital' ? 'Patients' : 'Clients'} brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Clients {...pageProps} /></div></>)} />
            <Route path='appointments' element={guard('appointments', <><TopBar title='Appointments' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Appointments {...pageProps} /></div></>)} />
            <Route path='consultation' element={guard('consultation', <><TopBar title='Consultations' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><ConsultationRouter {...pageProps} /></div></>)} />
            <Route path='expenses' element={guard('expenses', <><TopBar title='Expenses' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Expenses {...pageProps} /></div></>)} />
            <Route path='debts' element={guard('debts', <><TopBar title='Debts' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Debts {...pageProps} /></div></>)} />
            <Route path='purchases' element={guard('purchases', <><TopBar title='Purchases' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Purchases {...pageProps} /></div></>)} />
            <Route path='staff' element={guard('staff', <><TopBar title='Staff' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Staff {...pageProps} /></div></>)} />
            <Route path='reports' element={guard('reports', <><TopBar title='Reports' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Reports {...pageProps} /></div></>)} />
            <Route path='settings' element={guard('settings', <><TopBar title='Settings' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Settings {...pageProps} /></div></>)} />
            <Route path='carefind' element={guard('carefind', <><TopBar title='CareFind Profile' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><CareFind {...pageProps} /></div></>)} />
            <Route path='locations' element={guard('locations', <><TopBar title='Locations' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Locations {...pageProps} /></div></>)} />
            <Route path='warehouses' element={bareGuard('warehouses', <Warehouses {...pageProps} />)} />
            <Route path='territories' element={bareGuard('territories', <Territories {...pageProps} />)} />
            <Route path='messages' element={bareGuard('messages', <Messages {...pageProps} />)} />
            <Route path='stock' element={bareGuard('stock', <Stock {...pageProps} />)} />
            <Route path='orders' element={bareGuard('orders', <Orders {...pageProps} />)} />
            <Route path='activity' element={bareGuard('activity', <LiveActivity {...pageProps} />)} />
            <Route path='reception' element={guard('reception', <><TopBar title='Reception' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Reception {...pageProps} /></div></>)} />
            <Route path='triage' element={guard('triage', <><TopBar title='Triage' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Triage {...pageProps} /></div></>)} />
            <Route path='doctor' element={guard('doctor', <><TopBar title='Doctor Consultation' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Doctor {...pageProps} /></div></>)} />
            <Route path='rx_inbox' element={guard('rx_inbox', <><TopBar title='Prescription Inbox' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><RxInbox {...pageProps} /></div></>)} />
            <Route path='lab' element={guard('lab', <><TopBar title='Laboratory' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Lab {...pageProps} /></div></>)} />
            <Route path='imaging' element={guard('imaging', <><TopBar title='Imaging / Radiology' brand={brand} role={role} /><div style={{ padding: isMobile ? '16px' : '24px' }}><Imaging {...pageProps} /></div></>)} />
            <Route path='*' element={<Navigate to='dashboard' />} />
          </Routes>
        </div>
      </div>
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )
}
