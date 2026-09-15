import { DollarSign, CheckCircle, XCircle, Building2 } from 'lucide-react'
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

export default function WithdrawalsTab({ withdrawals, onApprove, onReject }) {
  return (
    <div>
      <AdminPageHeader
        title="Withdrawal Requests"
        subtitle="Process pending withdrawal requests from users"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
          <DollarSign size={18} color={theme.tealDeep} />
          <span style={{ fontSize: theme.type.caption.size, fontWeight: 700, color: theme.textMid }}>
            {withdrawals.filter(w => w.status === 'pending').length} pending
          </span>
        </div>
      </AdminPageHeader>

      {withdrawals.length === 0 ? (
        <Empty
          icon={<DollarSign size={40} strokeWidth={1.5} color={theme.gray300} />}
          message="No withdrawal requests yet"
          cause="none"
        />
      ) : (
        withdrawals.map(w => (
          <Card
            key={w.id}
            style={{
              padding: theme.space[5],
              marginBottom: theme.space[4],
              borderColor: w.status === 'pending' ? theme.warning : theme.border,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.space[4] }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: theme.type.h3.size, color: theme.textDark, marginBottom: theme.space[1] }}>
                  {w.profiles?.full_name || 'User'}
                </div>
                <div
                  style={{
                    fontSize: theme.type.h2.size,
                    fontWeight: 900,
                    color: theme.tealDeep,
                    marginBottom: theme.space[2],
                  }}
                >
                  ₦{(w.amount * 200).toLocaleString()}
                </div>
                {w.bank_name && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[2], fontSize: theme.type.bodySm.size, color: theme.textLight, marginBottom: theme.space[1] }}>
                    <Building2 size={13} />
                    <span>{w.bank_name} · {w.account_number}</span>
                  </div>
                )}
                {w.account_name && (
                  <div style={{ fontSize: theme.type.bodySm.size, color: theme.textLight, marginBottom: theme.space[1] }}>
                    {w.account_name}
                  </div>
                )}
                <div style={{ fontSize: theme.type.caption.size, color: theme.textLight }}>
                  {timeAgo(w.created_at)}
                </div>
              </div>
              <StatusBadge status={w.status} />
            </div>

            {w.status === 'pending' && (
              <div style={{ display: 'flex', gap: theme.space[3] }}>
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth
                  leftIcon={<CheckCircle size={14} />}
                  onClick={() => onApprove(w.id)}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  fullWidth
                  leftIcon={<XCircle size={14} />}
                  onClick={() => onReject(w.id)}
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
