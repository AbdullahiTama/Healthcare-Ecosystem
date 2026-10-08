import { useState, useEffect } from 'react'
import { Shield, Filter, ChevronDown } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Card, Empty } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, timeAgo } from '../ui'
import { callAdminAuth } from '../adminApi'

const ACTION_OPTIONS = [
  { value: 'all', label: 'All actions' },
  { value: 'approve', label: 'Approved' },
  { value: 'reject', label: 'Rejected' },
  { value: 'delete', label: 'Deleted' },
  { value: 'suspend', label: 'Suspended' },
  { value: 'resolve', label: 'Resolved' },
  { value: 'bulk_delete', label: 'Bulk Delete' },
  { value: 'bulk_approve', label: 'Bulk Approve' },
  { value: 'bulk_reject', label: 'Bulk Reject' },
];

const TARGET_TYPES = [
  { value: 'all', label: 'All types' },
  { value: 'post', label: 'Posts' },
  { value: 'user', label: 'Users' },
  { value: 'verification', label: 'Verifications' },
  { value: 'claim', label: 'Claims' },
  { value: 'news', label: 'News' },
  { value: 'report', label: 'Reports' },
];

export default function AuditLog() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionFilter, setActionFilter] = useState('all')
  const [targetFilter, setTargetFilter] = useState('all')
  const [actorFilter, setActorFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    loadLogs()
  }, [])

  async function loadLogs() {
    setLoading(true)
    try {
      const data = await callAdminAuth('list_audit_logs', {
        token: localStorage.getItem('admin_token'),
        limit: 200,
      })
      setLogs(data?.data || [])
    } catch {
      setLogs([])
    }
    setLoading(false)
  }

  const filtered = logs.filter((log) => {
    const matchAction = actionFilter === 'all' || log.action === actionFilter
    const matchTarget = targetFilter === 'all' || log.target_type === targetFilter
    const matchActor = !actorFilter || (log.actor_name || '').toLowerCase().includes(actorFilter.toLowerCase())
    const matchFrom = !dateFrom || log.created_at >= dateFrom
    const matchTo = !dateTo || log.created_at <= dateTo + 'T23:59:59'
    return matchAction && matchTarget && matchActor && matchFrom && matchTo
  })

  const inputStyle = {
    padding: '6px 10px',
    fontSize: 12,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radius.sm,
    background: theme.bg,
    color: theme.textDark,
    outline: 'none',
  }

  return (
    <div>
      <AdminPageHeader
        title="Audit Log"
        subtitle="Track all admin actions"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
          <Shield size={18} color={theme.tealDeep} />
          <span style={{ fontSize: theme.type.caption.size, fontWeight: 700, color: theme.textMid }}>
            {filtered.length} entries
          </span>
        </div>
      </AdminPageHeader>

      <Card style={{ padding: theme.space[4], marginBottom: theme.space[5] }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3], flexWrap: 'wrap' }}>
          <Filter size={14} color={theme.gray500} />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            style={inputStyle}
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            style={inputStyle}
          >
            {TARGET_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Filter by actor..."
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            style={{ ...inputStyle, width: 150 }}
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={inputStyle}
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={inputStyle}
          />
          <button
            onClick={loadLogs}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              background: theme.tealDeep,
              color: '#fff',
              border: 'none',
              borderRadius: theme.radius.sm,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </Card>

      {loading ? (
        <Card style={{ padding: theme.space[8], textAlign: 'center', color: theme.textMid, fontSize: 13 }}>
          Loading audit logs...
        </Card>
      ) : filtered.length === 0 ? (
        <Empty
          icon={<Shield size={40} strokeWidth={1.5} color={theme.gray300} />}
          message="No audit log entries"
          cause="none"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
          {filtered.map((log) => (
            <Card
              key={log.id}
              style={{
                padding: theme.space[4],
                display: 'flex',
                alignItems: 'center',
                gap: theme.space[4],
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    log.action === 'delete' || log.action === 'suspend' || log.action === 'bulk_delete'
                      ? theme.danger
                      : log.action === 'approve' || log.action === 'bulk_approve'
                        ? theme.success
                        : log.action === 'reject' || log.action === 'bulk_reject'
                          ? theme.warning
                          : theme.info,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3], marginBottom: 2 }}>
                  <span style={{ fontSize: theme.type.body.size, fontWeight: 700, color: theme.textDark }}>
                    {log.actor_name || 'Unknown'}
                  </span>
                  <span style={{ fontSize: theme.type.caption.size, color: theme.textMid }}>
                    {log.action?.replace(/_/g, ' ')}
                  </span>
                  <span style={{ fontSize: theme.type.caption.size, color: theme.textLight }}>
                    {log.target_type}
                  </span>
                </div>
                {log.metadata && (
                  <div style={{ fontSize: theme.type.caption.size, color: theme.textLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata)}
                  </div>
                )}
              </div>
              <div style={{ fontSize: theme.type.caption.size, color: theme.textLight, flexShrink: 0 }}>
                {timeAgo(log.created_at)}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
