// Did the database REFUSE this write (a policy or a missing grant), as opposed to the request failing in
// transit? A refusal will be refused again, so retrying it is pointless; a network or server failure is
// worth retrying. Kept apart from the repository so code that only needs this (the offline outbox) does not
// pull in the repository and its network layer.
export function isPermissionRefusal(error) {
  const text = String(error && error.message ? error.message : error)
  return /\((401|403)\)|42501|row-level security|permission denied/i.test(text)
}
