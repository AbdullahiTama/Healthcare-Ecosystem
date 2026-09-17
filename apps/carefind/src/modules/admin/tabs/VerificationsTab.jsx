import { Shield, CheckCircle, XCircle, FileText, ExternalLink } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Button, Card, StatusBadge, Empty } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, timeAgo } from '../ui'
import { useModerationStore } from '../stores/moderationStore'

export default function VerificationsTab({
  verifications,
  openCredential,
  credentialLoadingId,
  credentialError,
  approveVerif,
  rejectVerif,
}) {
  const { selectedIds, toggleSelect } = useModerationStore()

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
              borderColor: selectedIds.has(v.id) ? theme.tealBright : v.status === 'pending' ? theme.warning : theme.border,
              background: selectedIds.has(v.id) ? theme.tealMist : theme.cardBg,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.space[4] }}>
              <div style={{ flex: 1, display: 'flex', gap: theme.space[3] }}>
                <button
                  onClick={() => toggleSelect(v.id)}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 3,
                    border: `2px solid ${selectedIds.has(v.id) ? theme.tealDeep : theme.gray300}`,
                    background: selectedIds.has(v.id) ? theme.tealDeep : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  {selectedIds.has(v.id) && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <div>
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
                        color: 'var(--color-surface)',
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
