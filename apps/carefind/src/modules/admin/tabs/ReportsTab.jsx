import { AlertTriangle, Trash2, CheckCircle } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Button, Card, StatusBadge, Empty } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader } from '../ui'

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function ReportsTab({ reports, deletePost, resolveReport }) {
  return (
    <div>
      <AdminPageHeader
        title="Post Reports"
        subtitle="Review reported posts and take action"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
          <AlertTriangle size={18} color={theme.danger} />
          <span style={{ fontSize: theme.type.caption.size, fontWeight: 700, color: theme.textMid }}>
            {reports.filter(r => r.status === 'pending').length} pending
          </span>
        </div>
      </AdminPageHeader>

      {reports.length === 0 ? (
        <Empty
          icon={<AlertTriangle size={40} strokeWidth={1.5} color={theme.gray300} />}
          message="No reports yet"
          cause="none"
        />
      ) : (
        reports.map(r => (
          <Card
            key={r.id}
            style={{
              padding: theme.space[5],
              marginBottom: theme.space[4],
              borderColor: r.status === 'pending' ? theme.warning : theme.border,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.space[3] }}>
              <div
                style={{
                  fontSize: theme.type.caption.size,
                  fontWeight: 800,
                  color: theme.danger,
                  padding: `${theme.space[2]} ${theme.space[3]}`,
                  background: theme.dangerBg,
                  borderRadius: theme.radius.sm,
                }}
              >
                {r.reason}
              </div>
              <StatusBadge status={r.status} />
            </div>

            {r.posts?.content && (
              <div
                style={{
                  padding: theme.space[3],
                  background: theme.bg,
                  borderRadius: theme.radius.sm,
                  marginBottom: theme.space[3],
                  fontSize: theme.type.body.size,
                  color: theme.textMid,
                  lineHeight: 1.5,
                }}
              >
                {r.posts.content.slice(0, 120)}{r.posts.content.length > 120 ? '…' : ''}
              </div>
            )}

            <div style={{ fontSize: theme.type.caption.size, color: theme.textLight, marginBottom: theme.space[4] }}>
              {timeAgo(r.created_at)}
            </div>

            {r.status === 'pending' && (
              <div style={{ display: 'flex', gap: theme.space[3] }}>
                <Button
                  variant="danger"
                  size="sm"
                  fullWidth
                  leftIcon={<Trash2 size={14} />}
                  onClick={() => deletePost(r.post_id)}
                >
                  Delete Post
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  leftIcon={<CheckCircle size={14} />}
                  onClick={() => resolveReport(r.id)}
                >
                  Dismiss
                </Button>
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  )
}
