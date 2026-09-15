import { theme } from '../../../styles/theme'
import { Card, Button, Empty, StatCard } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, AdminSection } from '../ui'
import { Search, TrendingUp, AlertTriangle, Clock, User, CheckCircle, XCircle, BarChart3 } from 'lucide-react'

export default function SearchesTab({ searchLogs }) {
  const typed = searchLogs.filter(s => s.query)
  const notFound = typed.filter(s => !s.found)

  // Tally most-searched terms
  const tally = {}
  typed.forEach(s => {
    const k = s.query.toLowerCase().trim()
    tally[k] = (tally[k] || 0) + 1
  })
  const topTerms = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)

  // Tally unmet demand (not found terms)
  const gapTally = {}
  notFound.forEach(s => {
    const k = s.query.toLowerCase().trim()
    gapTally[k] = (gapTally[k] || 0) + 1
  })
  const gaps = Object.entries(gapTally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)

  return (
    <div>
      <AdminPageHeader
        title="Search Analytics"
        subtitle="Track user search behavior and identify demand gaps"
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: theme.space[4], marginBottom: theme.space[6] }}>
        <StatCard
          icon={<Search size={20} />}
          label="Total Searches"
          value={typed.length}
          sub="With query text"
          tone="teal"
        />
        <StatCard
          icon={<AlertTriangle size={20} />}
          label="Found Nothing"
          value={notFound.length}
          sub="Unmet demand"
          tone={notFound.length > 0 ? 'danger' : 'teal'}
          alert={notFound.length > 0}
        />
      </div>

      <AdminSection
        title="Demand Gaps"
        subtitle="Products/services people want that you don't have yet"
      >
        {gaps.length === 0 ? (
          <Empty
            icon={<CheckCircle size={40} strokeWidth={1.5} />}
            message="No unmet searches yet"
            cause="positive"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
            {gaps.map(([term, count]) => (
              <Card
                key={term}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: theme.space[4],
                  background: theme.dangerBg,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
                  <AlertTriangle size={16} color={theme.danger} />
                  <span style={{
                    fontSize: theme.type.body.size,
                    fontWeight: 700,
                    color: theme.textDark,
                    textTransform: 'capitalize',
                  }}>
                    {term}
                  </span>
                </div>
                <span style={{
                  fontSize: theme.type.caption.size,
                  fontWeight: 800,
                  color: theme.danger,
                  background: '#fff',
                  padding: '4px 10px',
                  borderRadius: theme.radius.full,
                }}>
                  {count}× wanted
                </span>
              </Card>
            ))}
          </div>
        )}
      </AdminSection>

      <AdminSection title="Most Searched Terms" subtitle="Popular queries across all users">
        {topTerms.length === 0 ? (
          <Empty
            icon={<BarChart3 size={40} strokeWidth={1.5} />}
            message="No searches yet"
            cause="none"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {topTerms.map(([term, count], i) => (
              <div
                key={term}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: `${theme.space[3]} 0`,
                  borderBottom: i < topTerms.length - 1 ? `1px solid ${theme.border}` : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
                  <span style={{
                    width: 20,
                    height: 20,
                    borderRadius: theme.radius.full,
                    background: i < 3 ? theme.tealMist : theme.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: theme.type.micro.size,
                    fontWeight: 800,
                    color: i < 3 ? theme.tealDeep : theme.textLight,
                  }}>
                    {i + 1}
                  </span>
                  <span style={{
                    fontSize: theme.type.body.size,
                    fontWeight: 600,
                    color: theme.textDark,
                    textTransform: 'capitalize',
                  }}>
                    {term}
                  </span>
                </div>
                <span style={{
                  fontSize: theme.type.bodySm.size,
                  fontWeight: 800,
                  color: theme.tealDeep,
                }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        )}
      </AdminSection>

      <AdminSection title="Recent Searches" subtitle="Latest search activity from users">
        {typed.length === 0 ? (
          <Empty
            icon={<Clock size={40} strokeWidth={1.5} />}
            message="No recent searches"
            cause="none"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {typed.slice(0, 40).map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: `${theme.space[3]} 0`,
                  borderBottom: i < Math.min(typed.length, 40) - 1 ? `1px solid ${theme.border}` : 'none',
                }}
              >
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
                  <Search size={14} color={theme.gray400} />
                  <div style={{ flex: 1 }}>
                    <span style={{
                      fontSize: theme.type.body.size,
                      fontWeight: 600,
                      color: theme.textDark,
                    }}>
                      {s.query}
                    </span>
                    <span style={{
                      fontSize: theme.type.micro.size,
                      color: theme.textLight,
                      marginLeft: theme.space[3],
                    }}>
                      {s.category} · {s.profiles?.full_name || s.profiles?.display_name || 'Guest'}
                    </span>
                  </div>
                </div>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: theme.type.micro.size,
                  fontWeight: 800,
                  padding: '3px 10px',
                  borderRadius: theme.radius.full,
                  background: s.found ? theme.successBg : theme.dangerBg,
                  color: s.found ? theme.success : theme.danger,
                }}>
                  {s.found ? <CheckCircle size={10} /> : <XCircle size={10} />}
                  {s.found ? `${s.results_count} found` : 'none'}
                </span>
              </div>
            ))}
          </div>
        )}
      </AdminSection>
    </div>
  )
}
