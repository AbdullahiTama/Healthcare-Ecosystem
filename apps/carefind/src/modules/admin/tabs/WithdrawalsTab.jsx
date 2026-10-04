import { DollarSign, XCircle, Building2 } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Button, Card, StatusBadge, Empty } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, timeAgo } from '../ui'

// A withdrawal is in flight while its coins are reserved and Paystack has not settled the transfer.
const isOpen = (w) => w.status === 'reserved' || w.status === 'processing'

// Withdrawals are reserved and paid out automatically; there is nothing to approve. An admin can only reject one that
// Paystack confirms did not pay (the server asks Paystack first), which refunds the coins.
export default function WithdrawalsTab({ withdrawals, onReject }) {
  return (
    <div>
      <AdminPageHeader
        title="Withdrawal Requests"
        subtitle="Withdrawals are paid out automatically. Reject only one that is stuck."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
          <DollarSign size={18} color={theme.tealDeep} />
          <span style={{ fontSize: theme.type.caption.size, fontWeight: 700, color: theme.textMid }}>
            {withdrawals.filter(isOpen).length} in progress
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
              borderColor: isOpen(w) ? theme.warning : theme.border,
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

            {isOpen(w) && (
              <div style={{ display: 'flex', gap: theme.space[3] }}>
                <Button
                  variant="danger"
                  size="sm"
                  fullWidth
                  leftIcon={<XCircle size={14} />}
                  onClick={() => onReject(w.id)}
                >
                  Reject and refund
                </Button>
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  )
}
