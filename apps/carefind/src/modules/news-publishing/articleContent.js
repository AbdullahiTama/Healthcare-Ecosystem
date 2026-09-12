// Publish-time integrity gate for article bodies (issue #4).
//
// What was checked, and what was ruled out. `posts.content` and `news.body`
// are unbounded `text` columns — there is no database truncation — and
// renderArticleHtml was run against the real stored bodies of several live
// articles: it drops no words. So content was not being lost at save or at
// render by the paths those two suspicions named.
//
// What CAN lose content is the composer: a block deleted by an accidental tap,
// or an article edited through a plain textarea that only understands the
// first block. This module is the guard that makes either of those loud
// instead of silent — it measures what the editor holds, measures what is
// about to be persisted, and refuses the write when the second is materially
// smaller than the first.
//
// It is deliberately a pure function over strings so both publish paths (the
// feed composer and the News composer) share exactly one definition of "did
// we just lose the user's writing?".

import { findMalformedHighlights } from './articleFormat.js'

// Blocks in, plain readable text out. Non-text blocks (drawings) contribute
// their caption only — they carry no prose, and counting their stroke data as
// "content" would mask the loss of a real paragraph.
function blocksOf(content) {
  if (content == null) return []
  if (Array.isArray(content)) return content
  if (typeof content !== 'string') return []
  const trimmed = content.trim()
  if (!trimmed.startsWith('[')) return [{ type: 'text', content }]
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : [{ type: 'text', content }]
  } catch {
    return [{ type: 'text', content }]
  }
}

// The measurable shape of an article body: how many blocks it has and how
// many non-whitespace characters of prose it carries.
export function articleStats(content) {
  const blocks = blocksOf(content)
  const text = blocks
    .map((b) => {
      if (!b || typeof b !== 'object') return String(b ?? '')
      if (b.type === 'drawing') return String(b.caption || '')
      return typeof b.content === 'string' ? b.content : String(b.content ?? '')
    })
    .join('\n')
  return {
    blocks: blocks.length,
    chars: text.replace(/\s/g, '').length,
    text,
  }
}

// How much prose a body would have to lose before we call it a defect rather
// than an edit. Formatting markers are characters too — stripping a pair of
// `==color|` tokens legitimately shortens the body — so the threshold is not
// zero. 40 characters is well above any marker repair and well below a
// sentence a writer would notice missing.
export const LOSS_TOLERANCE_CHARS = 40

// Compare the body the editor holds against the body about to be written.
// Returns { ok, lostChars, lostBlocks, before, after }.
export function compareForLoss(before, after) {
  const b = articleStats(before)
  const a = articleStats(after)
  const lostChars = b.chars - a.chars
  const lostBlocks = b.blocks - a.blocks
  return {
    ok: lostChars <= LOSS_TOLERANCE_CHARS && lostBlocks <= 0,
    lostChars,
    lostBlocks,
    before: b,
    after: a,
  }
}

// The gate a publish path calls. Returns
//   { ok: true,  content }                 — safe to persist (repaired)
//   { ok: false, error }                   — refuse, show `error` to the user
//
// It repairs malformed highlight markers rather than rejecting them (issue #3
// already writes them correctly; this catches bodies typed before that fix and
// bodies pasted from a corrupted article), then verifies the repair did not
// cost more than marker characters.
export function validateArticleForPublish(content, { logger = console } = {}) {
  const raw = content == null ? '' : String(content)
  const stats = articleStats(raw)

  if (!stats.chars) {
    return { ok: false, error: 'This article is empty. Write something before publishing.' }
  }

  const malformed = findMalformedHighlights(raw)
  const repaired = malformed.length
    ? JSON.stringify(blocksOf(raw).map((b) => (
        b && typeof b === 'object' && b.type !== 'drawing'
          ? { ...b, content: String(b.content ?? '').replace(/==(?!#[0-9a-fA-F]{3,8}\|)([A-Za-z_][A-Za-z0-9_-]*)\|/g, '') }
          : b
      )))
    : raw

  const comparison = compareForLoss(raw, repaired)

  // Issue #4, solution step 5: log the before/after shape of every publish so
  // content loss is detectable from logs, not only from a reader noticing.
  logger.info?.('[article] publish integrity', {
    blocks: comparison.after.blocks,
    chars: comparison.after.chars,
    repairedMarkers: malformed.length,
    lostChars: comparison.lostChars,
  })

  if (!comparison.ok) {
    logger.error?.('[article] publish blocked — content would be lost', comparison)
    return {
      ok: false,
      error: 'Some of your article could not be saved safely. Copy your text somewhere safe and try again.',
    }
  }

  return { ok: true, content: repaired, stats: comparison.after }
}
