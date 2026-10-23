import { useEffect } from 'react'
import { liveActivityOutbox } from './index'

// Keeps the offline report queue sending for as long as the dashboard is open, whichever page the person
// is on. Renders nothing.
export default function OutboxRunner({ outbox = liveActivityOutbox }) {
  useEffect(() => outbox.start(), [outbox])
  return null
}
