import { Pill, StatusBadge } from '@care-ecosystem/design-system/components/ui'

// Admin statuses the shared registry does not cover. Anything else falls
// through to the shared StatusBadge, which prints the raw status or a dash.
const ADMIN_STATUS = {
  approved: { label: 'Approved', type: 'teal' },
  verified: { label: 'Verified', type: 'teal' },
  rejected: { label: 'Rejected', type: 'red' },
  resolved: { label: 'Resolved', type: 'green' },
  dismissed: { label: 'Dismissed', type: 'gray' },
  flagged: { label: 'Flagged', type: 'red' },
}

export function StatusPill({ status }) {
  const known = ADMIN_STATUS[status]
  return known ? <Pill label={known.label} type={known.type} /> : <StatusBadge status={status} />
}

export default StatusPill
