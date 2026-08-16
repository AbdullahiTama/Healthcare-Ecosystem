import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  BarChart2, AlertTriangle, Package, Users, Calendar,
  Plus, ShoppingCart, UserPlus, Clock, ArrowRight, MapPin,
} from 'lucide-react'
import { getAllLocations } from '../../services/supabase'
import { saleRepository } from '../pos/repositories'
import { appointmentRepository } from '../appointments/repositories'
import { staffRepository } from '../staff/repositories'
import { fmt } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, Avatar, Loading, StatCard } from '../../components/ui'

const { tealDeep, tealMist, navy, gray500, gray400, gray100, border, danger, dangerBg, warning, warningBg, success, bg, cardBg } = theme

// Cross-branch overview dashboard for the business owner. Aggregates stats
// across every branch the owner can reach (parent + all descendants via the
// recursive current_business_ids()). Read-only: clicking a stat drills into the
// relevant module for the active branch.
export default function Overview({ brand, role, perms }) {
  const navigate = useNavigate()
  const [branches, setBranches] = useState([])
  const [branchData, setBranchData] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (role !== 'Owner' || !brand?.id) { setLoading(false); return }
    let live = true
    getAllLocations(brand.id).then(async (list) => {
      if (!live) return
      const all = list || [brand]
      setBranches(all)
      // Fan out: fetch each branch's data in parallel, then aggregate.
      const entries = await Promise.all(all.map(async (b) => {
        const [sales, appts, staff] = await Promise.all([
          saleRepository.getAll(b.id).catch(() => []),
          appointmentRepository.getAll(b.id).catch(() => []),
          staffRepository.getAll(b.id).catch(() => []),
        ])
        return [b.id, { sales: sales || [], appts: appts || [], staff: staff || [], branch: b }]
      }))
      if (!live) return
      setBranchData(Object.fromEntries(entries))
      setLoading(false)
    }).catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [brand?.id, role])

  if (loading) return <Loading text="Loading overview..." />
  if (role !== 'Owner') return (
    <div style={{ padding: 32, textAlign: 'center', color: gray400 }}>
      <div style={{ fontSize: 16, fontWeight: '700', color: navy }}>Overview is for the business Owner</div>
      <div style={{ fontSize: 13, marginTop: 8 }}>Switch to a branch to see its dashboard.</div>
    </div>
  )

  const todayStr = new Date().toISOString().split('T')[0]
  const allSales = Object.values(branchData).flatMap(b => b.sales)
  const allAppts = Object.values(branchData).flatMap(b => b.appts)
  const allStaff = Object.values(branchData).flatMap(b => b.staff)

  const todaySales = allSales.filter(s => (s.created_at || '').startsWith(todayStr))
  const todayTotal = todaySales.reduce((sum, s) => sum + (s.total || 0), 0)

  const upcomingAppts = allAppts
    .filter(a => (a.date || '') >= todayStr && a.status !== 'cancelled' && a.status !== 'completed')
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
    .slice(0, 8)

  // Staff headcount per branch.
  const staffByBranch = Object.values(branchData).map(b => ({ name: b.branch.name, count: b.staff.length }))

  // Pending tasks: appointments needing confirmation + held sales across branches.
  const pendingAppts = allAppts.filter(a => a.status === 'pending').length
  const heldSales = allSales.filter(s => s.is_on_hold).length
  const pendingTasks = pendingAppts + heldSales

  const branchesWithActivity = branches.map(b => {
    const d = branchData[b.id]
    if (!b.branch_name) return { ...b, isHeadquarters: true, salesCount: d.sales.length }
    return { ...b, isHeadquarters: false, salesCount: d.sales.length }
  })

  return (
    <div style={{ background: bg, minHeight: '100%' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 5, background: 'white', borderBottom: `1px solid ${border}`,
        padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: gray400 }}>Cross-branch overview</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: navy, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {branches.length} branch{branches.length === 1 ? '' : 'es'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button onClick={() => navigate('/dashboard/pos')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: theme.radius.md, border: 'none', background: tealDeep, color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            <ShoppingCart size={14} /> New sale
          </button>
          <button onClick={() => navigate('/dashboard/clients')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            <UserPlus size={14} /> Add client
          </button>
          <button onClick={() => navigate('/dashboard/appointments')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            <Calendar size={14} /> Book
          </button>
        </div>
      </header>

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 }}>
          <StatCard icon={<BarChart2 />} label='Sales today' value={fmt(todayTotal)} sub={`${todaySales.length} transaction${todaySales.length === 1 ? '' : 's'} · ${branches.length} branches`} onClick={() => navigate('/dashboard/pos')} />
          <StatCard icon={<Calendar />} label='Upcoming appts' value={upcomingAppts.length} sub={`${pendingAppts} pending confirmation`} tone={pendingAppts > 0 ? 'warning' : 'default'} onClick={() => navigate('/dashboard/appointments')} />
          <StatCard icon={<Users />} label='Total staff' value={allStaff.length} sub={`${staffByBranch.filter(b => b.count > 0).length} branches staffed`} onClick={() => navigate('/dashboard/staff')} />
          <StatCard icon={<AlertTriangle />} label='Pending tasks' value={pendingTasks} sub={`${heldSales} held sales · ${pendingAppts} appts`} tone={pendingTasks > 0 ? 'warning' : 'default'} onClick={() => navigate('/dashboard/appointments')} />
        </div>

        {/* Appointments (left) + branch summary (right) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, alignItems: 'stretch' }}>
          <Card style={{ minWidth: 0, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: navy, marginBottom: 14 }}>Next appointments across branches</div>
            {upcomingAppts.length === 0 ? (
              <div style={{ fontSize: 13, color: gray400, padding: '20px 0', textAlign: 'center' }}>No upcoming appointments</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {upcomingAppts.map(a => {
                  const b = Object.values(branchData).find(d => d.appts.some(x => x.id === a.id))
                  return (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}` }}>
                      <Avatar name={a.client_name} size={28} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: navy }}>{a.client_name}</div>
                        <div style={{ fontSize: 11, color: gray400 }}>{a.date} at {a.time} · {a.service || 'Consultation'}</div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: '700', color: tealDeep, background: tealMist, padding: '3px 8px', borderRadius: '6px', flexShrink: 0 }}>
                        {b?.branch?.branch_name || b?.branch?.name || 'HQ'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <Card style={{ minWidth: 0, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: navy, marginBottom: 14 }}>Branches</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {branchesWithActivity.map(b => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}` }}>
                  <div style={{ width: 32, height: 32, borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <MapPin size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: gray400 }}>{branchData[b.id]?.staff.length || 0} staff · {branchData[b.id]?.sales.length || 0} sales</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
