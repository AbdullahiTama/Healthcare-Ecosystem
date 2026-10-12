import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminTransport } from '../repositories/transport'
import MetricStrip from '../ui/MetricStrip.jsx'
import '../ui/admin.css'

// "Activity in range": new users and new posts between two dates. Both are
// head counts on the server, so they are exact (the old panel counted rows in
// the 50 newest posts and 100 newest users it had loaded).

const settle = async (promise) => {
  try { return { status: 'ok', data: await promise } } catch { return { status: 'error' } }
}

const headCount = (table, filters) =>
  adminTransport.query(table, { select: 'id', count: 'head', filters }).then(r => {
    if (typeof r.count !== 'number') throw new Error(`No count for ${table}`)
    return r.count
  })

function boundsFilters(from, to) {
  const filters = []
  if (from) filters.push({ op: 'gte', col: 'created_at', val: `${from}T00:00:00.000Z` })
  if (to) filters.push({ op: 'lte', col: 'created_at', val: `${to}T23:59:59.999Z` })
  return filters
}

export default function ActivityRange() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const backwards = !!(from && to && from > to)
  const active = (from || to) && !backwards

  const { data, refetch } = useQuery({
    queryKey: ['admin', 'activity-range', from, to],
    enabled: !!active,
    queryFn: async () => {
      const filters = boundsFilters(from, to)
      const [users, posts] = await Promise.all([settle(headCount('profiles', filters)), settle(headCount('posts', filters))])
      return { users, posts }
    },
  })

  const cellOf = (key, label, source) => ({
    key, label, onRetry: refetch,
    status: !source ? 'loading' : source.status,
    value: source?.data?.toLocaleString(),
  })

  return (
    <section className="adm-panel" aria-labelledby="adm-range-title">
      <div className="adm-phead"><h2 id="adm-range-title">Activity in range</h2></div>
      <div className="adm-range">
        <label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        {(from || to) && <button type="button" className="adm-btn-reset adm-retry" onClick={() => { setFrom(''); setTo('') }}>Clear dates</button>}
      </div>
      {backwards && <p className="adm-notice" role="alert">The From date is after the To date. Choose a range that ends after it starts.</p>}
      {active && (
        <MetricStrip label="Activity in the chosen dates" items={[cellOf('users', 'New users', data?.users), cellOf('posts', 'New posts', data?.posts)]} />
      )}
    </section>
  )
}
