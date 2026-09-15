import { Shield, CheckCircle, XCircle, FileText, ExternalLink } from 'lucide-react'
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

export default function VerificationsTab({
  verifications,
  openCredential,
  credentialLoadingId,
  credentialError,
  approveVerif,
  rejectVerif,
}) {
  return (
    <div>
      <AdminPageHeader
        title="Verification Requests"
        subtitle="Review and manage professional verification submissions"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
          <Shield size={18} color={theme.tealDeep} />
          <span style={{ fontSize: theme.type.caption.size, fontWeight: 700, color: theme.textMid }}>
            {verifications.filter(v => v.status === 'pending').length} pending
          </span>
        </div>
      </AdminPageHeader>

      {verifications.length === 0 ? (
        <Empty
          icon={<Shield size={40} strokeWidth={1.5} color={theme.gray300} />}
          message="No verification requests yet"
          cause="none"
        />
      ) : (
        verifications.map(v => (
          <Card
            key={v.id}
            style={{
              padding: theme.space[5],
              marginBottom: theme.space[4],
              borderColor: v.status === 'pending' ? theme.warning : theme.border,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.space[4] }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3], marginBottom: theme.space[2] }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: theme.radius.full,
                      background: theme.tealGradient,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: 14,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {(v.full_name || '?')[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: theme.type.body.size, color: theme.textDark }}>
                      {v.full_name}
                    </div>
                    <div style={{ fontSize: theme.type.caption.size, color: theme.tealDeep, fontWeight: 700 }}>
                      {v.profession}
                    </div>
                  </div>
                </div>
                {v.phone && (
                  <div style={{ fontSize: theme.type.bodySm.size, color: theme.textLight, marginLeft: 46 }}>
                    {v.phone} · {v.workplace}
                  </div>
                )}
                <div style={{ fontSize: theme.type.caption.size, color: theme.textLight, marginTop: theme.space[2], marginLeft: 46 }}>
                  {timeAgo(v.created_at)}
                </div>
              </div>
              <StatusBadge status={v.status} />
            </div>

            {v.credential_url && (
              <div style={{ marginBottom: theme.space[4] }}>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<FileText size={14} />}
                  rightIcon={<ExternalLink size={12} />}
                  onClick={() => openCredential(v.id)}
                  loading={credentialLoadingId === v.id}
                  loadingText="Opening…"
                >
                  View Credential
                </Button>
              </div>
            )}

            {credentialError.id === v.id && (
              <div
                style={{
                  padding: theme.space[3],
                  background: theme.dangerBg,
                  borderRadius: theme.radius.sm,
                  marginBottom: theme.space[4],
                  fontSize: theme.type.caption.size,
                  color: theme.danger,
                }}
              >
                {credentialError.message}
              </div>
            )}

            {v.status === 'pending' && (
              <div style={{ display: 'flex', gap: theme.space[3] }}>
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth
                  leftIcon={<CheckCircle size={14} />}
                  onClick={() => approveVerif(v.id, v.user_id, v.profession)}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  fullWidth
                  leftIcon={<XCircle size={14} />}
                  onClick={() => rejectVerif(v.id)}
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
