import { Button, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import ReviewQueue from '../ui/ReviewQueue.jsx'
import { timeAgo } from '../ui'
import { useTrustQueues } from '../hooks/useTrustQueues'
import { useReviewActions } from '../hooks/useReviewActions'
import { useAdmin } from '../provider/AdminProvider.jsx'

const isOpen = (v) => v.status === 'pending'

const columns = [
  { key: 'full_name', label: 'Applicant' },
  { key: 'profession', label: 'Profession' },
  { key: 'workplace', label: 'Workplace', render: v => v.workplace || '—' },
  { key: 'created_at', label: 'Submitted', sortable: true, sortValue: v => new Date(v.created_at).getTime(), render: v => timeAgo(v.created_at) },
  { key: 'status', label: 'Status', render: v => <StatusBadge status={v.status} /> },
]

// The request details and the credential link. Shared with Moderation, which
// shows the same request in its own drawer.
export function VerificationBody({ v, actions, setError }) {
  return (
    <>
      <dl className="adm-drawer-grid">
        <dt>Applicant</dt><dd>{v.full_name}</dd>
        <dt>Profession</dt><dd>{v.profession}</dd>
        <dt>Workplace</dt><dd>{v.workplace || '—'}</dd>
        <dt>Phone</dt><dd>{v.phone || '—'}</dd>
        <dt>Submitted</dt><dd>{timeAgo(v.created_at)}</dd>
      </dl>
      {v.credential_url && (
        <Button variant="ghost" size="sm" loading={actions.credentialBusyId === v.id} loadingText="Opening…"
          onClick={async () => { const res = await actions.openCredential(v.id); setError(res.ok ? '' : res.error) }}>
          View credential
        </Button>
      )}
    </>
  )
}

export default function VerificationsSection() {
  const { data, refetch } = useTrustQueues(true)
  const actions = useReviewActions()
  const { askConfirm } = useAdmin()

  const renderDrawer = (v, { close, setError }) => {
    const finish = (res) => { if (res.ok) close(); else setError(res.error) }
    return {
      body: <VerificationBody v={v} actions={actions} setError={setError} />,
      footer: v.status === 'pending' ? (
        <>
          <Button variant="primary" fullWidth loading={actions.busyId === v.id}
            onClick={async () => finish(await actions.approveVerification({ id: v.id, userId: v.user_id, profession: v.profession }))}>
            Approve
          </Button>
          <Button variant="danger" fullWidth
            onClick={() => askConfirm({
              title: `Reject ${v.full_name}'s verification?`,
              consequence: 'The request is marked as rejected and leaves the pending list. Their profile is not changed.',
              confirmLabel: 'Reject',
              action: async () => finish(await actions.rejectVerification(v.id)),
            })}>
            Reject
          </Button>
        </>
      ) : null,
    }
  }

  return (
    <ReviewQueue
      title="Verification"
      source={data?.verifications}
      onRetry={refetch}
      columns={columns}
      isOpen={isOpen}
      nothingWaiting="Nothing waiting"
      noneYet="No requests yet"
      drawerTitle={v => v.full_name}
      renderDrawer={renderDrawer}
    />
  )
}
