import { periodRange, reportView, isCompletedSale } from '../pos/salesReport'
import { useSalesReportData } from '../pos/useSalesReportData'
import { useBusinessToday } from '../../hooks/useBusinessToday'
import { businessTime, businessDate, parseDbTime, BUSINESS_TZ } from '../../lib/businessDay'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect, useMemo } from 'react'
import {
  BarChart2, Pause, CreditCard, AlertTriangle, Package, Pill, Calendar,
  Plus, FileText, Receipt, CheckCircle, ArrowRight, ShoppingCart,
} from 'lucide-react'
// The dashboard owns no table of its own — it is a projection over two
// aggregates other modules own, so it composes their repositories rather than
// keeping a second copy of either query. Same shape as Reports.
import { notificationRepository } from '../notifications/repositories'
import { saleRepository } from '../pos/repositories'
import { classifySalesVelocity } from '../../lib/velocity'
import { fmt, businessName } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Avatar, Empty, ErrorState, Loading, StatCard, PageHeader, MetricGrid, SectionCard, ActivityList, QuickAction, Toast, useToast } from '../../components/ui'
import SaleDetailModal from '../pos/SaleDetailModal'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { canSeeAllActivity, isManagerRole } from '../../lib/permissions'
import FieldTeamToday from './FieldTeamToday.jsx'
import OwnerActivity from './OwnerActivity.jsx'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useOpenSales, useAppointments, useSettings, useInvalidateSales } from '../../hooks/queries'

const { tealDeep, tealMist, navy, gray500, gray400, border, success, bg } = theme

// Today's figures refresh on their own, so a dashboard left open at the counter
// keeps up with sales rung up on other devices.
const LIVE_REFRESH_MS = 60_000

export default function DashboardHome({ brand, products, catalog, role, perms, staffId = null, customRoles }) {
  // Shared product catalog state (inventory/hooks/useProductCatalog.js). Stock
  // figures wait for it; automatic stock alerts use only a fresh server list,
  // never a saved copy that may be out of date.
  const catalogLoading = catalog?.status === 'loading'
  const catalogFresh = !catalog || (catalog.status === 'ready' && !catalog.stale && !catalog.refreshing)
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const { isMobile } = useBreakpoint()
  const [showAllLow, setShowAllLow] = useState(false)
  const [showAllOut, setShowAllOut] = useState(false)
  const bType = brand?.business_type || brand?.type || 'skincare'
  const isHospital = bType === 'hospital'
  // Field team today: manufacturers and wholesalers, for whoever manages the field team (owner, a manager
  // role, or "Manage field team").
  const showFieldTeam = (bType === 'manufacturer_importer' || bType === 'wholesale') &&
    canSeeAllActivity({ isOwner: role === 'Owner', role, perms })
  const canSeeAppts = !perms?.nav || perms.nav.includes('appointments')

  // "Sales today" is the Sales & Accounts report for Today: the same query, the
  // same rows and the same arithmetic (salesReport.reportView), so the two
  // screens cannot disagree. Gross sales; refunds are shown beside it.
  const businessToday = useBusinessToday()
  const todayRange = useMemo(() => periodRange('today'), [businessToday])
  const { data: todayData, isLoading: loadingToday, isError: errToday, refetch: refetchToday } =
    useSalesReportData(brand?.id, todayRange, { refetchInterval: LIVE_REFRESH_MS })
  const todayView = useMemo(() => (todayData ? reportView(todayData) : null), [todayData])
  const todaySales = useMemo(() => [...(todayView?.sales || [])]
    .sort((a, b) => (parseDbTime(b.created_at)?.getTime() || 0) - (parseDbTime(a.created_at)?.getTime() || 0)), [todayView])
  // A recent sale opened in full (items, payments, receipt).
  const [detailSale, setDetailSale] = useState(null)
  const { data: settings } = useSettings(brand?.id)
  const invalidateSales = useInvalidateSales(brand?.id)
  const { msg: toastMsg, type: toastType, show: showToast } = useToast()
  // A sale opened from the Owner's business activity (credit sale, refund,
  // repayment or correction), by its receipt number.
  async function openSaleByTxn(txn) {
    try {
      const sale = await saleRepository.getById(brand.id, txn)
      if (sale) setDetailSale(sale)
      else showToast('That sale is no longer on record.', { type: 'warning' })
    } catch (e) {
      console.error('[dashboard] could not open sale', txn, e?.message)
      showToast('Could not open that sale. Please try again.', { type: 'error' })
    }
  }
  // Held and unpaid credit sales only — not the whole sales history.
  const { data: openSales = [], isLoading: loadingAll, isError: errAll, refetch: refetchAll } = useOpenSales(brand?.id)
  const { data: appts = [], isLoading: loadingAppts, isError: errAppts, refetch: refetchAppts } = useAppointments(brand?.id, canSeeAppts)

  const loading = loadingToday || loadingAll || (canSeeAppts && loadingAppts)
  // Whichever hooks failed — one aggregate error surface, one Retry that calls
  // each failed query's real refetch (never a fake state toggle).
  const failed = [
    errToday && refetchToday,
    errAll && refetchAll,
    canSeeAppts && errAppts && refetchAppts,
  ].filter(Boolean)

  const todayTotal = todayView?.summary.totalSales || 0
  const todayRefunds = todayView?.summary.refunds.total || 0
  const heldSales = openSales.filter(s => s.is_on_hold)
  const creditSales = openSales.filter(s => s.is_credit && s.balance > 0)
  const creditTotal = creditSales.reduce((s, x) => s + (x.balance || 0), 0)
  const lowStock = products.filter(p => (p.cat || p.category) !== 'Services' && p.stock > 0 && p.stock <= (p.reorder_level || 5))
  const outStock = products.filter(p => (p.cat || p.category) !== 'Services' && p.stock <= 0)
  const lowCount = lowStock.length
  const outCount = outStock.length
  const stockAlertCount = lowCount + outCount

  const todayStr = businessToday
  const upcomingAppts = appts
    .filter(a => (a.date || '') >= todayStr && a.status !== 'cancelled' && a.status !== 'completed')
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
  const nextAppt = upcomingAppts[0]
  const showApptItem = canSeeAppts && upcomingAppts.length > 0

  // ── Proactive owner alerts (issue #4) ────────────────────────────────────────
  // The dashboard is where the owner already looks, so it raises the stock and
  // expiry conditions it can see into the notification center — once per kind,
  // per business, per day (localStorage dedupe). Owner-only: staff dashboards
  // must not write owner notifications as a side effect of being viewed.
  const daysToExpiry = (p) => {
    if (!p.expiry_date) return null
    const d = new Date(p.expiry_date)
    if (Number.isNaN(d.getTime())) return null
    return Math.ceil((d - new Date()) / 86400000)
  }
  const expiringSoon = products.filter(p => { const t = daysToExpiry(p); return t !== null && t >= 0 && t <= 60 })
  const expiredProducts = products.filter(p => { const t = daysToExpiry(p); return t !== null && t < 0 })

  useEffect(() => {
    if (role !== 'Owner' || !brand?.id || loading || !catalogFresh) return
    const dayKey = businessDate()
    const keyFor = (kind) => 'carehub_notified_' + kind + '_' + brand.id
    const sentToday = (kind) => { try { return localStorage.getItem(keyFor(kind)) === dayKey } catch (e) { return false } }
    const markSent = (kind) => { try { localStorage.setItem(keyFor(kind), dayKey) } catch (e) {} }
    // notify() itself never throws; marking after the await keeps the dedupe
    // honest for the failures it CAN report.
    const names = (arr) => arr.slice(0, 5).map(p => p.name).join(', ') + (arr.length > 5 ? ' +' + (arr.length - 5) + ' more' : '')

    async function raiseAlerts() {
      try {
        if (outStock.length > 0 && !sentToday('out_of_stock')) {
          await notificationRepository.notify(brand.id, [{ staffId: null }], 'out_of_stock',
            outStock.length + ' product' + (outStock.length === 1 ? '' : 's') + ' out of stock',
            names(outStock), '/dashboard/inventory?stock=out')
          markSent('out_of_stock')
        }
        if (lowStock.length > 0 && !sentToday('low_stock')) {
          await notificationRepository.notify(brand.id, [{ staffId: null }], 'low_stock',
            lowStock.length + ' product' + (lowStock.length === 1 ? '' : 's') + ' running low',
            names(lowStock), '/dashboard/inventory?stock=low')
          markSent('low_stock')
        }
        if (expiringSoon.length > 0 && !sentToday('product_expiring_soon')) {
          await notificationRepository.notify(brand.id, [{ staffId: null }], 'product_expiring_soon',
            expiringSoon.length + ' product' + (expiringSoon.length === 1 ? '' : 's') + ' expire within 60 days',
            names(expiringSoon), '/dashboard/inventory?expiry=expiring')
          markSent('product_expiring_soon')
        }
        if (expiredProducts.length > 0 && !sentToday('product_expired')) {
          await notificationRepository.notify(brand.id, [{ staffId: null }], 'product_expired',
            expiredProducts.length + ' product' + (expiredProducts.length === 1 ? '' : 's') + ' have expired',
            names(expiredProducts), '/dashboard/inventory?expiry=expired')
          markSent('product_expired')
        }
        // Velocity digest — only when something actually sold in the window;
        // "everything is slow" on an empty book is noise, not insight.
        // Fetched only when the digest is due (once a day): the last 30 days of
        // sales, not the whole history.
        const recentSales = sentToday('sales_velocity')
          ? []
          : (await saleRepository.getSince(brand.id, new Date(Date.now() - 30 * 86400000).toISOString()) || []).filter(isCompletedSale)
        if (recentSales.length > 0 && !sentToday('sales_velocity')) {
          const v = classifySalesVelocity(products, recentSales, { days: 30 })
          const parts = []
          if (v.fast.length > 0) parts.push(v.fast.length + ' fast mover' + (v.fast.length === 1 ? '' : 's'))
          if (v.medium.length > 0) parts.push(v.medium.length + ' steady seller' + (v.medium.length === 1 ? '' : 's'))
          if (v.slow.length > 0) parts.push(v.slow.length + ' not moving')
          if (parts.length > 0) {
            await notificationRepository.notify(brand.id, [{ staffId: null }], 'sales_velocity',
              '30-day sales velocity: ' + parts.join(', '),
              v.fast.length > 0 ? 'Top mover: ' + v.fast[0].name : null,
              '/dashboard/reports')
            markSent('sales_velocity')
          }
        }
      } catch (e) {
        console.error('Proactive alert check failed:', e)
      }
    }
    raiseAlerts()
  }, [role, brand?.id, loading, products, catalogFresh])

  const attentionCount = outCount + lowCount + creditSales.length + (showApptItem ? 1 : 0)
  const worklistEmpty = attentionCount === 0 && !catalogLoading

  const today = new Date().toLocaleDateString('en-NG', { timeZone: BUSINESS_TZ, weekday: 'long', day: 'numeric', month: 'long' })
  const branchLabel = brand?.city ? `${brand.city} branch` : (brand?.name || businessName(bType))
  // Shared badge skin for the worklist row actions (Restock / Reorder / …).
  const badgeBtn = { padding: '7px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0 }

  if (loading) return <Loading text="Loading dashboard..." />

  return (
    <div style={{ background: bg, minHeight: '100%' }}>

      {/* Rich top bar — date + branch, live sync status + the one primary
          action. PageHeader itself is static, so stickiness ("New sale" stays
          reachable on long dashboards) comes from this wrapper. Extra left
          padding on mobile clears the shell's floating menu trigger
          (BusinessDashboard.jsx). */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5 }}>
        <PageHeader
          landmark="none"
          title={branchLabel}
          description={today}
          contextActions={
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: gray500 }} title={online ? 'Connected, all sales synced' : 'Offline, sales will sync when reconnected'}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: online ? success : gray400, flexShrink: 0 }} />
              {online ? 'Online · synced' : 'Offline'}
            </span>
          }
          primaryAction={{ label: 'New sale', onClick: () => navigate('/dashboard/pos'), leftIcon: <ShoppingCart size={15} /> }}
          style={{ marginBottom: 0, padding: isMobile ? '12px 16px 12px 56px' : '14px 24px' }}
        />
      </div>

      <div style={{ padding: isMobile ? 16 : 24, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Aggregate query failure — one surface + one Retry; the sections
            below still render whatever did load. */}
        {failed.length > 0 && (
          <ErrorState message='Some dashboard data failed to load. Retry to fetch it again.' onRetry={() => failed.forEach(fn => fn())} />
        )}

        {/* KPI row — minColumn 160 pins today's minmax(160px,1fr) floor so the
            wrap sequence stays 4/4/3/2 at 1280/1024/768/375 (human decision B). */}
        <MetricGrid label="Key metrics" minColumn={160}>
          <StatCard icon={<BarChart2 />} label='Sales today' value={fmt(todayTotal)} sub={`${todaySales.length} transaction${todaySales.length === 1 ? '' : 's'}${todayRefunds > 0 ? ` · ${fmt(todayRefunds)} refunded` : ''}`} onClick={() => navigate('/dashboard/pos/report')} />
          <StatCard icon={<Pause />} label='Held sales' value={heldSales.length} sub={heldSales.length > 0 ? 'waiting at counter' : 'none on hold'} onClick={() => navigate('/dashboard/pos')} />
          <StatCard icon={<CreditCard />} label='Owed to you' value={fmt(creditTotal)} sub={`${creditSales.length} open credit sale${creditSales.length === 1 ? '' : 's'} · all dates`} tone={creditSales.length > 0 ? 'warning' : 'default'} onClick={() => navigate('/dashboard/debts')} />
          {catalogLoading ? (
            <StatCard icon={<AlertTriangle />} label='Stock alerts' value='…' sub={catalog?.loadedCount > 0 ? `Loading products… ${catalog.loadedCount.toLocaleString()}` : 'Loading products…'} onClick={() => navigate('/dashboard/inventory')} />
          ) : (
            <StatCard icon={<AlertTriangle />} label='Stock alerts' value={stockAlertCount} sub={`${outCount} out of stock`} tone={stockAlertCount > 0 ? 'danger' : 'default'} onClick={() => navigate('/dashboard/inventory')} />
          )}
        </MetricGrid>

        {/* Worklist (left) + recent sales & quick actions (right). A grid with
            `minmax(0, …)` tracks — one column on mobile, ~2:1 on wider screens.
            The `minmax(0, …)` (rather than the default `minmax(auto, …)`) is
            what lets each column shrink below its content so the worklist rows'
            long titles ellipsis instead of forcing horizontal overflow. */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, alignItems: 'stretch' }}>

          <SectionCard
            title="Needs your attention"
            actions={worklistEmpty ? null : <span style={{ fontSize: 11.5, color: gray400 }}>{attentionCount} item{attentionCount === 1 ? '' : 's'}</span>}
            style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}
          >
            {catalogLoading && attentionCount === 0 ? (
              <Loading text='Checking your stock…' />
            ) : worklistEmpty ? (
              // A failed query leaves defaulted [] data — a false all-clear.
              // While the aggregate error surface is up, show nothing here
              // rather than "Nothing needs your attention" (D1 review B1).
              failed.length === 0 ? (
                <Empty icon={<CheckCircle />} message='Nothing needs your attention right now.' cause='positive' />
              ) : null
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <ActivityList
                  label="Out of stock"
                  empty={false}
                  items={(showAllOut ? outStock : outStock.slice(0, 3)).map(p => ({
                    id: 'out-' + p.id,
                    tone: 'danger',
                    icon: <Pill size={17} />,
                    title: `${p.name} is out of stock`,
                    meta: 'Cannot be sold right now',
                    badge: <button type="button" onClick={() => navigate('/dashboard/inventory')} style={badgeBtn}>Restock</button>,
                  }))}
                />
                {!showAllOut && outCount > 3 && (
                  <button type="button" onClick={() => setShowAllOut(true)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: '2px 0' }}>+ {outCount - 3} more out of stock</button>
                )}
                <ActivityList
                  label="Low stock"
                  empty={false}
                  items={(showAllLow ? lowStock : lowStock.slice(0, 3)).map(p => ({
                    id: 'low-' + p.id,
                    tone: 'warning',
                    icon: <Package size={17} />,
                    title: `${p.name} running low`,
                    meta: `${p.stock} left · reorder level ${p.reorder_level || 5}`,
                    badge: <button type="button" onClick={() => navigate('/dashboard/inventory')} style={badgeBtn}>Reorder</button>,
                  }))}
                />
                {!showAllLow && lowCount > 3 && (
                  <button type="button" onClick={() => setShowAllLow(true)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: '2px 0' }}>+ {lowCount - 3} more low stock</button>
                )}
                <ActivityList
                  label="Follow-ups"
                  empty={false}
                  items={[
                    ...creditSales.slice(0, 3).map(s => ({
                      id: 'credit-' + s.id,
                      tone: 'brand',
                      icon: <CreditCard size={17} />,
                      title: `${fmt(s.balance)} credit due from ${s.client_name || 'Walk-in'}`,
                      meta: `Credit sale · ${s.txn_no || 'unpaid'}`,
                      badge: <button type="button" onClick={() => navigate('/dashboard/debts')} style={badgeBtn}>Follow up</button>,
                    })),
                    ...(showApptItem ? [{
                      id: 'appt',
                      tone: 'brand',
                      icon: <Calendar size={17} />,
                      title: `${upcomingAppts.length} appointment${upcomingAppts.length === 1 ? '' : 's'} coming up`,
                      meta: nextAppt ? `First at ${nextAppt.time || 'Not set'}${nextAppt.staff_name ? ' · ' + nextAppt.staff_name : ''}` : '',
                      badge: <button type="button" onClick={() => navigate('/dashboard/appointments')} style={badgeBtn}>Review</button>,
                    }] : []),
                  ]}
                />
              </div>
            )}
          </SectionCard>

          {/* Right column: recent sales card, then the three quick actions */}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionCard
              title="Recent sales"
              actions={
                <button type="button" onClick={() => navigate('/dashboard/pos')} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, fontSize: 11.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                  View all <ArrowRight size={11} />
                </button>
              }
              style={{ flex: 1 }}
            >
              <ActivityList
                label="Recent sales"
                empty={failed.length === 0 ? <Empty icon={<ShoppingCart />} message='No sales yet today.' cause='none' /> : false}
                items={todaySales.slice(0, 5).map(s => ({
                  id: s.id,
                  icon: <Avatar name={s.client_name || 'Walk-in'} size={30} />,
                  title: s.client_name || 'Walk-in',
                  meta: `${s.payment_method} · ${businessTime(s.created_at)}`,
                  value: fmt(s.total),
                  onClick: () => setDetailSale(s),
                }))}
              />
            </SectionCard>

            {/* Quick actions — compact, role-aware (only actions this role can
                actually reach, per lib/permissions.js). Kept in the app's own
                3-up grid: the right column is too narrow for MetricGrid's
                auto-fit floor. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[[Plus, 'Add product', 'inventory'], [Receipt, 'Add expense', 'expenses'], [FileText, 'Export report', 'reports']]
                .filter(([, , key]) => !perms?.nav || perms.nav.includes(key))
                .map(([Icon, label, key]) => (
                  <QuickAction key={key} icon={<Icon size={16} />} label={label} onClick={() => navigate('/dashboard/' + key)} />
                ))}
            </div>
          </div>
        </div>

        {/* Hospital patient flow — no template equivalent (the reference
            mockups are pharmacy/retail), kept as its own block so hospital
            accounts don't lose real, load-bearing navigation. */}
        {/* The Owner's business activity: money records staff entered, and what
            still needs paying or chasing. Owner only (the feed is the Owner's in
            the database too). */}
        {role === 'Owner' && <OwnerActivity brand={brand} onOpenSale={openSaleByTxn} />}

        {showFieldTeam && <FieldTeamToday brand={brand} role={role} staffId={staffId} customRoles={customRoles} />}

        {isHospital && (
          <SectionCard title="Hospital patient flow">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {[['Reception', 'reception'], ['→', ''], ['Triage', 'triage'], ['→', ''], ['Doctor', 'doctor'], ['→', ''], ['Lab', 'lab'], ['→', ''], ['Imaging', 'imaging'], ['→', ''], ['Pharmacy', 'rx_inbox']].map(([label, path], i) => (
                label === '→' ? <span key={i} style={{ color: gray400, fontSize: 16 }}>→</span> : (
                  <button key={i} type="button" onClick={() => navigate('/dashboard/' + path)}
                    style={{ padding: '10px 16px', borderRadius: theme.radius.md, background: tealMist, border: 'none', textAlign: 'center', cursor: 'pointer', fontWeight: 700, fontSize: 12, color: tealDeep }}>
                    {label}
                  </button>
                )
              ))}
            </div>
          </SectionCard>
        )}
      </div>
      <SaleDetailModal show={!!detailSale} sale={detailSale} onClose={() => setDetailSale(null)} brand={brand} settings={settings}
        canRefund={role === 'Owner' || isManagerRole(role)} ledgerAvailable showToast={showToast}
        onChanged={() => { setDetailSale(null); invalidateSales() }} />
      <Toast msg={toastMsg} type={toastType} />
    </div>
  )
}
