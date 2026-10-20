// ── Reviewer routing queue: pure helpers ───────────────────────────────────
// Twins of the checks review_adr_product_route() enforces. The database is the
// authority; these only stop an obviously invalid request before it is sent.

export const REVIEW_ACTIONS = ['approve', 'redirect', 'hold']

export const MIN_REASON_LENGTH = 3

const ACTION_LABELS = {
  approve: 'Approve and route',
  redirect: 'Redirect to another company',
  hold: 'Hold for follow-up',
}

export function reviewActionLabel(action) {
  return ACTION_LABELS[action] || action
}

// What the reporter actually told us. Registered picks are still the
// reporter's word, not a verified match.
export function selectionBasis(row) {
  if (row.selection_kind === 'verified') return 'Reporter picked a registered company (not independently verified)'
  if (row.selection_kind === 'unverified_candidate') return 'Reporter typed a company name (no registry match)'
  return 'Reporter did not know the company'
}

// Actions the queue may offer for a row. A typed or unknown selection can only
// be redirected to a registered company or held; approving it is refused by
// the database, so the UI does not offer it.
export function availableActions(row) {
  if (!row) return []
  if (row.selection_kind === 'verified' && row.selected_business_eligible) return ['approve', 'redirect', 'hold']
  return ['redirect', 'hold']
}

// Returns an error message, or null when the request is well-formed.
export function validateReviewInput({ action, reason, businessId }) {
  if (!REVIEW_ACTIONS.includes(action)) return 'Choose an action.'
  if (String(reason || '').trim().length < MIN_REASON_LENGTH) return 'Give a reason; it is recorded in the case audit trail.'
  if (action === 'redirect' && !businessId) return 'Choose the registered company to route this case to.'
  return null
}
