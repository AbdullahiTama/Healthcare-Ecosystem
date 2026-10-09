import { Pill } from '../../../components/ui'
import { VERIFICATION_STATUS } from '../services/constants'

// Verification and source are never implied — every record shows both.
// Demo records are loudly labelled so they cannot be mistaken for real
// businesses (project rule: never present prototype data as real).
export function VerificationBadge({ status }) {
  const v = VERIFICATION_STATUS[status] || VERIFICATION_STATUS.unverified
  return <Pill label={v.label} type={v.tone} />
}

export function SourceBadge({ source }) {
  if (source === 'demo') return <Pill label='DEMO DATA' type='red' />
  const label = { manual: 'Manual entry', import: 'Imported', external: 'External source' }[source] || 'Unknown source'
  return <Pill label={label} type='gray' />
}
