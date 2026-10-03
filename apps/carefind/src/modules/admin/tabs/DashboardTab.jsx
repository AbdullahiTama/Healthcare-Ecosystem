import { Users, FileText, Shield, AlertTriangle, DollarSign, TrendingUp, Clock, RefreshCw } from 'lucide-react'
import { Card } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../styles/theme'
import { timeAgo } from '../ui'

function StatusDot({ status }) {
  const map = { pending: 'var(--amber)', active: 'var(--green)', verified: 'var(--green)' }
  const c = map[status] || 'var(--gray)'
  return <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 9999, background: c, display: 'inline-block', flexShrink: 0 }} />
}

function Sparkline({ values = [], color = 'var(--teal)', width = 64, height = 20 }) {
  if (!values.length) return <div style={{ width, height }} />
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts} opacity={0.9} />
    </svg>
  )
}

export default function DashboardTab({ stats, setTab, posts, users, transactions, verifications, reports, dateFrom, setDateFrom, dateTo, setDateTo }) {
  const pendingVerifs = (verifications || []).filter(v => v.status === 'pending')
  const openReports = (reports || []).filter(r => r.status === 'pending')
  const revenue = (transactions || []).filter(t => t.type === 'topup').reduce((s, t) => s + (t.naira_amount || 0), 0) / 100

  const kpis = [
    { label: 'Users', value: stats.users || users.length, icon: <Users size={14} />, tone: undefined },
    { label: 'Posts', value: stats.posts || posts.length, icon: <FileText size={14} />, tone: undefined },
    { label: 'Pending Verifs', value: stats.pendingVerifs || pendingVerifs.length, icon: <Shield size={14} />, tone: pendingVerifs.length > 0 ? 'warning' : undefined },
    { label: 'Open Reports', value: stats.reports || openReports.length, icon: <AlertTriangle size={14} />, tone: openReports.length > 0 ? 'warning' : undefined },
    { label: 'Transactions', value: stats.transactions || transactions.length, icon: <TrendingUp size={14} />, tone: undefined },
    { label: 'Revenue', value: `₦${(revenue || stats.revenue || 0).toLocaleString()}`, icon: <DollarSign size={14} />, tone: undefined },
  ]

  const recentActivity = [
    ...pendingVerifs.slice(0, 3).map(v => ({ id: v.id, type: 'verification', title: `Verification: ${v.full_name}`, subtitle: v.profession, time: v.created_at, tab: 'verifications' })),
    ...openReports.slice(0, 3).map(r => ({ id: r.id, type: 'report', title: `Report: ${r.reason}`, subtitle: r.posts?.content?.slice(0, 50), time: r.created_at, tab: 'reports' })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 6)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
      {/* KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {kpis.map(k => (
          <Card key={k.label} style={{
            padding: 14,
            background: k.tone === 'warning' ? 'var(--amber-bg)' : 'var(--panel)',
            border: k.tone === 'warning' ? '1px solid var(--amber)' : '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
              {k.icon} {k.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: k.tone === 'warning' ? 'var(--amber)' : 'var(--fg)', marginTop: 6 }}>
              {k.value}
            </div>
          </Card>
        ))}
      </div>

      {/* Recent activity */}
      {recentActivity.length > 0 && (
        <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={14} style={{ color: 'var(--teal)' }} /> Recent Activity
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentActivity.map(item => (
              <button key={item.id} onClick={() => setTab(item.tab)} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)' }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.subtitle} · {timeAgo(item.time)}</div>
                </div>
                <StatusDot status="pending" />
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
