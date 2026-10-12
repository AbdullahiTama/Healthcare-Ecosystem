import { Button, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import ReviewQueue from '../ui/ReviewQueue.jsx'
import { timeAgo } from '../ui'
import { useTrustQueues } from '../hooks/useTrustQueues'
import { useReviewActions } from '../hooks/useReviewActions'
import { useAdmin } from '../provider/AdminProvider.jsx'

const isOpen = (c) => c.status === 'pending'

const columns = [
  { key: 'business', label: 'Business', render: c => c.businesses?.name || 'Unnamed business' },
  { key: 'created_at', label: 'Submitted', sortable: true, sortValue: c => new Date(c.created_at).getTime(), render: c => timeAgo(c.created_at) },
  { key: 'status', label: 'Status', render: c => <StatusBadge status={c.status} /> },
]

export default function ClaimsSection() {
  const { data, refetch } = useTrustQueues(true)
  const actions = useReviewActions()
  const { askConfirm } = useAdmin()

  const renderDrawer = (c, { close, setError }) => {
    const finish = (res) => { if (res.ok) close(); else setError(res.error) }
    return {
      body: (
        <dl className="adm-drawer-grid">
          <dt>Business</dt><dd>{c.businesses?.name || 'Unnamed business'}</dd>
          <dt>Submitted</dt><dd>{timeAgo(c.created_at)}</dd>
        </dl>
      ),
      footer: isOpen(c) ? (
        <>
          <Button variant="primary" fullWidth loading={actions.busyId === c.id}
            onClick={async () => finish(await actions.approveClaim({ id: c.id, businessId: c.business_id }))}>
            Approve
          </Button>
          <Button variant="danger" fullWidth
            onClick={() => askConfirm({
              title: 'Reject this claim?',
              consequence: 'The claim is marked as rejected and leaves the pending list. The business is not changed.',
              confirmLabel: 'Reject',
              action: async () => finish(await actions.rejectClaim(c.id)),
            })}>
            Reject
          </Button>
        </>
      ) : null,
    }
  }

  return (
    <ReviewQueue
      title="Claims"
      source={data?.claims}
      onRetry={refetch}
      columns={columns}
      isOpen={isOpen}
      nothingWaiting="Nothing waiting"
      noneYet="No claims yet"
      drawerTitle={c => c.businesses?.name || 'Business claim'}
      renderDrawer={renderDrawer}
    />
  )
}
