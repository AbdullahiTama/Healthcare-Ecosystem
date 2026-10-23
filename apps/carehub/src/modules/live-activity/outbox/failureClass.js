import { isPermissionRefusal } from '../repositories'

// Is retrying a queued report worth doing? A refusal or a malformed request fails the same way every time,
// so it must stop and be shown to the person. Everything else (a dropped connection, a timeout, a 5xx, rate
// limiting, something unrecognised) is treated as transient: losing a report to an unfamiliar error is worse
// than trying it again later.
//
//   22P02 invalid input syntax   22023 invalid parameter (the function's own checks)
//   23502 not-null   23503 foreign key   23514 check constraint
const WILL_FAIL_AGAIN = /\((400|422)\)|\b(22P02|22023|23502|23503|23514)\b/

export function classifyFailure(error) {
  if (isPermissionRefusal(error)) return 'permanent'
  const text = String(error && error.message ? error.message : error)
  return WILL_FAIL_AGAIN.test(text) ? 'permanent' : 'retry'
}
