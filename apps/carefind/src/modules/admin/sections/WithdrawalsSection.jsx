import { useEffect, useRef } from 'react'
import { XCircle } from 'lucide-react'
import { Button, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import ReviewQueue from '../ui/ReviewQueue.jsx'
import { timeAgo } from '../ui'
import { useFinanceData } from '../hooks/useFinanceData'
import { useWithdrawalActions } from '../hooks/useWithdrawalActions'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { isInFlight, maskAccount, nairaFromCoins } from '../lib/financeFormat'

// What the server's reject_withdrawal does, read from api/_handlers/admin-auth.js,
// api/_lib/withdrawalAdmin.js (decideAdminReject) and shared-payments
// decideTransferAction. Keep it true: change it whenever those change.
//   no paystack_reference           -> refund, Paystack is not asked
//   Paystack failed/reversed/...    -> refund
//   Paystack not_found, never sent  -> refund (a 'processing' row only after an hour)
//   Paystack success                -> recorded as paid, no refund, 409 with a message
//   still moving / just filed / Paystack unreachable / unknown status -> 409, nothing changes
export const REJECT_CONSEQUENCE =
  'Paystack is checked first. If the transfer failed or was never sent, the coins are refunded to the user. ' +
  'If Paystack says it was paid, the request is recorded as paid and nothing is refunded. ' +
  'If the transfer may still be sending, or Paystack cannot confirm it, the rejection is blocked and nothing changes. ' +
  'A request with no Paystack reference is refunded without asking Paystack.'

const person = (w) => w.profiles?.full_name || w.profiles?.display_name || 'User'

// The legacy maths (amount * 200), labelled as the estimate it is.
const amountText = (w) => `${w.amount} coins · about ₦${nairaFromCoins(w.amount).toLocaleString()} at 200 per coin`

const requestedDate = (w) => (w.created_at ? new Date(w.created_at).toLocaleString() : '—')

export const columns = [
  { key: 'person', label: 'Person', render: person },
  { key: 'amount', label: 'Amount', render: amountText },
  // Masked here: the full number is only in the drawer.
  { key: 'bank', label: 'Bank', render: w => `${w.bank_name || '—'} · ${maskAccount(w.account_number)}` },
  { key: 'status', label: 'Status', render: w => <StatusBadge status={w.status} /> },
  { key: 'created_at', label: 'Requested', sortable: true, sortValue: w => (w.created_at ? new Date(w.created_at).getTime() : 0), render: w => timeAgo(w.created_at) },
]

// Only the fields the legacy screen showed (the spec forbids exposing more of
// the select('*') row): no Paystack reference or transfer code.
// While mounted it marks its withdrawal as the one on screen. ReviewQueue's
// close does not tell this section the drawer went away, so the body's unmount
// is what clears the mark; a late result then knows its drawer is gone.
function WithdrawalBody({ w, shownId }) {
  const { id } = w
  useEffect(() => {
    shownId.current = id
    return () => { if (shownId.current === id) shownId.current = null }
  }, [id, shownId])
  return (
    <dl className="adm-drawer-grid">
      <dt>Person</dt><dd>{person(w)}</dd>
      <dt>Amount</dt><dd>{amountText(w)}</dd>
      <dt>Bank</dt><dd>{w.bank_name || '—'}</dd>
      <dt>Account number</dt><dd>{w.account_number || '—'}</dd>
      <dt>Account name</dt><dd>{w.account_name || '—'}</dd>
      <dt>Status</dt><dd><StatusBadge status={w.status} /></dd>
      <dt>Requested</dt><dd>{requestedDate(w)}</dd>
    </dl>
  )
}

// Withdrawals are paid out automatically; the only admin action is rejecting
// one that is stuck, and the server decides with Paystack what that does.
// The "Pending" tab of ReviewQueue holds the requests still in progress.
export default function WithdrawalsSection() {
  const { data, isLoading, refetch } = useFinanceData()
  const { busy, rejectWithdrawal } = useWithdrawalActions()
  const { askConfirm, showToast } = useAdmin()
  // The id of the row the drawer is rendering (null once no drawer is shown),
  // so a late result can tell whether its drawer is still the one on screen.
  const shownId = useRef(null)

  // A settled query with no data is a failure, never an endless skeleton.
  const source = isLoading ? undefined : (data?.withdrawals ?? { status: 'error' })

  const renderDrawer = (w, { close, setError }) => {
    shownId.current = w.id
    // close and setError act on whichever drawer is open now. A reject can take
    // seconds (Paystack is asked), and the confirm has already closed, so the
    // drawer may be closed or showing another withdrawal by the time it ends.
    // Then a failure is toasted, never dropped (the legacy screen toasted every
    // error); a success needs nothing more, the hook has toasted and refreshed.
    const finish = (res) => {
      const message = res.ok ? null : `Couldn't reject the withdrawal: ${res.error}`
      if (shownId.current !== w.id) {
        if (message) showToast(message, { type: 'error' })
        return
      }
      if (res.ok) close(); else setError(message)
    }
    return {
      body: <WithdrawalBody w={w} shownId={shownId} />,
      footer: isInFlight(w) ? (
        <Button variant="danger" fullWidth loading={busy === w.id} loadingText="Rejecting…" leftIcon={<XCircle size={14} aria-hidden="true" />}
          onClick={() => askConfirm({
            title: 'Reject this withdrawal?',
            consequence: REJECT_CONSEQUENCE,
            confirmLabel: 'Reject withdrawal',
            action: async () => finish(await rejectWithdrawal(w.id)),
          })}>
          Reject withdrawal
        </Button>
      ) : null,
    }
  }

  return (
    <ReviewQueue
      title="Withdrawals"
      source={source}
      onRetry={() => refetch()}
      columns={columns}
      isOpen={isInFlight}
      nothingWaiting="Nothing in progress"
      noneYet="No withdrawal requests yet"
      drawerTitle={person}
      renderDrawer={renderDrawer}
      toolbar={<p className="adm-note">Withdrawals are paid out automatically. Reject only one that is stuck.</p>}
    />
  )
}
