import { createOutbox } from './outbox'
import { createOutboxStore } from './outboxStore'
import { liveActivityRepository } from '../repositories'

// The signed-in person, read the same way the page reads it. Null when nobody is signed in.
export function readOutboxScope() {
  try {
    const auth = JSON.parse(localStorage.getItem('carehub_auth') || '{}')
    const businessId = auth && auth.brand && auth.brand.id
    return businessId ? { businessId, staffId: (auth.staff && auth.staff.id) || null } : null
  } catch (e) {
    return null
  }
}

export const liveActivityOutbox = createOutbox({ store: createOutboxStore(), repository: liveActivityRepository, getScope: readOutboxScope })
