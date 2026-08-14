// @mention support for comments.
//
// Users write @username (their display_name) inside a comment; extractMentions
// pulls every unique token so the caller can resolve them to user ids (and
// notify each mentioned user). The resolved set is stored on the comment row
// (post_comments.mentions) at insert time so rendering a comment later can link
// @username to /u/:id without re-querying profiles.

// Username characters mirror what profiles.display_name allows in practice:
// letters, digits, underscore, dot, dash. A mention is @ followed by one or
// more of those, bounded by a non-username character (or start/end of text) so
// "hi@example.com" or "price@10" never count as a mention. The lookahead
// requires at least one letter so a bare number like @10 is not a username.
const MENTION_RE = /(?:^|[^\w.-])@((?=[A-Za-z0-9_.-]*[A-Za-z])[A-Za-z0-9_.-]+)/g

// Return the unique usernames mentioned in `text`, lower-cased, in first-seen
// order. Pure and I/O-free so it is trivially testable.
export function extractMentions(text) {
  if (!text) return []
  const seen = new Set()
  const out = []
  let match
  MENTION_RE.lastIndex = 0
  while ((match = MENTION_RE.exec(text)) !== null) {
    const name = match[1].toLowerCase()
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}