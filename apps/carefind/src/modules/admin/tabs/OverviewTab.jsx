import { Users, FileText, Shield, AlertTriangle, DollarSign, TrendingUp, Clock } from 'lucide-react'
import { StatCard } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../styles/theme'
import { AdminPageHeader, DateRange } from '../ui'
import FeedRankingConfig from '../FeedRankingConfig.jsx'
import DistributionExperiments from '../DistributionExperiments.jsx'

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function OverviewTab({ stats, setTab, posts, users, transactions, dateFrom, setDateFrom, dateTo, setDateTo }) {
  const statCards = [
    { icon: <Users size={15} />, label: 'Total Users', value: stats.users, tab: 'users' },
    { icon: <FileText size={15} />, label: 'Total Posts', value: stats.posts, tab: 'posts' },
    { icon: <Shield size={15} />, label: 'Pending Verifs', value: stats.pendingVerifs, alert: stats.pendingVerifs > 0, tab: 'verifications' },
    { icon: <AlertTriangle size={15} />, label: 'Open Reports', value: stats.reports, alert: stats.reports > 0, tab: 'reports' },
    { icon: <DollarSign size={15} />, label: 'Transactions', value: stats.transactions, tab: 'revenue' },
    { icon: <TrendingUp size={15} />, label: 'Revenue', value: `₦${(stats.revenue || 0).toLocaleString()}`, tab: 'revenue' },
  ]

  return (
    <div>
      <AdminPageHeader title="Overview" subtitle="CareFind admin dashboard" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: theme.space[4], marginBottom: theme.space[8] }}>
        {statCards.map(s => (
          <StatCard
            key={s.label}
            icon={s.icon}
            label={s.label}
            value={s.value}
            alert={s.alert}
            tone={s.alert ? 'warning' : undefined}
            onClick={() => setTab(s.tab)}
          />
        ))}
      </div>

      <FeedRankingConfig />
      <DistributionExperiments />

      <div style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: theme.space[5], marginTop: theme.space[4] }}>
        <div style={{ fontSize: theme.type.h3.size, fontWeight: theme.type.h3.weight, color: theme.textDark, marginBottom: theme.space[4], display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={16} /> Filter by Date
        </div>
        <DateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />

        {(dateFrom || dateTo) && (
          <div style={{ marginTop: theme.space[4] }}>
            <div style={{ fontSize: 12, color: theme.textMid, fontWeight: 600, marginBottom: theme.space[3] }}>Activity in range:</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { label: 'Posts', value: posts.filter(p => (!dateFrom || p.created_at >= dateFrom) && (!dateTo || p.created_at <= dateTo + 'T23:59:59')).length },
                { label: 'Users', value: users.filter(u => (!dateFrom || u.created_at >= dateFrom) && (!dateTo || u.created_at <= dateTo + 'T23:59:59')).length },
                { label: 'Transactions', value: transactions.filter(t => (!dateFrom || t.created_at >= dateFrom) && (!dateTo || t.created_at <= dateTo + 'T23:59:59')).length },
              ].map(s => (
                <StatCard key={s.label} label={s.label} value={s.value} />
              ))}
            </div>
            <button onClick={() => { setDateFrom(''); setDateTo('') }} style={{ marginTop: theme.space[3], padding: '5px 10px', background: 'none', border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, fontSize: 11, color: theme.textLight, cursor: 'pointer', fontFamily: theme.fontFamily }}>
              Clear filter
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
