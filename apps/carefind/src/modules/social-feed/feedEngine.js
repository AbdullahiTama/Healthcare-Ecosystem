// Personalized feed engine (FYP Algorithm, Phase 6+).
//
// Pure, I/O-free personalization: candidate pools → multi-signal ranking →
// diversity → fatigue → exploration. Feed.jsx prepares a `context` of
// prepared maps/sets and calls the entry points below; nothing here touches
// supabase, so the whole engine is unit-testable without mocks.
//
// Core ranking formula (from FYP Algorithm Design):
//   25% Personal Relevance   — engagement quality (weighted actions)
//   15% Engagement Quality   — like(1) comment(3) profile(3) save(4) share(5) follow(6)
//                              long-read(4) video-completion(5) discussion(5)
//   15% Content Quality      — author authority, medical relevance, post format
//   10% Freshness            — linear decay from full strength (new) to 0 after a week
//   10% Creator Affinity     — follows the author + direct engagements
//   10% Local Relevance      — shared region tokens (states/cities, NOT country)
//   5% Discovery             — implicit interest boost from engaged themes/types/specialties
//   5% New-Content Boost     — freshness bonus for posts < 24h old
//   5% Conversation Value    — comment depth + meaningful discussion signals
//
// Then subtract penalties:
//   Fatigue Penalty        — repeated exposure to same post
//   Repeated Exposure Penalty — same content type/author too often
//   Negative Feedback Penalty — hide posts user hid/skipped
//   Creator Overexposure Penalty — no more than X posts from same author
//   Topic Overexposure Penalty — no more than Y posts about same topic
//
// Engagement Quality Weights (starting values; learned over time):
//   Like: 1, Comment: 3, Profile visit: 3, Save: 4, Share: 5
//   Follow creator: 6, Long reading time: 4, Video completion: 5
//   Meaningful discussion: 5
//
// Pools (candidate_generation_pools) A–I assemble the final list in priority
// order, each capped by its own contribution limit, and diversity caps keep
// one author (3) or one content type (5) from dominating. Pools are assigned
// by classifyIntoPoolsAIFull which uses multi-dimensional classification.

export const MEDICAL_BUSINESS_TYPES = ['pharmacy', 'hospital']

export const DEFAULT_RANKING_CONFIG = {
  weights: {
    personalRelevance: 25,     // engagement quality (weighted actions)
    engagementQuality: 15,     // like(1) comment(3) profile(3) save(4) share(5) follow(6) long-read(4) video-completion(5) discussion(5)
    contentQuality: 15,        // author authority, medical relevance, post format
    freshness: 10,             // linear decay from full strength (new) to 0 after a week
    creatorAffinity: 10,       // follows the author + direct engagements
    localRelevance: 10,        // shared region tokens (states/cities, NOT country)
    discovery: 5,              // implicit interest boost from engaged themes/types/specialties
    newContentBoost: 5,        // freshness bonus for posts < 24h old
    conversationValue: 5,      // comment depth + meaningful discussion signals
  },
  diversity: { maxPerAuthor: 3, maxPerType: 5 },
}

export const DEFAULT_POOLS = {
  // Pool A: New posts — freshly published, < 24h old
  new: { enabled: true, priority: 10, limitCount: 20 },
  // Pool B: Highly relevant posts — strongly matching user interests
  highlyRelevant: { enabled: true, priority: 20, limitCount: 25 },
  // Pool C: Trending posts — high engagement across the platform
  trending: { enabled: true, priority: 30, limitCount: 25 },
  // Pool D: Local posts — authors/businesses in user's region
  local: { enabled: true, priority: 40, limitCount: 20 },
  // Pool E: Emerging creators — verified but not yet established
  emergingCreators: { enabled: true, priority: 50, limitCount: 15 },
  // Pool F: Resurfaced posts — previously good content, paused then brought back
  resurfaced: { enabled: true, priority: 60, limitCount: 10 },
  // Pool G: Evergreen posts — established, consistent engagement
  evergreen: { enabled: true, priority: 70, limitCount: 10 },
  // Pool H: Discovery posts — completely different, algorithmic recommendation
  discovery: { enabled: true, priority: 80, limitCount: 8 },
  // Pool I: MedMarket and local business content
  medMarket: { enabled: true, priority: 90, limitCount: 12 },
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

// Raw, unnormalized per-post signals (each 0..1 where naturally bounded;
 // engagement and interests are unbounded and normalized per batch).
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

  // --- Engagement Quality: weighted sum of meaningful actions ---
  //   Like: 1, Comment: 3, Profile visit: 3, Save: 4, Share: 5
  //   Follow creator: 6, Long reading time: 4, Video completion: 5
  //   Meaningful discussion: 5
  const likeCount = lCounts[post.id] || 0
  const commentCount = cCounts[post.id] || 0
  const saveCount = sCounts[post.id] || 0
  const giftCount = giftStats[post.id]?.gift_count || 0
  const repostCount = post.repost_count || 0
  const viewCount = post.view_count || 0

  // Reading time and video completion are not in the basic context; we
  // treat missing values as 0 (the caller can inject them via context).
  const longReadingTime = context.longReadingTime?.[post.id] || 0
  const videoCompletion = context.videoCompletion?.[post.id] || 0
  const meaningfulDiscussion = context.meaningfulDiscussion?.[post.id] || 0

  const engagementQuality =
    likeCount * 1 +           // Like: 1 point
    commentCount * 3 +        // Comment: 3 points
    (context.profileVisits?.[post.id] || 0) * 3 +  // Profile visit: 3 points
    saveCount * 4 +           // Save: 4 points
    (context.shareCount?.[post.id] || 0) * 5 +      // Share: 5 points
    (follows.has(post.user_id) ? 6 : 0) +          // Follow creator: 6 points
    longReadingTime * 4 +     // Long reading time: 4 points
    videoCompletion * 5 +     // Video completion: 5 points
    meaningfulDiscussion * 5  // Meaningful discussion: 5 points

  // --- Content Quality: author authority + medical relevance ---
  let authority = 0
  if (post.posted_as_type) {
    authority = business && business.status === 'active' ? 0.6 : 0
  } else if (author?.is_verified) {
    authority = author.specialty || author.verification_label ? 1 : 0.6
  }

  const medical = isMedicalAuthor({ post, profile: author, business }) ? 1 : 0

  // --- Freshness: linear decay from full strength (new) to 0 after a week ---
  const ageHours = (now - new Date(post.created_at).getTime()) / 3600000
  const freshness = Math.max(0, Math.min(1, 1 - ageHours / 168))

  // --- New-Content Boost: bonus for posts < 24h old ---
  const newContentBoost = ageHours < 24 ? 1 : 0

  // --- Creator Affinity: follows the author + direct engagements ---
  const followsAuthor = follows.has(post.user_id)
  const directEngagements =
    (viewerReactionIds.has(post.id) ? 1 : 0) +
    (viewerCommentIds.has(post.id) ? 1 : 0) +
    (viewerSaveIds.has(post.id) ? 1 : 0)
  const creatorAffinity = (followsAuthor ? 0.6 : 0) + Math.min(0.4, directEngagements * 0.2)

  // --- Local Relevance: shared region tokens (states/cities, NOT country) ---
  const location = regionsOverlap(viewerRegion, regionTokensForPost({ post, profile: author, business }))

  // --- Discovery: implicit interest boost from engaged themes/types/specialties ---
  let discovery = 0
  if (interest) {
    const themeHits = interest.themeWeights.get(post.theme) || 0
    const typeHits = interest.typeWeights.get(post.post_type) || 0
    const specHits = author ? (interest.specialtyWeights.get(author.specialty || author.verification_label) || 0) : 0
    discovery = themeHits + typeHits + specHits * 2
  }

  // --- Conversation Value: comment depth + meaningful discussion signals ---
  const conversationValue = commentCount > 0 ? Math.min(1, commentCount / 10) : 0

  return {
    engagementQuality, recency: freshness, authority, medical,
    localRelevance: location, creatorAffinity, discovery, newContentBoost,
    conversationValue,
  }
}

// Core scoring shared by every entry point: raw signals → per-batch min-max
// normalization of the unbounded signals → weighted sum → sort. Returns
// [{ post, raw, _score }] sorted best-first, after applying fatigue and
// penalty filters.
export function scorePosts({ posts = [], context, weights }) {
  const w = { ...DEFAULT_RANKING_CONFIG.weights, ...(weights || {}) }

  const scored = posts.map((post) => ({ post, raw: computeRawSignals({ post, context }) }))

  // Min-max normalize the two unbounded signals across the batch.
  // Only 'engagementQuality' and 'discovery' are unbounded; the rest are
  // naturally 0..1 from computeRawSignals.
  const normalized = (key) => {
    const vals = scored.map((s) => s.raw[key]).filter((v) => Number.isFinite(v))
    const max = Math.max(0, ...vals)
    const min = Math.min(0, ...vals)
    const span = max - min || 1
    return scored.map((s) => (s.raw[key] - min) / span)
  }
  const engNorm = normalized('engagementQuality')
  const discNorm = normalized('discovery')

  // Fatigue and penalty state (per-render, purely client-side)
  const seenPostIds = new Set(context?.seenPostIds || [])
  const seenPostCount = new Map()  // post.id -> count of exposures in this session
  const authorExposure = new Map()  // authorKey -> count
  const topicExposure = new Map()   // theme|post_type -> count

  scored.forEach((s, i) => {
    const r = s.raw
    const authorKey = s.post.posted_as_id || s.post.user_id
    const topicKey = `${s.post.theme}|${s.post.post_type}`

    // Penalty: fatigue from repeated exposure
    const fatiguePenalty = (seenPostCount.get(s.post.id) || 0) * 0.05

    // Penalty: repeated exposure (same author too many posts)
    const authorPenalty = (authorExposure.get(authorKey) || 0) * 0.03

    // Penalty: topic overexposure
    const topicPenalty = (topicExposure.get(topicKey) || 0) * 0.03

    // Penalty: negative feedback (user hid/skipped this post)
    const negativeFeedback = (context?.negativeFeedbackIds || new Set()).has(s.post.id) ? 0.2 : 0

    // Penalty: creator overexposure (enforced later by diversity, but pre-filter here)
    const creatorOverexposure = (authorExposure.get(authorKey) || 0) >= 3 ? 0.2 : 0

    s._score =
      w.personalRelevance * engNorm[i] +
      w.engagementQuality * (engNorm[i] || 0) +  // will be remapped below
      w.contentQuality * r.authority +
      w.freshness * r.recency +
      w.creatorAffinity * r.creatorAffinity +
      w.localRelevance * r.localRelevance +
      w.discovery * discNorm[i] +
      w.newContentBoost * r.newContentBoost +
      w.conversationValue * r.conversationValue -
      fatiguePenalty -
      authorPenalty -
      topicPenalty -
      negativeFeedback -
      creatorOverexposure

    // Track exposure for subsequent posts in this batch
    seenPostCount.set(s.post.id, (seenPostCount.get(s.post.id) || 0) + 1)
    authorExposure.set(authorKey, (authorExposure.get(authorKey) || 0) + 1)
    topicExposure.set(topicKey, (topicExposure.get(topicKey) || 0) + 1)
  })

  // Sort by score desc, then by recency desc (tiebreaker)
  scored.sort((a, b) => b._score - a._score || (b.raw.freshness - a.raw.freshness))
  return scored
}

// Apply fatigue and negative-feedback penalties to an already-assembled list.
// Expects posts with an optional _meta.score for tie-breaking.
export function applyFatigueAndPenalties(posts, context) {
  const seenPostIds = new Set(context?.seenPostIds || [])
  const negativeFeedbackIds = new Set(context?.negativeFeedbackIds || [])
  return posts.filter((p) => {
    if (negativeFeedbackIds.has(p.id)) return false
    return true
  }).map((p) => {
    let penalty = 0
    if (seenPostIds.has(p.id)) penalty += 0.1
    return { ...p, _penalty: penalty }
  })
}

// Full For You pipeline: signals → weighted score → pool assembly (A-I) → diversity → fatigue/penalties.
// `weights`/`diversity`/`pools` are the resolved DB config (or defaults).
export function rankForYou({ posts = [], context, weights, diversity, pools }) {
  const d = { ...DEFAULT_RANKING_CONFIG.diversity, ...(diversity || {}) }
  const scored = scorePosts({ posts, context, weights })
  const poolSets = classifyIntoPoolsAIFull(scored, context)
  const assembled = assemblePoolsAIFull(scored, poolSets, pools)
  const withDiversity = applyDiversity(assembled, d)
  const withPenalties = applyFatigueAndPenalties(withDiversity, context)
  return withPenalties
}

// Plain weighted-score ranking WITHOUT pool assembly or diversity caps. This
// is what the content-type tabs use — capping per-author/per-type there would
// wrongly hide posts a reader explicitly asked for (e.g. 20 questions).
export function rankByScore({ posts = [], context, weights }) {
  return scorePosts({ posts, context, weights }).map((s) => s.post)
}

// Assign each scored post to its candidate pools using the full AI
// classification (pools A–I as defined in the FYP Algorithm Design).
function classifyIntoPoolsAIFull(scored, context) {
  const sets = {
    // Pool A: New posts — freshly published, < 24h old
    new: [],
    // Pool B: Highly relevant posts — strongly matching user interests
    highlyRelevant: [],
    // Pool C: Trending posts — high engagement across the platform
    trending: [],
    // Pool D: Local posts — authors/businesses in user's region
    local: [],
    // Pool E: Emerging creators — verified but not yet established
    emergingCreators: [],
    // Pool F: Resurfaced posts — previously good content, paused then brought back
    resurfaced: [],
    // Pool G: Evergreen posts — established, consistent engagement
    evergreen: [],
    // Pool H: Discovery posts — completely different, algorithmic recommendation
    discovery: [],
    // Pool I: MedMarket and local business content
    medMarket: [],
  }
  const { follows = new Set(), profiles = {}, interest = null, viewerRegion = [],
    negativeFeedbackIds = new Set(), seenPostIds = new Set() } = context
  const engVals = scored.map((s) => s.raw.engagementQuality).filter((v) => Number.isFinite(v))
  const engMax = Math.max(0, ...engVals) || 1

  scored.forEach((s) => {
    const p = s.post
    const author = profiles[p.user_id]
    const business = p.posted_as_id ? profiles[p.posted_as_id] : null  // simplified
    const ageHours = (context.now - new Date(p.created_at).getTime()) / 3600000

    // Pool A: New posts — < 24h old
    if (ageHours < 24) sets.new.push(p)

    // Pool B: Highly relevant — strong interest match
    if (interest) {
      const themeHits = interest.themeWeights.get(p.theme) || 0
      const typeHits = interest.typeWeights.get(p.post_type) || 0
      const specHits = author ? (interest.specialtyWeights.get(author.specialty || author.verification_label) || 0) : 0
      const relevanceScore = themeHits + typeHits + specHits * 2
      if (relevanceScore >= 3) sets.highlyRelevant.push(p)
    }

    // Pool C: Trending — high engagement quality
    if (s.raw.engagementQuality / engMax >= 0.6) sets.trending.push(p)

    // Pool D: Local — shared region tokens
    if (s.raw.localRelevance > 0) sets.local.push(p)

    // Pool E: Emerging creators — verified, not top-tier, engaged region
    if (author && author.is_verified && !author.is_top_tier && s.raw.localRelevance > 0) sets.emergingCreators.push(p)

    // Pool F: Resurfaced — previously scored well, now paused/resurfaced
    if (s.raw.engagementQuality > 0 && context?.resurfacedPoolIds?.includes(p.id)) sets.resurfaced.push(p)

    // Pool G: Evergreen — established engagement, older but not stale
    if (ageHours > 168 && s.raw.engagementQuality > 0) sets.evergreen.push(p)

    // Pool H: Discovery — low relevance but algorithmic interest
    if (s.raw.discovery > 0 && s.raw.engagementQuality < engMax * 0.3) sets.discovery.push(p)

    // Pool I: MedMarket and local business content
    if (business && business.business_type && MEDICAL_BUSINESS_TYPES.includes(business.business_type)) sets.medMarket.push(p)
  })
  // Catch-all: any scored post not in any pool goes to evergreen so nothing is silently dropped
  const classified = new Set(Object.values(sets).flat().map((p) => p.id))
  scored.forEach((s) => {
    if (!classified.has(s.post.id)) sets.evergreen.push(s.post)
  })
  return sets
}

// Assemble the feed pool-by-pool (priority order), each pool capped by its
// contribution limit; posts already surfaced by an earlier pool are skipped.
function assemblePoolsAIFull(scored, poolSets, pools) {
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
    .map((post) => ({ post, localRelevance: computeRawSignals({ post, context }).localRelevance }))
    .filter((x) => x.localRelevance > 0)
    .sort((a, b) => b.localRelevance - a.localRelevance || new Date(b.post.created_at) - new Date(a.post.created_at))
    .map((x) => x.post)
}
