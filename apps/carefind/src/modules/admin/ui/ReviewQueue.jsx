import { useEffect, useMemo, useState } from 'react'
import { Button, DataTable, Empty } from '@care-ecosystem/design-system/components/ui'
import ReviewDrawer from './ReviewDrawer.jsx'
import { useAdmin } from '../provider/AdminProvider.jsx'
import './admin.css'

// One review queue for Verification, Claims and Reports: status tabs, the
// shared DataTable, and a drawer for the full request. A list that failed shows
// as failed, never as an empty queue.
export default function ReviewQueue({
  title, source, onRetry, columns, isOpen, cap, nothingWaiting, noneYet,
  drawerTitle, renderDrawer, toolbar, rowId = r => r.id, drawerStatus = r => r.status,
}) {
  const [view, setView] = useState('pending')
  const [openId, setOpenId] = useState(null)
  const [error, setError] = useState('')
  const { confirming } = useAdmin()

  const loading = !source
  const failed = source?.status === 'error'
  const data = source?.status === 'ok' ? source.data : null
  const all = useMemo(() => data || [], [data])
  const waiting = useMemo(() => all.filter(isOpen), [all, isOpen])
  const rows = view === 'pending' ? waiting : all
  const atCap = cap != null && all.length >= cap

  const current = openId == null ? null : all.find(r => rowId(r) === openId) || null
  // The row was resolved elsewhere (or the list refreshed without it): only a
  // loaded list that lacks the row clears the selection. While a refresh has
  // failed there is no row to show, so the drawer hides but the selection is
  // kept, and the drawer reappears if the list recovers with the row in it.
  useEffect(() => {
    if (openId != null && data && !current) { setOpenId(null); setError('') }
  }, [openId, data, current])

  const open = (row) => { setError(''); setOpenId(rowId(row)) }
  const close = () => { setOpenId(null); setError('') }
  const drawer = current ? renderDrawer(current, { close, setError }) : null
  const ready = !loading && !failed
  const plus = atCap ? '+' : ''

  const empty = <Empty message={view === 'pending' ? nothingWaiting : noneYet} cause={view === 'pending' ? 'positive' : 'none'} />

  return (
    <div className="adm-page">
      <div className="adm-head">
        <h1>{title}</h1>
        {toolbar}
      </div>

      <div role="tablist" aria-label={`${title} filter`} className="adm-tabs">
        <button type="button" role="tab" aria-selected={view === 'pending'} className="adm-btn-reset adm-tab adm-num" onClick={() => setView('pending')}>
          Pending{ready ? ` (${waiting.length}${plus})` : ''}
        </button>
        <button type="button" role="tab" aria-selected={view === 'all'} className="adm-btn-reset adm-tab adm-num" onClick={() => setView('all')}>
          All{ready ? ` (${all.length}${plus})` : ''}
        </button>
      </div>
      {atCap && <p className="adm-note">The server returns at most {cap} items, so there may be older items not shown.</p>}

      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        error={failed ? "Couldn't load this list." : undefined}
        onRetry={onRetry}
        empty={empty}
        onRowClick={open}
        actions={(row) => (
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); open(row) }} aria-label={`Review ${drawerTitle(row)}`}>
            Review
          </Button>
        )}
      />

      <ReviewDrawer show={!!current} title={current ? drawerTitle(current) : ''} status={current ? drawerStatus(current) : undefined} onClose={close} error={error} footer={drawer?.footer} preventClose={confirming}>
        {drawer?.body}
      </ReviewDrawer>
    </div>
  )
}
