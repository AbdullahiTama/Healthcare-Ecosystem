import { useState, useEffect } from 'react'
import { AlertTriangle, RefreshCw, CheckCircle, ExternalLink } from 'lucide-react'
import { Card, Empty, Loading, ErrorState } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader } from '../ui'
import { callAdminAuth } from '../adminApi'

export default function ErrorsTab({ showToast }) {
  const [errors, setErrors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('open')

  async function loadErrors() {
    setLoading(true)
    setError('')
    try {
      const { data } = await callAdminAuth('list_errors', { token: localStorage.getItem('admin_token') })
      setErrors(data || [])
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { loadErrors() }, [])

  async function resolveError(id) {
    try {
      await callAdminAuth('resolve_error', { token: localStorage.getItem('admin_token'), id })
      setErrors(prev => prev.map(e => e.id === id ? { ...e, status: 'resolved' } : e))
      showToast('Error resolved', { type: 'success' })
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
  }

  const filtered = errors.filter(e => filter === 'all' || e.status === filter)
  const openCount = errors.filter(e => e.status === 'open').length

  if (loading) return <Loading />

  if (error) return <ErrorState message={error} onRetry={loadErrors} />

  return (
    <div>
      <AdminPageHeader title="Error Inbox" subtitle={`${openCount} open errors`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={loadErrors} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700 }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </AdminPageHeader>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All' }].map(opt => (
          <button key={opt.value} onClick={() => setFilter(opt.value)} style={{ padding: '6px 14px', borderRadius: 9999, border: filter === opt.value ? '1px solid var(--teal)' : '1px solid var(--border)', background: filter === opt.value ? 'var(--teal-mist)' : 'var(--panel)', color: filter === opt.value ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {opt.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ minHeight: 108, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12 }}>
          <Empty icon={<CheckCircle size={28} />} message={filter === 'open' ? 'No open errors' : 'No errors found'} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(e => (
            <Card key={e.id} style={{ padding: 14, background: e.status === 'open' ? 'var(--panel)' : 'var(--panel)', border: e.status === 'open' ? '1px solid var(--red)' : '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={14} color={e.status === 'open' ? 'var(--red)' : 'var(--gray)'} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)' }}>{e.message || 'Unknown error'}</div>
                    {e.source && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Source: {e.source}</div>}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: e.status === 'open' ? 'var(--red)' : 'var(--gray)', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 9999, background: e.status === 'open' ? 'var(--red-bg)' : 'var(--hairline)' }}>
                  {e.status || 'open'}
                </span>
              </div>
              {e.stack && (
                <pre style={{ fontSize: 11, color: 'var(--muted-2)', background: 'var(--bg)', padding: 8, borderRadius: 6, overflow: 'auto', maxHeight: 120, marginTop: 8, marginBottom: 8, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {e.stack}
                </pre>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {e.count ? `${e.count} occurrences · ` : ''}{e.created_at ? new Date(e.created_at).toLocaleString() : ''}
                </span>
                {e.status === 'open' && (
                  <button onClick={() => resolveError(e.id)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: 'var(--green)', color: 'white', fontWeight: 700, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle size={11} /> Resolve
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
