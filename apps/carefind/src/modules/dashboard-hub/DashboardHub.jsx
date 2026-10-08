import { Link } from 'react-router-dom'
import { Building2, Clock, CheckCircle2, Users, ShoppingBag } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Loading, ErrorState, Card, StatCard } from '../../components/ui'
import { useDashboardData } from '../../hooks/queries'

export default function DashboardHub() {
  const { data, isLoading, error, refetch } = useDashboardData()

  const stats = data?.stats || { total: 0, pending: 0, active: 0, teams: 0, ecommerce: 0 }
  const pendingBusinesses = data?.pendingBusinesses || []
  const pendingAgents = data?.pendingAgents || []

  if (isLoading) {
    return (
      <div data-testid="dashboard-loading">
        <Loading text="Loading dashboard..." />
      </div>
    )
  }

  if (error) {
    return (
      <div data-testid="dashboard-error">
        <ErrorState message={error.message || 'Failed to load dashboard'} onRetry={refetch} />
      </div>
    )
  }

  return (
    <div data-testid="dashboard-hub" style={{ fontFamily: theme.fontFamily, maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: '0 0 4px 0', fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.navy, letterSpacing: theme.type.h1.letterSpacing }}>
          CareFindHub Dashboard
        </h1>
        <p style={{ margin: 0, fontSize: theme.type.body.size, color: theme.textLight }}>
          Stats-only overview — pending items link to full tabs for management.
        </p>
      </div>

      {/* Stats */}
      <section aria-labelledby="stats-heading" style={{ marginBottom: 20 }}>
        <h2 id="stats-heading" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
          Hub statistics
        </h2>
        <div
          role="list"
          aria-label="Dashboard statistics"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          <div role="listitem" data-testid="stat-total-businesses">
            <StatCard
              icon={<Building2 aria-hidden="true" />}
              label="Total businesses"
              value={String(stats.total)}
              sub="All registered businesses"
            />
          </div>
          <div role="listitem" data-testid="stat-pending">
            <StatCard
              icon={<Clock aria-hidden="true" />}
              label="Vendor approvals pending"
              value={String(stats.pending)}
              tone={stats.pending > 0 ? 'warning' : undefined}
              sub="status = pending"
            />
          </div>
          <div role="listitem" data-testid="stat-active">
            <StatCard
              icon={<CheckCircle2 aria-hidden="true" />}
              label="Active users"
              value={String(stats.active)}
              tone={stats.active > 0 ? 'warning' : undefined}
              sub="status = active"
            />
          </div>
          <div role="listitem" data-testid="stat-teams">
            <StatCard
              icon={<Users aria-hidden="true" />}
              label="Admin teams"
              value={String(stats.teams)}
              sub="admin_team_members"
            />
          </div>
          <div role="listitem" data-testid="stat-ecommerce">
            <StatCard
              icon={<ShoppingBag aria-hidden="true" />}
              label="E-commerce participants"
              value={String(stats.ecommerce)}
              sub="ecommerce_enabled = true"
            />
          </div>
        </div>
      </section>

      {/* Pending lists — responsive two-column */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
        }}
      >
        {/* Pending Businesses */}
        <section aria-labelledby="pending-biz-heading">
          <Card style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 id="pending-biz-heading" style={{ margin: 0, fontSize: theme.type.h2.size, fontWeight: theme.type.h2.weight, color: theme.navy, letterSpacing: theme.type.h2.letterSpacing }}>
                Pending business approvals
              </h2>
              <Link
                to="/admin/businesses"
                aria-label="View all businesses"
                style={{ fontSize: 12.5, fontWeight: 700, color: theme.tealDeep, textDecoration: 'none' }}
              >
                View all →
              </Link>
            </div>

            {pendingBusinesses.length === 0 ? (
              <p
                data-testid="empty-businesses"
                style={{ margin: 0, padding: '18px 0', textAlign: 'center', color: theme.textLight, fontSize: 13, background: theme.bg, borderRadius: theme.radius.md, border: `1px dashed ${theme.border}` }}
              >
                No pending approvals
              </p>
            ) : (
              <ul aria-label="Pending businesses" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pendingBusinesses.map((b) => (
                  <li key={b.id} style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, background: theme.cardBg }}>
                    <Link
                      to={`/admin/businesses?id=${encodeURIComponent(b.id)}`}
                      aria-label={`View business ${b.name || b.owner_name || b.id}`}
                      style={{ display: 'block', padding: '10px 12px', textDecoration: 'none', color: 'inherit' }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: theme.navy, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.name || b.owner_name || 'Unnamed business'}
                      </div>
                      <div style={{ fontSize: 11.5, color: theme.textLight }}>
                        {b.owner_name ? `${b.owner_name}` : ''}
                        {b.owner_name && b.owner_email ? ' · ' : ''}
                        {b.owner_email ? b.owner_email : ''}
                        {!b.owner_name && !b.owner_email && b.state ? b.state : ''}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        {/* Pending Agents / Applications */}
        <section aria-labelledby="pending-agents-heading">
          <Card style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 id="pending-agents-heading" style={{ margin: 0, fontSize: theme.type.h2.size, fontWeight: theme.type.h2.weight, color: theme.navy, letterSpacing: theme.type.h2.letterSpacing }}>
                Pending agent applications
              </h2>
              <Link
                to="/admin/applications"
                aria-label="View all applications"
                style={{ fontSize: 12.5, fontWeight: 700, color: theme.tealDeep, textDecoration: 'none' }}
              >
                View all →
              </Link>
            </div>

            {pendingAgents.length === 0 ? (
              <p
                data-testid="empty-agents"
                style={{ margin: 0, padding: '18px 0', textAlign: 'center', color: theme.textLight, fontSize: 13, background: theme.bg, borderRadius: theme.radius.md, border: `1px dashed ${theme.border}` }}
              >
                No pending applications
              </p>
            ) : (
              <ul aria-label="Pending agents" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pendingAgents.map((a) => (
                  <li key={a.id} style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, background: theme.cardBg }}>
                    <Link
                      to={`/admin/applications?id=${encodeURIComponent(a.id)}`}
                      aria-label={`View application ${a.name}`}
                      style={{ display: 'block', padding: '10px 12px', textDecoration: 'none', color: 'inherit' }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: theme.navy, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.name}
                      </div>
                      {a.email && <div style={{ fontSize: 11.5, color: theme.textLight }}>{a.email}</div>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>

      {/* Accessible live region for counts */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        Total {stats.total}, pending {stats.pending}, active {stats.active}, teams {stats.teams}, ecommerce {stats.ecommerce}
      </div>
    </div>
  )
}
