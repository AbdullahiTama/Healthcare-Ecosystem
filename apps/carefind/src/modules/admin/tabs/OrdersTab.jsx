import { useState, useEffect, useCallback } from 'react'
import { Search, Download, RefreshCw } from 'lucide-react'
import { Card, Empty, Loading, ErrorState } from '@care-ecosystem/design-system/components/ui'
import { StatusDot } from '../components/StatusDot'
import { RowActions } from '../components/RowActions'
import { AdminPageHeader } from '../ui'

export default function OrdersTab({ transactions = [], showToast, loadAll }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 15

  const filtered = transactions.filter(t => {
    const matchSearch = !search || (t.description || '').toLowerCase().includes(search.toLowerCase()) || (t.user_id || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || t.status === statusFilter
    return matchSearch && matchStatus
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  const statusColor = (s) => {
    if (s === 'completed' || s === 'success') return 'var(--green)'
    if (s === 'pending' || s === 'processing') return 'var(--amber)'
    if (s === 'failed' || s === 'refunded') return 'var(--red)'
    return 'var(--gray)'
  }

  return (
    <div>
      <AdminPageHeader title="Orders" subtitle={`${transactions.length} total transactions`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={loadAll} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700 }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </AdminPageHeader>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search transactions..." aria-label="Search transactions" style={{ width: '100%', padding: '10px 12px 10px 30px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: 'var(--panel)', color: 'var(--fg)', boxSizing: 'border-box' }} />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter by status" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: 'var(--panel)', color: 'var(--fg)' }}>
          <option value="">All statuses</option>
          <option value="completed">Completed</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} results · page {page}/{totalPages}</span>
      </div>

      {visible.length === 0 ? (
        <div style={{ minHeight: 108, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <Empty message="No transactions found" />
        </div>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
                <tr style={{ height: 36 }}>
                  <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Type</th>
                  <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Description</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Amount</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Status</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(t => (
                  <tr key={t.id} className="ds-data-row" style={{ height: 36, borderBottom: '1px solid var(--hairline)' }}>
                    <td style={{ padding: '0 12px', color: 'var(--muted)', fontSize: 12, textTransform: 'capitalize' }}>{t.type || '—'}</td>
                    <td style={{ padding: '0 12px', color: 'var(--fg)', fontSize: 13, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '—'}</td>
                    <td style={{ padding: '0 12px', textAlign: 'right', fontWeight: 700, color: 'var(--fg)' }}>₦{(t.naira_amount || 0).toLocaleString()}</td>
                    <td style={{ padding: '0 12px', textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: statusColor(t.status) }}>
                        <StatusDot status={t.status} /> {t.status || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '0 12px', textAlign: 'right', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 12 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: page <= 1 ? 'var(--hairline)' : 'var(--panel)', color: page <= 1 ? 'var(--muted-2)' : 'var(--fg)', fontWeight: 700, fontSize: 12, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>Prev</button>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: page >= totalPages ? 'var(--hairline)' : 'var(--panel)', color: page >= totalPages ? 'var(--muted-2)' : 'var(--fg)', fontWeight: 700, fontSize: 12, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>Next</button>
        </div>
      )}
    </div>
  )
}
