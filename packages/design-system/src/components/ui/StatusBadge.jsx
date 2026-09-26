import { Pill } from './Pill'

// Unified status → pill registry (Stage 3 / 3.9). Covers the hospital patient
// flow (Reception/Triage statuses) and the generic workflow statuses every
// module shares (pending/completed/confirmed/cancelled/paid/…). The shared
// fallback is the raw status or '—'.
const STATUS_PILLS = {
  // Patient flow (Reception → Triage → Doctor → Pharmacy → Lab → Discharged)
  at_reception: { label: 'At Reception', type: 'blue' },
  at_triage: { label: 'At Triage', type: 'amber' },
  at_doctor: { label: 'With Doctor', type: 'purple' },
  at_pharmacy: { label: 'At Pharmacy', type: 'teal' },
  at_lab: { label: 'At Lab / Imaging', type: 'purple' },
  discharged: { label: 'Discharged', type: 'green' },
  admitted: { label: 'Admitted', type: 'red' },
  referred: { label: 'Referred Out', type: 'purple' },
  transferred: { label: 'Emergency Transfer', type: 'red' },
  // Generic workflow statuses
  pending: { label: 'Pending', type: 'amber' },
  confirmed: { label: 'Confirmed', type: 'green' },
  completed: { label: 'Completed', type: 'green' },
  cancelled: { label: 'Cancelled', type: 'red' },
  done: { label: 'Done', type: 'green' },
  paid: { label: 'Paid', type: 'green' },
  unpaid: { label: 'Unpaid', type: 'red' },
  refunded: { label: 'Refunded', type: 'gray' },
  active: { label: 'Active', type: 'green' },
  suspended: { label: 'Suspended', type: 'red' },
}

export function StatusBadge({ status }) {
  const s = STATUS_PILLS[status] || { label: status || '—', type: 'gray' }
  return <Pill label={s.label} type={s.type} />
}

export default StatusBadge
