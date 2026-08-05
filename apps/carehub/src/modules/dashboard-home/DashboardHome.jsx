import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  BarChart2, Pause, CreditCard, AlertTriangle, Package, Pill, Calendar,
  Plus, FileText, Receipt, CheckCircle, ArrowRight, ShoppingCart,
} from 'lucide-react'
// The dashboard owns no table of its own — it is a projection over two
// aggregates other modules own, so it composes their repositories rather than
// keeping a second copy of either query. Same shape as Reports.
import { saleRepository } from '../pos/repositories'
import { appointmentRepository } from '../appointments/repositories'
import { fmt, businessName } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, Avatar, Empty, Loading } from '../../components/ui'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useBreakpoint } from '../../hooks/useBreakpoint'

const { tealDeep, tealMist, navy, gray500, gray400, border, danger, dangerBg, warning, warningBg, success, bg } = theme

// Stat tile — the template's dashboard KPI: a muted icon+label row on top, a
// large value (colored for the two states an owner must not miss — money owed
// in amber, stock danger in red), and a one-line supporting figure. Clickable
// per SCREEN_PATTERNS.md pattern 5 (every stat card drills into the view that
// explains it — never a decorative vanity number).
function StatTile({ icon: Icon, label, value, sub, tone = 'default', onClick }) {
  const toneColor = { default: navy, warning, danger }[tone] || navy
  return (
    <Card onClick={onClick} style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: gray500, marginBottom: 10 }}>
        <Icon size={15} strokeWidth={2} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 25, fontWeight: 900, color: toneColor, lineHeight: 1.1, letterSpacing: '-0.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: gray400, marginTop: 5 }}>{sub}</div>}
    </Card>
  )
}

// Worklist row — one shape for every "needs attention" item (stock alert,
// credit follow-up, appointment reminder). A business owner cares about "what
// needs me right now," not which subsystem raised it, so they share a row.
function WorkItem({ tone, icon: Icon, title, sub, action, onAction }) {
  const tones = {
    danger: { bg: dangerBg, fg: danger },
    warning: { bg: warningBg, fg: warning },
    teal: { bg: tealMist, fg: tealDeep },
  }
  const t = tones[tone] || tones.teal
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: theme.radius.md, border: `1px solid ${border}` }}>
      <div style={{ width: 36, height: 36, borderRadius: theme.radius.md, background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: gray400, marginTop: 1 }}>{sub}</div>
      </div>
      <button onClick={onAction} style={{ padding: '7px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>{action}</button>
    </div>
  )
}

export default function DashboardHome({ brand, products, role, perms }) {
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const { isMobile } = useBreakpoint()
  const [todaySales, setTodaySales] = useState([])
  const [allSales, setAllSales] = useState([])
  const [appts, setAppts] = useState([])
  const [showAllLow, setShowAllLow] = useState(false)
  const [showAllOut, setShowAllOut] = useState(false)
  const [loading, setLoading] = useState(true)
  const bType = brand?.business_type || brand?.type || 'skincare'
  const isHospital = bType === 'hospital'
  const canSeeAppts = !perms?.nav || perms.nav.includes('appointments')

  useEffect(() => {
    if (brand?.id) {
      setLoading(true)
      Promise.all([
        saleRepository.getToday(brand.id).then(s => setTodaySales(s || [])).catch(() => {}),
        saleRepository.getAll(brand.id).then(s => setAllSales(s || [])).catch(() => {}),
        canSeeAppts ? appointmentRepository.getAll(brand.id).then(a => setAppts(a || [])).catch(() => {}) : Promise.resolve(),
      ]).finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [brand?.id])

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

  const attentionCount = outCount + lowCount + creditSales.length + (showApptItem ? 1 : 0)
  const worklistEmpty = attentionCount === 0

  const today = new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })
  const branchLabel = brand?.city ? `${brand.city} branch` : (brand?.name || businessName(bType))

  if (loading) return <Loading text="Loading dashboard..." />

  return (
    <div style={{ background: bg, minHeight: '100%' }}>

      {/* Rich top bar — date + branch on the left, live sync status + the one
          primary action on the right. Sticky so "New sale" is always reachable
          on long dashboards. Extra left padding on mobile clears the shell's
          floating menu trigger (BusinessDashboard.jsx). */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 5, background: 'white', borderBottom: `1px solid ${border}`,
        padding: isMobile ? '12px 16px 12px 56px' : '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: gray400 }}>{today}</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: navy, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{branchLabel}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 16, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: gray500 }} title={online ? 'Connected — all sales synced' : 'Offline — sales will sync when reconnected'}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: online ? success : gray400, flexShrink: 0 }} />
            {online ? 'Online · synced' : 'Offline'}
          </div>
          <button onClick={() => navigate('/dashboard/pos')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: theme.radius.md, border: 'none', background: tealDeep, color: 'white', fontWeight: 800, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
            <ShoppingCart size={15} /> New sale
          </button>
        </div>
      </header>

      <div style={{ padding: isMobile ? 16 : 24, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
          <StatTile icon={BarChart2} label='Sales today' value={fmt(todayTotal)} sub={`${todaySales.length} transaction${todaySales.length === 1 ? '' : 's'}`} onClick={() => navigate('/dashboard/pos')} />
          <StatTile icon={Pause} label='Held sales' value={heldSales.length} sub={heldSales.length > 0 ? 'waiting at counter' : 'none on hold'} onClick={() => navigate('/dashboard/pos')} />
          <StatTile icon={CreditCard} label='Owed to you' value={fmt(creditTotal)} sub={`${creditSales.length} credit sale${creditSales.length === 1 ? '' : 's'} open`} tone={creditSales.length > 0 ? 'warning' : 'default'} onClick={() => navigate('/dashboard/debts')} />
          <StatTile icon={AlertTriangle} label='Stock alerts' value={stockAlertCount} sub={`${outCount} out of stock`} tone={stockAlertCount > 0 ? 'danger' : 'default'} onClick={() => navigate('/dashboard/inventory')} />
        </div>

        {/* Worklist (left) + recent sales & quick actions (right). A grid with
            `minmax(0, …)` tracks — one column on mobile, ~2:1 on wider screens.
            The `minmax(0, …)` (rather than the default `minmax(auto, …)`) is
            what lets each column shrink below its content so the worklist rows'
            long titles ellipsis instead of forcing horizontal overflow. */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, alignItems: 'stretch' }}>

          <Card style={{ minWidth: 0, padding: 18, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: navy }}>Needs your attention</div>
              {!worklistEmpty && <div style={{ fontSize: 11.5, color: gray400 }}>{attentionCount} item{attentionCount === 1 ? '' : 's'}</div>}
            </div>
            {worklistEmpty ? (
              <Empty icon={<CheckCircle />} message='Nothing needs your attention right now.' cause='positive' />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(showAllOut ? outStock : outStock.slice(0, 3)).map(p => (
                  <WorkItem key={'out-' + p.id} tone='danger' icon={Pill} title={`${p.name} is out of stock`} sub='Cannot be sold right now' action='Restock' onAction={() => navigate('/dashboard/inventory')} />
                ))}
                {!showAllOut && outCount > 3 && (
                  <button onClick={() => setShowAllOut(true)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: '2px 0' }}>+ {outCount - 3} more out of stock</button>
                )}
                {(showAllLow ? lowStock : lowStock.slice(0, 3)).map(p => (
                  <WorkItem key={'low-' + p.id} tone='warning' icon={Package} title={`${p.name} running low`} sub={`${p.stock} left · reorder level ${p.reorder_level || 5}`} action='Reorder' onAction={() => navigate('/dashboard/inventory')} />
                ))}
                {!showAllLow && lowCount > 3 && (
                  <button onClick={() => setShowAllLow(true)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: '2px 0' }}>+ {lowCount - 3} more low stock</button>
                )}
                {creditSales.slice(0, 3).map(s => (
                  <WorkItem key={'credit-' + s.id} tone='teal' icon={CreditCard} title={`${fmt(s.balance)} credit due from ${s.client_name || 'Walk-in'}`} sub={`Credit sale · ${s.txn_no || 'unpaid'}`} action='Follow up' onAction={() => navigate('/dashboard/debts')} />
                ))}
                {showApptItem && (
                  <WorkItem tone='teal' icon={Calendar}
                    title={`${upcomingAppts.length} appointment${upcomingAppts.length === 1 ? '' : 's'} coming up`}
                    sub={nextAppt ? `First at ${nextAppt.time || '—'}${nextAppt.staff_name ? ' — ' + nextAppt.staff_name : ''}` : ''}
                    action='Review' onAction={() => navigate('/dashboard/appointments')} />
                )}
              </div>
            )}
          </Card>

          {/* Right column: recent sales card, then the three quick actions */}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card style={{ padding: 18, flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: navy }}>Recent sales</div>
                <button onClick={() => navigate('/dashboard/pos')} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, fontSize: 11.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                  View all <ArrowRight size={11} />
                </button>
              </div>
              {todaySales.length === 0 ? (
                <Empty icon={<ShoppingCart />} message='No sales yet today.' cause='none' />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {todaySales.slice(0, 5).map(s => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={s.client_name || 'Walk-in'} size={30} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.client_name || 'Walk-in'}</div>
                        <div style={{ fontSize: 11, color: gray400 }}>{s.payment_method} · {(s.created_at || '').slice(11, 16)}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: navy, flexShrink: 0 }}>{fmt(s.total)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Quick actions — compact, role-aware (only actions this role can
                actually reach, per lib/permissions.js). */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[[Plus, 'Add product', 'inventory'], [Receipt, 'Add expense', 'expenses'], [FileText, 'Export report', 'reports']]
                .filter(([, , key]) => !perms?.nav || perms.nav.includes(key))
                .map(([Icon, label, key]) => (
                  <button key={key} onClick={() => navigate('/dashboard/' + key)}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '16px 8px', borderRadius: theme.radius.lg, border: `1px solid ${border}`, background: 'white', cursor: 'pointer' }}>
                    <div style={{ width: 34, height: 34, borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={16} /></div>
                    <div style={{ fontWeight: 700, fontSize: 12, color: navy, textAlign: 'center' }}>{label}</div>
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* Hospital patient flow — no template equivalent (the reference
            mockups are pharmacy/retail), kept as its own block so hospital
            accounts don't lose real, load-bearing navigation. */}
        {isHospital && (
          <Card style={{ padding: 18 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14, color: navy }}>Hospital patient flow</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {[['Reception', 'reception'], ['→', ''], ['Triage', 'triage'], ['→', ''], ['Doctor', 'doctor'], ['→', ''], ['Lab', 'lab'], ['→', ''], ['Imaging', 'imaging'], ['→', ''], ['Pharmacy', 'rx_inbox']].map(([label, path], i) => (
                label === '→' ? <span key={i} style={{ color: gray400, fontSize: 16 }}>→</span> : (
                  <button key={i} onClick={() => navigate('/dashboard/' + path)}
                    style={{ padding: '10px 16px', borderRadius: theme.radius.md, background: tealMist, border: 'none', textAlign: 'center', cursor: 'pointer', fontWeight: 700, fontSize: 12, color: tealDeep }}>
                    {label}
                  </button>
                )
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
