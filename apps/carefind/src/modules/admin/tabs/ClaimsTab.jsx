import { Building2, CheckCircle, XCircle } from 'lucide-react'
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

export default function ClaimsTab({ claims, approveClaim, rejectClaim }) {
  return (
    <div>
      <AdminPageHeader
        title="Business Claims"
        subtitle="Review ownership claims for business listings"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
          <Building2 size={18} color={theme.tealDeep} />
          <span style={{ fontSize: theme.type.caption.size, fontWeight: 700, color: theme.textMid }}>
            {claims.filter(c => c.status === 'pending').length} pending
          </span>
        </div>
      </AdminPageHeader>

      {claims.length === 0 ? (
        <Empty
          icon={<Building2 size={40} strokeWidth={1.5} color={theme.gray300} />}
          message="No business claims yet"
          cause="none"
        />
      ) : (
        claims.map(c => (
          <Card
            key={c.id}
            style={{
              padding: theme.space[5],
              marginBottom: theme.space[4],
              borderColor: c.status === 'pending' ? theme.warning : theme.border,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.space[4] }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: theme.type.h3.size, color: theme.textDark, marginBottom: theme.space[1] }}>
                  {c.businesses?.name}
                </div>
                <div style={{ fontSize: theme.type.caption.size, color: theme.textLight }}>
                  {timeAgo(c.created_at)}
                </div>
              </div>
              <StatusBadge status={c.status} />
            </div>

            {c.status === 'pending' && (
              <div style={{ display: 'flex', gap: theme.space[3] }}>
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth
                  leftIcon={<CheckCircle size={14} />}
                  onClick={() => approveClaim(c.id, c.business_id)}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  fullWidth
                  leftIcon={<XCircle size={14} />}
                  onClick={() => rejectClaim(c.id)}
                >
                  Reject
                </Button>
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  )
}
