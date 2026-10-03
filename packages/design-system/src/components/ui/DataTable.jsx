import { useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { theme } from '../../theme'
import { useBreakpoint } from './useBreakpoint'
import { Card } from './Card'
import { CardSkeleton } from './State'
import { Empty } from './State'
import { ErrorState } from './State'

// DataTable (Stage 3 / Slice 6). Promoted from CareHub's table/card list into
// the shared package so CareFind can use the same table. One column model
// renders as either a desktop <table> (with an automatic mobile → card-list
// transform) or a rich card list (`variant="cards"`).
//
// States: `loading` → skeleton rows; `error` → ErrorState with retry; empty →
// shared Empty (or the caller's `empty`). Sorting: mark columns `sortable`,
// with optional `sortValue(row)` for computed values; nulls always sort last.
// `actions(row)`: optional trailing column of per-row controls.
// `onRowClick`/`rowStyle`: row interaction (rowStyle can tint rows, e.g. the
// Inventory low-stock / Appointments "today" highlights).
// Pagination is fully controlled: pass `page`, `setPage`, `pageSize`, and
// optionally `total` (when rows are a slice of a larger set).
// `mobileCard(row)` (table variant only): the mobile card-list transform;
// defaults to a label/value card built from the columns.
// `renderCard(row)` (cards variant only): the rich card body.
//
// The row hover is handled by an injected `.ds-data-row` rule (inline styles
// cannot express :hover); it replaces CareHub's app-scoped `.ch-data-row`.
const DATA_ROW_STYLES = `
.ds-data-row td { transition: background 0.12s ease; }
.ds-data-row:hover td { background: ${theme.gray50}; }`
if (typeof document !== 'undefined' && !document.getElementById('ds-data-row-styles')) {
  const style = document.createElement('style')
  style.id = 'ds-data-row-styles'
  style.textContent = DATA_ROW_STYLES
  document.head.appendChild(style)
}

const thStyle = {
  padding: '12px 14px', fontSize: 11, fontWeight: 700, color: theme.gray400,
  textTransform: 'uppercase', whiteSpace: 'nowrap',
}
const cellStyle = { padding: '12px 14px' }
const labelStyle = { fontSize: 11, fontWeight: 700, color: theme.gray400, textTransform: 'uppercase' }
const valueStyle = { fontSize: 13, color: theme.navy, textAlign: 'right' }

export function DataTable({ rows = [], columns = [], actions, onRowClick, rowStyle, count, empty, loading, error, onRetry, page, setPage, pageSize, total, variant = 'table', renderCard, mobileCard }) {
  const { isMobile } = useBreakpoint()
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const sortable = columns.some(c => c.sortable)
  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find(c => c.key === sortKey)
    if (!col) return rows
    const get = col.sortValue || (r => r[col.key])
    const dir = sortDir === 'desc' ? -1 : 1
    return [...rows].sort((a, b) => {
      const av = get(a); const bv = get(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [rows, columns, sortKey, sortDir])

  const hasPagination = pageSize != null && setPage != null && page != null
  const pageCount = hasPagination ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  const safePage = hasPagination ? Math.min(page, pageCount - 1) : 0
  const visible = hasPagination ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted
  const shown = total != null ? total : rows.length

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[6] }}>
      {[0, 1, 2].map(i => <CardSkeleton key={i} />)}
    </div>
  )
  if (error) return <ErrorState message={error} onRetry={onRetry} />
  if (rows.length === 0) return empty || <Empty message="Nothing here yet" />

  const toggleSort = (col) => {
    if (!col.sortable) return
    if (sortKey !== col.key) { setSortKey(col.key); setSortDir('asc'); return }
    setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
  }

  const sortBar = sortable && variant === 'cards' && (
    <div role="group" aria-label="Sort" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: theme.space[6] }}>
      {columns.filter(c => c.sortable).map(c => {
        const active = sortKey === c.key
        return (
          <button key={c.key} onClick={() => toggleSort(c)} aria-pressed={active}
            style={{ padding: '6px 12px', borderRadius: theme.radius.full, border: active ? `1px solid ${theme.tealDeep}` : `1px solid ${theme.border}`, background: active ? theme.tealMist : 'white', color: active ? theme.tealDeep : theme.gray600, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {c.label}
            {active && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
          </button>
        )
      })}
    </div>
  )

  const countLine = (count || shown) != null && (
    <div style={{ fontSize: 12, color: theme.gray500, marginBottom: theme.space[6], fontWeight: 600 }}>{count || `${shown} item${shown !== 1 ? 's' : ''}`}</div>
  )

  const defaultCardBody = (row) => (
    <div>
      {columns.map(c => (
        <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: `1px solid ${theme.gray100}` }}>
          <span style={labelStyle}>{c.label}</span>
          <span style={valueStyle}>{c.render ? c.render(row) : String(row[c.key] ?? '—')}</span>
        </div>
      ))}
    </div>
  )

  const actionsRow = (row) => actions && (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: theme.space[6] }}>{actions(row)}</div>
  )

  const pagination = (inside) => hasPagination && pageCount > 1 && (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...(inside ? { padding: '12px 14px', borderTop: `1px solid ${theme.border}` } : { padding: '12px 4px' }), fontSize: 12, color: theme.gray500 }}>
      <span>{safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, shown)} of {shown}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setPage(Math.max(0, page - 1))} disabled={safePage === 0} aria-label="Previous page" style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${theme.border}`, background: safePage === 0 ? theme.gray100 : 'white', color: safePage === 0 ? theme.gray400 : theme.navy, fontWeight: 700, fontSize: 12, cursor: safePage === 0 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ChevronLeft size={13} /> {inside ? 'Previous' : 'Prev'}</button>
        <button onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={safePage >= pageCount - 1} aria-label="Next page" style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${theme.border}`, background: safePage >= pageCount - 1 ? theme.gray100 : 'white', color: safePage >= pageCount - 1 ? theme.gray400 : theme.navy, fontWeight: 700, fontSize: 12, cursor: safePage >= pageCount - 1 ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Next <ChevronRight size={13} /></button>
      </div>
    </div>
  )

  // ── CARDS VARIANT (rich card lists: Orders, Stock, Clients) ────────────────
  if (variant === 'cards') {
    return (
      <div>
        {countLine}
        {sortBar}
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[6] }}>
          {visible.map(row => (
            <Card key={row.id} onClick={onRowClick ? () => onRowClick(row) : undefined} style={{ padding: 0, overflow: 'hidden', ...(rowStyle ? rowStyle(row) : {}) }}>
              {renderCard ? renderCard(row) : (
                <div style={{ padding: theme.space[8] }}>
                  {defaultCardBody(row)}
                  {actionsRow(row)}
                </div>
              )}
            </Card>
          ))}
        </div>
        {pagination(false)}
      </div>
    )
  }

  // ── TABLE VARIANT ──────────────────────────────────────────────────────────
  // Mobile → card-list transform: at phone width the same column model renders
  // as stacked cards (or the caller's `mobileCard`) instead of a horizontal-
  // scroll table, matching the mobile-first pattern for long lists.
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[6] }}>
        {countLine}
        {visible.map(row => (
          <Card key={row.id} onClick={onRowClick ? () => onRowClick(row) : undefined} style={{ padding: theme.space[8], ...(rowStyle ? rowStyle(row) : {}) }}>
            {mobileCard ? mobileCard(row) : (
              <div>
                {defaultCardBody(row)}
                {actionsRow(row)}
              </div>
            )}
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div>
      {countLine}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border}`, background: theme.gray50 }}>
                {columns.map(c => (
                  <th key={c.key}
                    aria-sort={c.sortable && sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => toggleSort(c)}
                    style={{ ...thStyle, textAlign: c.align || 'left', cursor: c.sortable ? 'pointer' : 'default', userSelect: 'none' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {c.label}
                      {c.sortable && sortKey === c.key && (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </span>
                  </th>
                ))}
                {actions && <th style={{ ...thStyle, textAlign: 'left' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(row => (
                <tr key={row.id} className="ds-data-row" onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{ borderBottom: `1px solid ${theme.gray100}`, cursor: onRowClick ? 'pointer' : 'default', transition: 'background 0.12s ease', ...(rowStyle ? rowStyle(row) : {}) }}>
                  {columns.map(c => (
                    <td key={c.key} style={{ ...cellStyle, textAlign: c.align || 'left' }}>{c.render ? c.render(row) : String(row[c.key] ?? '—')}</td>
                  ))}
                  {actions && <td style={cellStyle}>{actions(row)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pagination(true)}
      </Card>
    </div>
  )
}

export default DataTable
