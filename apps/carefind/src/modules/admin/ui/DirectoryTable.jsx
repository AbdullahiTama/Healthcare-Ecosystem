import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, DataTable, Empty } from '@care-ecosystem/design-system/components/ui'
import ReviewDrawer from './ReviewDrawer.jsx'
import { useDebounced } from './useDebounced.js'
import { useAdmin } from '../provider/AdminProvider.jsx'
import './admin.css'

const SEARCH_DELAY_MS = 300

// One server-paged directory for Users and Businesses: debounced search, a
// filter row, the shared DataTable, a pager and a drawer for one row. The list
// is only ever shown as loading, failed, empty or loaded; a failed list shows
// Retry and never an empty message.
export default function DirectoryTable({
  title, noun, query, columns, search, onSearch, searchPlaceholder, filters,
  filtersActive, onClear, page, onPage, pageSize, renderDrawer, toolbar, rowLabel,
}) {
  const [openId, setOpenId] = useState(null)
  const [error, setError] = useState('')
  const { confirming } = useAdmin()

  // Search box: local text, pushed up only after typing stops and only when it
  // changes the applied search. `search` going to '' from outside resets the box.
  const [text, setText] = useState(search)
  const debounced = useDebounced(text, SEARCH_DELAY_MS)
  const latest = useRef({ search, onSearch })
  useEffect(() => { latest.current = { search, onSearch } })
  useEffect(() => {
    const next = debounced.trim()
    if (next !== latest.current.search) latest.current.onSearch(next)
  }, [debounced])
  useEffect(() => { if (search === '') setText('') }, [search])

  const { isLoading, isError, isPlaceholderData, refetch } = query
  const data = query.data
  const rows = useMemo(() => data?.rows || [], [data])
  const ready = !isLoading && !isError
  // Only a real (not placeholder) list lacking the row clears the selection; a
  // failed refresh keeps it, and the drawer returns if the list recovers with it.
  const loaded = !!data && !isPlaceholderData && !isError

  const current = openId == null ? null : rows.find(r => r.id === openId) || null
  useEffect(() => {
    if (openId != null && loaded && !current) { setOpenId(null); setError('') }
  }, [openId, loaded, current])

  const open = (row) => { setError(''); setOpenId(row.id) }
  const close = () => { setOpenId(null); setError('') }
  const drawer = current ? renderDrawer(current, { close, setError }) : null

  // While a new query loads over the previous page, that page's grand total is
  // stale, so the count is withheld until the real result arrives.
  const countText = !ready ? undefined
    : isPlaceholderData ? 'Updating…'
      : data?.total != null ? `${data.total} ${noun}${data.total === 1 ? '' : 's'}` : `${rows.length} shown`

  const empty = filtersActive
    ? (
      <div>
        <Empty message={`No ${noun}s match these filters`} cause="none" />
        <Button size="sm" variant="ghost" onClick={onClear}>Clear filters</Button>
      </div>
    )
    : <Empty message={`No ${noun}s yet`} cause="none" />

  return (
    <div className="adm-page">
      <div className="adm-head">
        <h1>{title}</h1>
        {toolbar}
      </div>

      <div className="adm-dir-bar">
        <input
          type="text"
          className="adm-dir-search"
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {filters}
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        loading={isLoading}
        error={isError ? "Couldn't load this list." : undefined}
        onRetry={refetch}
        empty={empty}
        count={countText}
        onRowClick={open}
        actions={(row) => (
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); open(row) }} aria-label={`Review ${rowLabel(row)}`}>
            Review
          </Button>
        )}
      />

      {ready && (
        <nav className="adm-dir-pager" aria-label={`${title} pages`}>
          <Button size="sm" variant="ghost" disabled={page <= 0} onClick={() => onPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="ghost" disabled={!data?.hasNext} onClick={() => onPage(page + 1)}>Next</Button>
        </nav>
      )}

      <ReviewDrawer show={!!current} title={current ? (drawer?.title ?? rowLabel(current)) : ''} status={drawer?.status} onClose={close} error={error} footer={drawer?.footer} preventClose={confirming}>
        {drawer?.body}
      </ReviewDrawer>
    </div>
  )
}
