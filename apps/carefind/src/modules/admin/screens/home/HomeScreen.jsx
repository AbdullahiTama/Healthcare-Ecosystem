import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle, DollarSign, FileText, Flag, Landmark, Newspaper, Shield, UserCheck, Users } from 'lucide-react'
import { DataTable, Empty, MetricGrid, Pill, SectionCard, StatCard } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../../styles/theme'
import { callAdminAuth } from '../../adminApi'
import { useAdmin } from '../../AdminGate.jsx'
import { QUEUES, usePendingCounts, useQueue } from '../../data/queues'
import { dashboardRepository } from '../../repositories/dashboardRepository'
import { ALERTS, canAccess, pathFor, screenByKey } from '../../navigation'
import HealthPulse from '../../HealthPulse.jsx'
import AdminPageHeader from '../../ui/AdminPageHeader.jsx'
import { DateRange } from '../../ui/FilterPills.jsx'
import { timeAgo } from '../../ui/adminHelpers.js'
import { useUrlFilters } from '../../ui/useUrlFilters.js'
import { primaryCell } from '../../ui/tableHelpers.jsx'

const DEFAULTS = { from: '', to: '' }
const UNAVAILABLE = 'Unavailable'
const LONGEST = 8

// How each queue names an item, and which screen opens it.
const QUEUE_VIEW = {
  verifications: { label: 'Verifications', one: 'Verification', icon: <UserCheck />, title: r => r.full_name || 'Unnamed applicant' },
  claims: { label: 'Claims', one: 'Claim', icon: <Shield />, title: r => r.businesses?.name || 'Unknown business' },
  reports: { label: 'Reports', one: 'Report', icon: <Flag />, title: r => r.reason || 'No reason given' },
  news: { label: 'News', one: 'News', icon: <Newspaper />, title: r => r.headline || 'Untitled article' },
  withdrawals: { label: 'Withdrawals', one: 'Withdrawal', icon: <Landmark />, title: r => r.profiles?.full_name || 'Withdrawal request' },
}
const NAMES = Object.keys(QUEUE_VIEW)

const naira = (kobo) => `₦${Math.round(kobo / 100).toLocaleString()}`

export default function HomeScreen() {
  const admin = useAdmin()
  const navigate = useNavigate()
  const [f, setF] = useUrlFilters(DEFAULTS)
  const { counts, total, failed } = usePendingCounts()

  // Hooks cannot be called in a loop; one call per queue, in a fixed order.
  const queues = {
    verifications: useQueue('verifications'),
    claims: useQueue('claims'),
    reports: useQueue('reports'),
    news: useQueue('news'),
    withdrawals: useQueue('withdrawals'),
  }
  const permitted = NAMES.filter(name => canAccess(screenByKey(QUEUES[name].permission), admin))

  const canSeeRevenue = canAccess(screenByKey('revenue'), admin)
  const totalsQ = useQuery({ queryKey: ['admin', 'home-totals'], queryFn: () => dashboardRepository.getTotals(), staleTime: 60000 })
  const txQ = useQuery({
    queryKey: ['admin', 'transactions'],
    queryFn: async () => (await callAdminAuth('list_transactions', {}))?.data || [],
    enabled: canSeeRevenue,
    staleTime: 60000,
  })

  const waiting = useMemo(() => {
    const all = []
    for (const name of permitted) {
      for (const row of queues[name].data || []) {
        if (!QUEUES[name].isPending(row)) continue
        all.push({ id: `${name}:${row.id}`, recordId: row.id, queue: name, title: QUEUE_VIEW[name].title(row), created_at: row.created_at })
      }
    }
    // Oldest first; items with no date sink to the bottom.
    all.sort((a, b) => (a.created_at || '9999').localeCompare(b.created_at || '9999'))
    return all
  }, [permitted.join(','), ...NAMES.map(n => queues[n].data)])

  const oldest = (name) => waiting.find(w => w.queue === name)?.created_at

  const revenue = useMemo(() => {
    const from = f.from || '0000'
    const to = f.to ? `${f.to}T23:59:59` : '9999'
    return (txQ.data || [])
      .filter(t => t.type === 'topup' && (t.created_at || '') >= from && (t.created_at || '') <= to)
      .reduce((sum, t) => sum + (t.naira_amount || 0), 0)
  }, [txQ.data, f.from, f.to])

  const open = (item) => navigate(`${pathFor(QUEUES[item.queue].permission)}?id=${encodeURIComponent(item.recordId)}`)

  // Until every permitted queue has answered, a zero total means "not known
  // yet", not "nothing to do".
  const loading = permitted.some(name => queues[name].isLoading)
  // A queue that failed to load is unknown, never "clear".
  const allFailed = permitted.length > 0 && permitted.every(name => queues[name].isError)
  const countText = `${total} ${total === 1 ? 'item needs' : 'items need'} attention`
  let subtitle
  if (allFailed) subtitle = 'The queues could not be loaded'
  else if (failed) subtitle = total > 0 ? `${countText}; some queues could not be loaded` : 'Some queues could not be loaded'
  else if (total > 0) subtitle = `${countText} across ${permitted.length} ${permitted.length === 1 ? 'queue' : 'queues'}`
  else subtitle = loading ? 'Checking the queues…' : 'Nothing needs attention right now'

  const columns = [
    { key: 'title', label: 'Item', render: i => primaryCell({ title: i.title, onOpen: () => open(i), openLabel: `Open ${i.title}` }) },
    { key: 'queue', label: 'Queue', render: i => <Pill label={QUEUE_VIEW[i.queue].one} type="amber" /> },
    { key: 'created_at', label: 'Waiting', render: i => (i.created_at ? timeAgo(i.created_at) : '—') },
  ]

  // The admin API returns only its most recent transactions, so this figure
  // is a floor, not a total. Say so rather than present it as period revenue.
  const revenueNote = `Revenue is added up from the most recent transactions only${f.from || f.to ? ', within the dates chosen' : ''}, so the true figure can be higher.`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[10] }}>
      <AdminPageHeader title="Home" subtitle={subtitle} />

      <MetricGrid label="Queues">
        {permitted.map(name => {
          const count = counts[name]
          const since = oldest(name)
          return (
            <StatCard
              key={name}
              icon={QUEUE_VIEW[name].icon}
              label={QUEUE_VIEW[name].label}
              value={count === null || count === undefined ? UNAVAILABLE : count}
              tone={count > 0 ? 'warning' : undefined}
              sub={count > 0 && since ? `oldest ${timeAgo(since)}` : count === 0 ? 'clear' : undefined}
              onClick={() => navigate(pathFor(QUEUES[name].permission))}
            />
          )
        })}
      </MetricGrid>

      <SectionCard title="Waiting longest" sub={failed ? 'Some queues could not be loaded, so this list may be incomplete.' : undefined} bodyStyle={{ padding: 0 }}>
        <DataTable
          rows={waiting.slice(0, LONGEST)}
          columns={columns}
          onRowClick={open}
          loading={loading}
          empty={failed
            ? <Empty icon={<AlertTriangle size={40} strokeWidth={1.5} color={theme.gray300} />} message="Nothing can be shown until the queues load." />
            : <Empty icon={<CheckCircle size={40} strokeWidth={1.5} color={theme.gray300} />} message="All queues are clear" />}
        />
      </SectionCard>

      <SectionCard title="Platform" sub={canSeeRevenue ? revenueNote : undefined}>
        <MetricGrid label="Platform totals">
          <StatCard icon={<Users />} label="Users" value={totalsQ.isError ? UNAVAILABLE : (totalsQ.data ? totalsQ.data.users.toLocaleString() : '…')} />
          <StatCard icon={<FileText />} label="Posts" value={totalsQ.isError ? UNAVAILABLE : (totalsQ.data ? totalsQ.data.posts.toLocaleString() : '…')} />
          {canSeeRevenue && (
            <StatCard icon={<DollarSign />} label="Revenue" value={txQ.isError ? UNAVAILABLE : (txQ.data ? naira(revenue) : '…')} onClick={() => navigate(pathFor('revenue'))} />
          )}
        </MetricGrid>
        {canSeeRevenue && (
          <div style={{ marginTop: theme.space[8], maxWidth: 420 }}>
            <DateRange from={f.from} to={f.to} onFrom={(from) => setF({ from })} onTo={(to) => setF({ to })} />
          </div>
        )}
      </SectionCard>

      <HealthPulse
        onNavigate={(key) => navigate(pathFor(key))}
        canSee={(key) => canAccess(key === ALERTS.key ? ALERTS : screenByKey(key), admin)}
      />
    </div>
  )
}
