// Deep link carried by the "report awaiting routing review" alert
// (adr_notify_reviewers_on_submit writes '/admin#adr-<report_id>').
// The hash is user-controllable, so only a well-formed UUID is accepted; the
// result is only ever compared against loaded rows, never used as a selector.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const REVIEW_HASH = new RegExp(`^#adr-(${UUID})$`, 'i')

export function parseReviewHash(hash) {
  const match = REVIEW_HASH.exec(String(hash || ''))
  return match ? match[1].toLowerCase() : null
}

export function reviewAnchorId(reportId) {
  return `adr-${reportId}`
}
