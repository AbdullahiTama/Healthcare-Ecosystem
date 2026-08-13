// Personalized feed engine (Phase 6, Feature Group I).
//
// Pure, I/O-free personalization: candidate pools → multi-signal ranking →
// diversity. Feed.jsx prepares a `context` of prepared maps/sets and calls
// the entry points below; nothing here touches supabase, so the whole engine
// is unit-testable without mocks.
//
// The For You ranking is a weighted sum of signals, each normalized 0..1:
//   engagement  — likes·3 + comments·5 + shares·4 + saves·2 + gifts·8 +
//                 reposts·6 + views/100, min-max normalized across the batch.
//   recency     — linear decay from full strength (new) to 0 after a week.
//   affinity    — follows the author (0.6) + the viewer's own direct
//                 engagements with the author (up to 0.4).
//   authority   — verified professional (1.0 / 0.6 without specialty),
//                 active business (0.6).
//   medical     — 1.0 when the author is a medical professional/facility.
//   interests   — implicit interests derived from what the viewer already
//                 engages with (post themes, types, author specialties) and
//                 who they follow/subscribe to; min-max normalized.
//   location    — shared region tokens between the viewer and the author
//                 (profiles.location) or posted-as business (state/city).
//
// Pools (candidate_generation_pools) then assemble the final list in priority
// order, each capped by its own contribution limit, and diversity caps keep
// one author (3) or one content type (5) from dominating.

export const MEDICAL_BUSINESS_TYPES = ['pharmacy', 'hospital']

export const DEFAULT_RANKING_CONFIG = {
  weights: {
    engagement: 40,
    recency: 20,
    affinity: 20,
    authority: 15,
    location: 10,
    medical: 10,
    interests: 10,
  },
  diversity: { maxPerAuthor: 3, maxPerType: 5 },
}

export const DEFAULT_POOLS = {
  trending: { enabled: true, priority: 10, limitCount: 25 },
  following: { enabled: true, priority: 20, limitCount: 25 },
  interests: { enabled: true, priority: 30, limitCount: 25 },
  similar_providers: { enabled: true, priority: 40, limitCount: 20 },
  nearby: { enabled: true, priority: 50, limitCount: 20 },
  fresh: { enabled: true, priority: 60, limitCount: 15 },
}

// Country-level tokens are noise for a "nearby" signal (everyone in Nigeria
// would match everyone else). States/cities are the useful grain.
const STOP_TOKENS = new Set(['nigeria', 'ng', 'ngn'])

export function normalizeRegion(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t))
}

export function regionsOverlap(a = [], b = []) {
  if (!a.length || !b.length) return 0
  const set = new Set(b)
  return a.reduce((n, t) => n + (set.has(t) ? 1 : 0), 0)
}

// Is this post from an approved medical professional or facility?
//   - posted_as business/staff → the facility (business) must be active and a
//     MEDICAL_BUSINESS_TYPES member.
//   - personal post            → the author profile is verified.
export function isMedicalAuthor({ post, profile, business }) {
  if (!post) return false
  if (post.posted_as_type) {
    return !!(
      business &&
      MEDICAL_BUSINESS_TYPES.includes(business.business_type) &&
      business.status === 'active'
    )
  }
  return !!(profile && profile.is_verified)
}

export function regionTokensForPost({ post, profile, business }) {
  if (post?.posted_as_id && business) {
    return normalizeRegion(`${business.city || ''} ${business.state || ''} ${business.location_label || ''}`)
  }
  return normalizeRegion(profile?.location || profile?.country || '')
}

// Build the viewer's implicit interest profile from what they already engage
// with (reacted/commented/saved posts and followed/subscribed authors).
// Returns maps token → signal-count.
export function buildInterestProfile({ postMap, authorProfiles, viewer }) {
  const themeWeights = new Map()
  const typeWeights = new Map()
  const specialtyWeights = new Map()
  const bump = (m, k) => { if (k) m.set(k, (m.get(k) || 0) + 1) }

  ;[...(viewer.reactedPostIds || []), ...(viewer.commentedPostIds || []), ...(viewer.savedPostIds || [])]
    .forEach((pid) => {
      const p = postMap[pid]
      if (!p) return
      bump(themeWeights, p.theme)
      bump(typeWeights, p.post_type)
      const author = authorProfiles[p.user_id]
      if (author) bump(specialtyWeights, author.specialty || author.verification_label)
    })

  ;[...(viewer.followedProfileIds || []), ...(viewer.subscriptionProfileIds || [])]
    .forEach((pid) => {
      const author = authorProfiles[pid]
      if (author) bump(specialtyWeights, author.specialty || author.verification_label)
    })

  return { themeWeights, typeWeights, specialtyWeights }
}

// Raw, unnormalized per-post signals (0..1 where the signal is naturally
// bounded; engagement and interests are unbounded and normalized per batch).
export function computeRawSignals({ post, context }) {
  const {
    lCounts = {}, cCounts = {}, sCounts = {}, saveCounts = {},
    giftStats = {}, follows = new Set(), viewerReactionIds = new Set(),
    viewerCommentIds = new Set(), viewerSaveIds = new Set(),
    profiles = {}, businesses = {}, interest = null, viewerRegion = [],
    now = Date.now(),
  } = context
  const author = profiles[post.user_id]
  const business = post.posted_as_id ? businesses[post.posted_as_id] : null

  const engagement =
    (lCounts[post.id] || 0) * 3 +
    (cCounts[post.id] || 0) * 5 +
    (sCounts[post.id] || 0) * 4 +
    (saveCounts[post.id] || 0) * 2 +
    (giftStats[post.id]?.gift_count || 0) * 8 +
    (post.repost_count || 0) * 6 +
    (post.view_count || 0) / 100

  const ageHours = (now - new Date(post.created_at).getTime()) / 3600000
  const recency = Math.max(0, Math.min(1, 1 - ageHours / 168))

  const followsAuthor = follows.has(post.user_id)
  const directEngagements =
    (viewerReactionIds.has(post.id) ? 1 : 0) +
    (viewerCommentIds.has(post.id) ? 1 : 0) +
    (viewerSaveIds.has(post.id) ? 1 : 0)
  const affinity = (followsAuthor ? 0.6 : 0) + Math.min(0.4, directEngagements * 0.2)

  let authority = 0
  if (post.posted_as_type) authority = business && business.status === 'active' ? 0.6 : 0
  else if (author?.is_verified) authority = author.specialty || author.verification_label ? 1 : 0.6

  const medical = isMedicalAuthor({ post, profile: author, business }) ? 1 : 0

  let interests = 0
  if (interest) {
    const themeHits = interest.themeWeights.get(post.theme) || 0
    const typeHits = interest.typeWeights.get(post.post_type) || 0
    const specHits = author ? (interest.specialtyWeights.get(author.specialty || author.verification_label) || 0) : 0
    interests = themeHits + typeHits + specHits * 2
  }

  const location = regionsOverlap(viewerRegion, regionTokensForPost({ post, profile: author, business }))

  return { engagement, recency, affinity, authority, medical, interests, location }
}

// Core scoring shared by every entry point: raw signals → per-batch min-max
// normalization of the unbounded signals → weighted sum → sort. Returns
// [{ post, raw, _score }] sorted best-first.
export function scorePosts({ posts = [], context, weights }) {
  const w = { ...DEFAULT_RANKING_CONFIG.weights, ...(weights || {}) }

  const scored = posts.map((post) => ({ post, raw: computeRawSignals({ post, context }) }))

  // Min-max normalize the two unbounded signals across the batch.
  const normalized = (key) => {
    const vals = scored.map((s) => s.raw[key]).filter((v) => Number.isFinite(v))
    const max = Math.max(0, ...vals)
    const min = Math.min(0, ...vals)
    const span = max - min || 1
    return scored.map((s) => (s.raw[key] - min) / span)
  }
  const engNorm = normalized('engagement')
  const intNorm = normalized('interests')

  scored.forEach((s, i) => {
    const r = s.raw
    s._score =
      w.engagement * engNorm[i] +
      w.recency * r.recency +
      w.affinity * r.affinity +
      w.authority * r.authority +
      w.medical * r.medical +
      w.interests * intNorm[i] +
      w.location * r.location
  })
  scored.sort((a, b) => b._score - a._score || (context.now - new Date(a.post.created_at)) - (context.now - new Date(b.post.created_at)))
  return scored
}

// Full For You pipeline: signals → weighted score → pool assembly → diversity.
// `weights`/`diversity`/`pools` are the resolved DB config (or defaults).
export function rankForYou({ posts = [], context, weights, diversity, pools }) {
  const d = { ...DEFAULT_RANKING_CONFIG.diversity, ...(diversity || {}) }
  const scored = scorePosts({ posts, context, weights })
  const poolSets = classifyIntoPools(scored, context)
  const assembled = assemblePools(scored, poolSets, pools)
  return applyDiversity(assembled, d)
}

// Plain weighted-score ranking WITHOUT pool assembly or diversity caps. This
// is what the content-type tabs use — capping per-author/per-type there would
// wrongly hide posts a reader explicitly asked for (e.g. 20 questions).
export function rankByScore({ posts = [], context, weights }) {
  return scorePosts({ posts, context, weights }).map((s) => s.post)
}

// Assign each scored post to its candidate pools.
function classifyIntoPools(scored, context) {
  const sets = {
    trending: [], following: [], interests: [],
    similar_providers: [], nearby: [], fresh: [],
  }
  const { follows = new Set(), profiles = {}, interest = null } = context
  const engVals = scored.map((s) => s.raw.engagement).filter((v) => Number.isFinite(v))
  const engMax = Math.max(0, ...engVals) || 1

  scored.forEach((s) => {
    const p = s.post
    if (s.raw.engagement / engMax >= 0.5) sets.trending.push(p)
    if (follows.has(p.user_id)) sets.following.push(p)
    if (s.raw.interests > 0) sets.interests.push(p)
    if (profiles[p.user_id]?.is_verified) sets.similar_providers.push(p)
    if (s.raw.location > 0) sets.nearby.push(p)
    sets.fresh.push(p)
  })
  return sets
}

// Assemble the feed pool-by-pool (priority order), each pool capped by its
// contribution limit; posts already surfaced by an earlier pool are skipped.
function assemblePools(scored, poolSets, pools) {
  const cfg = { ...DEFAULT_POOLS, ...(pools || {}) }
  const scoreOf = new Map(scored.map((s) => [s.post.id, s._score]))
  const order = Object.entries(cfg)
    .filter(([, c]) => c.enabled !== false)
    .sort((a, b) => (a[1].priority ?? 100) - (b[1].priority ?? 100))

  const seen = new Set()
  const result = []
  for (const [name, c] of order) {
    const members = (poolSets[name] || []).slice().sort((a, b) => (scoreOf.get(b.id) || 0) - (scoreOf.get(a.id) || 0))
    let taken = 0
    for (const post of members) {
      if (taken >= (c.limitCount ?? Infinity)) break
      if (seen.has(post.id)) continue
      seen.add(post.id)
      result.push(post)
      taken += 1
    }
  }
  return result
}

// Diversity caps: no single author (or posted-as entity) beyond maxPerAuthor,
// no single content type beyond maxPerType. Preserves the ranked order.
export function applyDiversity(posts, { maxPerAuthor = 3, maxPerType = 5 } = {}) {
  const authorCount = new Map()
  const typeCount = new Map()
  const out = []
  for (const p of posts) {
    const authorKey = p.posted_as_id || p.user_id
    if ((authorCount.get(authorKey) || 0) >= maxPerAuthor) continue
    if ((typeCount.get(p.post_type) || 0) >= maxPerType) continue
    authorCount.set(authorKey, (authorCount.get(authorKey) || 0) + 1)
    typeCount.set(p.post_type, (typeCount.get(p.post_type) || 0) + 1)
    out.push(p)
  }
  return out
}

// Nearby tab: posts whose author/facility shares a region with the viewer,
// best-region-match first, then recency. Posts with no region signal drop out
// (the tab is a dedicated view, not a mixed slice).
export function rankNearby(posts = [], context) {
  return posts
    .map((post) => ({ post, location: computeRawSignals({ post, context }).location }))
    .filter((x) => x.location > 0)
    .sort((a, b) => b.location - a.location || new Date(b.post.created_at) - new Date(a.post.created_at))
    .map((x) => x.post)
}
