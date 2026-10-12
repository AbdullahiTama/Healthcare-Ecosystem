import { Button, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import ReviewQueue from '../ui/ReviewQueue.jsx'
import { timeAgo } from '../ui'
import { useTrustQueues, TRUST_CAPS } from '../hooks/useTrustQueues'
import { useReviewActions } from '../hooks/useReviewActions'
import { useAdmin } from '../provider/AdminProvider.jsx'

const GONE = 'Post no longer available'
const isOpen = (r) => r.status === 'pending'
const excerpt = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s)

const columns = [
  { key: 'reason', label: 'Reason', render: r => r.reason },
  { key: 'post', label: 'Post', render: r => excerpt(r.posts?.content, 80) || GONE },
  { key: 'created_at', label: 'Submitted', sortable: true, sortValue: r => new Date(r.created_at).getTime(), render: r => timeAgo(r.created_at) },
  { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} /> },
]

// The report details with the full reported post. Shared with the Moderation section.
export function ReportBody({ r }) {
  return (
    <>
      <dl className="adm-drawer-grid">
        <dt>Reason</dt><dd>{r.reason}</dd>
        <dt>Reported</dt><dd>{timeAgo(r.created_at)}</dd>
      </dl>
      <div className="adm-drawer-text">{r.posts?.content || GONE}</div>
    </>
  )
}

export default function ReportsSection() {
  const { data, refetch } = useTrustQueues(true)
  const actions = useReviewActions()
  const { askConfirm } = useAdmin()

  const renderDrawer = (r, { close, setError }) => {
    const finish = (res) => { if (res.ok) close(); else setError(res.error) }
    return {
      body: <ReportBody r={r} />,
      footer: isOpen(r) ? (
        <>
          {r.post_id && r.posts && (
            <Button variant="danger" fullWidth
              onClick={() => askConfirm({
                title: 'Delete this post?',
                consequence: 'This permanently deletes the post along with its likes and comments. This cannot be undone.',
                confirmLabel: 'Delete post',
                action: async () => finish(await actions.deletePost(r.post_id)),
              })}>
              Delete post
            </Button>
          )}
          <Button variant="secondary" fullWidth loading={actions.busyId === r.id}
            onClick={async () => finish(await actions.resolveReport(r.id))}>
            Dismiss
          </Button>
        </>
      ) : null,
    }
  }

  return (
    <ReviewQueue
      title="Reports"
      source={data?.reports}
      onRetry={refetch}
      columns={columns}
      isOpen={isOpen}
      cap={TRUST_CAPS.reports}
      nothingWaiting="Nothing waiting"
      noneYet="No reports yet"
      drawerTitle={r => r.reason}
      renderDrawer={renderDrawer}
    />
  )
}
