import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  BarChart2, Pause, CreditCard, AlertTriangle, Package, Pill, Calendar,
  Plus, FileText, Receipt, CheckCircle, ArrowRight, ShoppingCart,
} from 'lucide-react'
// The dashboard owns no table of its own — it is a projection over two
// aggregates other modules own, so it composes their repositories rather than
// keeping a second copy of either query. Same shape as Reports.
import { notificationRepository } from '../notifications/repositories'
import { classifySalesVelocity } from '../../lib/velocity'
import { fmt, businessName } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Avatar, Empty, ErrorState, Loading, StatCard, PageHeader, MetricGrid, SectionCard, ActivityList, QuickAction } from '../../components/ui'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useTodaySales, useAllSales, useAppointments } from '../../hooks/queries'

const { tealDeep, tealMist, navy, gray500, gray400, border, success, bg } = theme

export default function DashboardHome({ brand, products, role, perms }) {
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const { isMobile } = useBreakpoint()
  const [showAllLow, setShowAllLow] = useState(false)
  const [showAllOut, setShowAllOut] = useState(false)
  const bType = brand?.business_type || brand?.type || 'skincare'
  const isHospital = bType === 'hospital'
  const canSeeAppts = !perms?.nav || perms.nav.includes('appointments')

  const { data: todaySales = [], isLoading: loadingToday, isError: errToday, refetch: refetchToday } = useTodaySales(brand?.id)
  const { data: allSales = [], isLoading: loadingAll, isError: errAll, refetch: refetchAll } = useAllSales(brand?.id)
  const { data: appts = [], isLoading: loadingAppts, isError: errAppts, refetch: refetchAppts } = useAppointments(brand?.id, canSeeAppts)

  const loading = loadingToday || loadingAll || (canSeeAppts && loadingAppts)
  // Whichever hooks failed — one aggregate error surface, one Retry that calls
  // each failed query's real refetch (never a fake state toggle).
  const failed = [
    errToday && refetchToday,
    errAll && refetchAll,
    canSeeAppts && errAppts && refetchAppts,
  ].filter(Boolean)

  const todayTotal = todaySales.reduce((s, x) => s + (x.total || 0), 0)
  const heldSales = allSales.filter(s => s.is_on_hold)
  const creditSales = allSales.filter(s => s.is_credit && s.balance > 0)
  const creditTotal = creditSales.reduce((s, x) => s + (x.balance || 0), 0)
  const lowStock = products.filter(p => (p.cat || p.category) !== 'Services' && p.stock > 0 && p.stock <= (p.reorder_level || 5))
  const outStock = products.filter(p => (p.cat || p.category) !== 'Services' && p.stock <= 0)
  const lowCount = lowStock.length
  const outCount = outStock.length
  const stockAlertCount = lowCount + outCount

  const todayStr = new Date().toISOString().split('T')[0]
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
    if (role !== 'Owner' || !brand?.id || loading) return
    const dayKey = new Date().toISOString().split('T')[0]
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
        const windowStart = Date.now() - 30 * 86400000
        const recentSales = allSales.filter(s => new Date(s.created_at || 0).getTime() >= windowStart)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, brand?.id, loading, products, allSales])

  const attentionCount = outCount + lowCount + creditSales.length + (showApptItem ? 1 : 0)
  const worklistEmpty = attentionCount === 0

  const today = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })
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
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: gray500 }} title={online ? 'Connected — all sales synced' : 'Offline — sales will sync when reconnected'}>
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
          <StatCard icon={<BarChart2 />} label='Sales today' value={fmt(todayTotal)} sub={`${todaySales.length} transaction${todaySales.length === 1 ? '' : 's'}`} onClick={() => navigate('/dashboard/pos')} />
          <StatCard icon={<Pause />} label='Held sales' value={heldSales.length} sub={heldSales.length > 0 ? 'waiting at counter' : 'none on hold'} onClick={() => navigate('/dashboard/pos')} />
          <StatCard icon={<CreditCard />} label='Owed to you' value={fmt(creditTotal)} sub={`${creditSales.length} credit sale${creditSales.length === 1 ? '' : 's'} open`} tone={creditSales.length > 0 ? 'warning' : 'default'} onClick={() => navigate('/dashboard/debts')} />
          <StatCard icon={<AlertTriangle />} label='Stock alerts' value={stockAlertCount} sub={`${outCount} out of stock`} tone={stockAlertCount > 0 ? 'danger' : 'default'} onClick={() => navigate('/dashboard/inventory')} />
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
            {worklistEmpty ? (
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
                      meta: nextAppt ? `First at ${nextAppt.time || '—'}${nextAppt.staff_name ? ' — ' + nextAppt.staff_name : ''}` : '',
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
                  meta: `${s.payment_method} · ${(s.created_at || '').slice(11, 16)}`,
                  value: fmt(s.total),
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
    </div>
  )
}
