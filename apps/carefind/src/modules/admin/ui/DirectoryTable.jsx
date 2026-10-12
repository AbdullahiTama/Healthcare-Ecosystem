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
  title, noun, plural, query, columns, search, onSearch, searchPlaceholder, filters,
  filtersActive, onClear, page, onPage, renderDrawer, toolbar, rowLabel,
}) {
  // `plural` is only needed when `${noun}s` is not the plural (business, businesses).
  const nouns = plural || `${noun}s`
  // The open row is kept as a snapshot, so the drawer is independent of the page.
  const [opened, setOpened] = useState(null)
  const [error, setError] = useState('')
  const { confirming } = useAdmin()

  // Search box: local text, pushed up only after typing stops and only when it
  // changes the applied search. Only `search` going to '' from outside (Clear
  // filters) is mirrored into the box; a new non-empty value from outside (e.g.
  // a URL param) is not. The box is reset during render, so the apply effect
  // never sees the stale text. A value is applied only once the debounced value
  // has caught up with the box: a stale debounced value is never re-applied
  // after a reset, and retyping the term that was cleared still applies it.
  const [text, setText] = useState(search)
  const [prevSearch, setPrevSearch] = useState(search)
  if (search !== prevSearch) {
    setPrevSearch(search)
    if (search === '') setText('')
  }
  const debounced = useDebounced(text, SEARCH_DELAY_MS)
  const latest = useRef({ search, onSearch })
  useEffect(() => { latest.current = { search, onSearch } })
  useEffect(() => {
    if (debounced !== text) return
    const next = debounced.trim()
    if (next !== latest.current.search) latest.current.onSearch(next)
  }, [debounced, text])

  const { isLoading, isError, isPlaceholderData, refetch } = query
  const data = query.data
  const rows = useMemo(() => data?.rows || [], [data])
  const ready = !isLoading && !isError

  // A directory row leaving the current page means nothing: the lists are
  // newest-first with offset paging and refresh on every insert and a 30 s poll,
  // so one signup moves a row to the next page. The drawer therefore shows the
  // row's fresh data while it is on the page and the latest snapshot otherwise,
  // and closes only when the admin closes it or an action calls `close`.
  const fresh = opened == null ? null : rows.find(r => r.id === opened.id) || null
  useEffect(() => { if (fresh && fresh !== opened) setOpened(fresh) }, [fresh, opened])
  const current = fresh || opened

  const open = (row) => { setError(''); setOpened(row) }
  const close = () => { setOpened(null); setError('') }
  const drawer = current ? renderDrawer(current, { close, setError }) : null

  // While a new query loads over the previous page, that page's grand total is
  // stale, so the count is withheld until the real result arrives.
  const countText = !ready ? undefined
    : isPlaceholderData ? 'Updating…'
      : data?.total != null ? `${data.total} ${data.total === 1 ? noun : nouns}` : `${rows.length} shown`

  const empty = isPlaceholderData
    ? <p className="adm-note">Updating…</p>
    : page > 0
    ? (
      <div>
        <Empty message={`No ${nouns} on this page`} cause="none" />
        <Button size="sm" variant="ghost" onClick={() => onPage(0)}>Back to first page</Button>
      </div>
    )
    : filtersActive
    ? (
      <div>
        <Empty message={`No ${nouns} match these filters`} cause="none" />
        <Button size="sm" variant="ghost" onClick={onClear}>Clear filters</Button>
      </div>
    )
    : <Empty message={`No ${nouns} yet`} cause="none" />

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
          <Button size="sm" variant="ghost" disabled={page <= 0 || isPlaceholderData} onClick={() => onPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="ghost" disabled={!data?.hasNext || isPlaceholderData} onClick={() => onPage(page + 1)}>Next</Button>
        </nav>
      )}

      <ReviewDrawer show={!!current} title={current ? (drawer?.title ?? rowLabel(current)) : ''} status={drawer?.status} onClose={close} error={error} footer={drawer?.footer} preventClose={confirming}>
        {drawer?.body}
      </ReviewDrawer>
    </div>
  )
}
