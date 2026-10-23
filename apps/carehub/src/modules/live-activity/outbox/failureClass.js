import { isPermissionRefusal } from '../permissionRefusal'

// Is retrying a queued report worth doing? A refusal or a malformed request fails the same way every time,
// so it must stop and be shown to the person. Everything else (a dropped connection, a timeout, a 5xx, rate
// limiting, something unrecognised) is treated as transient: losing a report to an unfamiliar error is worse
// than trying it again later.
//
//   22P02 invalid input syntax   22023 invalid parameter (the function's own checks)
//   23502 not-null   23503 foreign key   23514 check constraint
//   400 bad request   404 not found (a bucket that does not exist yet)   413 file too large
//   415 file type refused   422 unprocessable
// A parked report keeps its Retry button, so one that was parked for a not-yet-applied migration can be sent
// afterwards; it is never retried silently in the meantime.
const WILL_FAIL_AGAIN = /\((400|404|413|415|422)\)|\b(22P02|22023|23502|23503|23514)\b/

// An expired or invalid login (401 "JWT expired", PostgREST PGRST301/PGRST303) is fixed by signing in again:
// the report waits for that instead of being parked for the person to rescue by hand. It is checked first
// because the 401 it arrives as would otherwise read as a refusal. A 401 that says "permission denied" is a
// refusal and stays permanent.
const LOGIN_PROBLEM = /\bJWT (expired|invalid)\b|\bInvalid JWT\b|\bPGRST30[13]\b/i

export function classifyFailure(error) {
  const text = String(error && error.message ? error.message : error)
  if (LOGIN_PROBLEM.test(text)) return 'retry'
  if (isPermissionRefusal(error)) return 'permanent'
  return WILL_FAIL_AGAIN.test(text) ? 'permanent' : 'retry'
}
