import { usePlanStatus } from './usePlanStatus'
import { isRestricted, restrictedMessage } from '../lib/planStatus'

// The check every "add" / import / export action makes before it starts. While the plan is restricted
// (lib/planStatus.js) it shows why the action is paused and returns false; otherwise true. The database refuses the
// same writes (carehub_20261214), so this is the friendly early answer, not the only guard.
export function usePlanGate(showToast) {
  const status = usePlanStatus()
  const restricted = isRestricted(status)
  function allow(what) {
    if (!restricted) return true
    console.info('[plan] action paused by an expired plan:', what)
    showToast?.(restrictedMessage(what), { type: 'warning' })
    return false
  }
  return { status, restricted, allow }
}
