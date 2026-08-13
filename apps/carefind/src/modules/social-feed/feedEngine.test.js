import { describe, it, expect } from 'vitest'
import {
  normalizeRegion, regionsOverlap, isMedicalAuthor, buildInterestProfile,
  computeRawSignals, rankForYou, rankByScore, applyDiversity, rankNearby,
  DEFAULT_RANKING_CONFIG, DEFAULT_POOLS,
} from './feedEngine'

const post = (over = {}) => ({
  id: 'p1', user_id: 'u1', content: 'hello', created_at: new Date(Date.now() - 3600000).toISOString(),
  post_type: 'text', theme: 'teal-depth', view_count: 10, repost_count: 0,
  posted_as_type: null, posted_as_id: null,
  ...over,
})

const baseContext = () => ({
  lCounts: {}, cCounts: {}, sCounts: {}, saveCounts: {}, giftStats: {},
  follows: new Set(), viewerReactionIds: new Set(), viewerCommentIds: new Set(), viewerSaveIds: new Set(),
  profiles: {}, businesses: {}, interest: null, viewerRegion: [], now: Date.now(),
})

describe('normalizeRegion / regionsOverlap', () => {
  it('turns free text into clean tokens and drops country noise', () => {
    expect(normalizeRegion('Lagos, Nigeria')).toEqual(['lagos'])
    expect(normalizeRegion('Ikeja Lagos')).toEqual(['ikeja', 'lagos'])
    expect(normalizeRegion('ng')).toEqual([])
  })
  it('counts shared tokens only when both sides have regions', () => {
    expect(regionsOverlap(['lagos'], ['lagos', 'ikeja'])).toBe(1)
    expect(regionsOverlap(['lagos'], ['abuja'])).toBe(0)
    expect(regionsOverlap([], ['lagos'])).toBe(0)
  })
})

describe('isMedicalAuthor', () => {
  it('accepts a verified professional profile', () => {
    expect(isMedicalAuthor({ post: post(), profile: { is_verified: true }, business: null })).toBe(true)
    expect(isMedicalAuthor({ post: post(), profile: { is_verified: false }, business: null })).toBe(false)
  })
  it('accepts an active pharmacy/hospital facility for posted-as posts', () => {
    const b = { business_type: 'pharmacy', status: 'active' }
    expect(isMedicalAuthor({ post: post({ posted_as_type: 'business', posted_as_id: 'b1' }), profile: null, business: b })).toBe(true)
  })
  it('rejects non-medical or inactive facilities', () => {
    expect(isMedicalAuthor({ post: post({ posted_as_type: 'business', posted_as_id: 'b1' }), profile: null, business: { business_type: 'skincare', status: 'active' } })).toBe(false)
    expect(isMedicalAuthor({ post: post({ posted_as_type: 'business', posted_as_id: 'b1' }), profile: null, business: { business_type: 'pharmacy', status: 'pending' } })).toBe(false)
  })
})

describe('buildInterestProfile', () => {
  it('derives theme/type/specialty weights from the viewer engagement', () => {
    const postMap = { p1: { theme: 'teal-depth', post_type: 'article', user_id: 'u1' }, p2: { theme: 'teal-depth', post_type: 'visual', user_id: 'u2' } }
    const authorProfiles = { u1: { specialty: 'General Practice' } }
    const interest = buildInterestProfile({
      postMap, authorProfiles,
      viewer: { reactedPostIds: new Set(['p1']), savedPostIds: new Set(['p2']), followedProfileIds: new Set() },
    })
    expect(interest.themeWeights.get('teal-depth')).toBe(2)
    expect(interest.typeWeights.get('article')).toBe(1)
    expect(interest.specialtyWeights.get('General Practice')).toBe(1)
  })
})

describe('computeRawSignals', () => {
  it('scores engagement from relational counts', () => {
    const ctx = baseContext()
    ctx.lCounts.p1 = 2; ctx.cCounts.p1 = 1; ctx.view_count = 0
    const raw = computeRawSignals({ post: post({ view_count: 200 }), context: ctx })
    expect(raw.engagement).toBe(2 * 3 + 1 * 5 + 2) // likes·3 + comments·5 + views/100
  })
  it('boosts affinity when the viewer follows and engages with the author', () => {
    const ctx = baseContext()
    ctx.follows.add('u1'); ctx.viewerReactionIds.add('p1')
    const raw = computeRawSignals({ post: post(), context: ctx })
    expect(raw.affinity).toBe(0.6 + 0.2)
  })
  it('marks verified-professional authority and medical relevance', () => {
    const ctx = baseContext()
    ctx.profiles.u1 = { is_verified: true, specialty: 'Cardiology' }
    const raw = computeRawSignals({ post: post(), context: ctx })
    expect(raw.authority).toBe(1)
    expect(raw.medical).toBe(1)
  })
  it('scores a shared region for the location signal', () => {
    const ctx = baseContext()
    ctx.viewerRegion = ['lagos']
    ctx.profiles.u1 = { location: 'Lagos' }
    const raw = computeRawSignals({ post: post(), context: ctx })
    expect(raw.location).toBe(1)
  })
})

const now = Date.now()
const makePosts = (n, over) => Array.from({ length: n }, (_, i) => post({ id: `p${i}`, user_id: `u${i}`, ...over }))

describe('rankForYou', () => {
  it('ranks higher engagement ahead of lower engagement', () => {
    const posts = [post({ id: 'hot', view_count: 500 }), post({ id: 'cold', view_count: 0 })]
    const ctx = baseContext()
    ctx.lCounts.hot = 20
    const ranked = rankForYou({ posts, context: ctx })
    expect(ranked[0].id).toBe('hot')
  })

  it('diversifies so a single author cannot dominate', () => {
    const posts = makePosts(10, { user_id: 'same-author' })
    const ctx = baseContext()
    ctx.lCounts = Object.fromEntries(posts.map((p) => [p.id, 10]))
    const ranked = rankForYou({ posts, context: ctx })
    expect(ranked.filter((p) => p.user_id === 'same-author').length).toBe(DEFAULT_RANKING_CONFIG.diversity.maxPerAuthor)
  })

  it('honors pool contribution limits and priority order', () => {
    // Following posts are smaller priority but should appear; fresh is lowest.
    const posts = [
      post({ id: 'f1', user_id: 'follower', created_at: new Date(now - 1000).toISOString() }),
      post({ id: 'x1', user_id: 'x', created_at: new Date(now - 2000).toISOString() }),
    ]
    const ctx = baseContext()
    ctx.follows.add('follower')
    const pools = { ...DEFAULT_POOLS, fresh: { enabled: true, priority: 60, limitCount: 1 } }
    const ranked = rankForYou({ posts, context: ctx, pools })
    expect(ranked.length).toBe(2)
    expect(ranked[0].id).toBe('f1') // following (priority 20) before fresh (60)
  })

  it('weights are configurable — a high location weight surfaces nearby posts', () => {
    const posts = [
      post({ id: 'near', user_id: 'near_author', created_at: new Date(now - 5000).toISOString() }),
      post({ id: 'far', user_id: 'far_author', created_at: new Date(now - 1000).toISOString() }),
    ]
    const ctx = baseContext()
    ctx.viewerRegion = ['lagos']
    ctx.profiles.near_author = { location: 'Lagos' }
    ctx.profiles.far_author = { location: 'Abuja' }
    const weights = { ...DEFAULT_RANKING_CONFIG.weights, location: 100, engagement: 0, recency: 0, affinity: 0, authority: 0, medical: 0, interests: 0 }
    const ranked = rankForYou({ posts, context: ctx, weights })
    expect(ranked[0].id).toBe('near')
  })
})

describe('rankByScore', () => {
  it('does not diversity-cap content-type tabs — everything asked for is kept', () => {
    const posts = makePosts(10, { user_id: 'one-author', post_type: 'question' })
    const ctx = baseContext()
    const ranked = rankByScore({ posts, context: ctx })
    expect(ranked.length).toBe(10)
  })
})

describe('rankNearby', () => {
  it('keeps only region-matching posts, best match first', () => {
    const ctx = baseContext()
    ctx.viewerRegion = ['lagos', 'ikeja']
    ctx.profiles.u1 = { location: 'Ikeja Lagos' }
    ctx.profiles.u2 = { location: 'Lagos' }
    ctx.profiles.u3 = { location: 'Abuja' }
    const posts = [post({ id: 'p3', user_id: 'u3' }), post({ id: 'p1' }), post({ id: 'p2', user_id: 'u2' })]
    const nearby = rankNearby(posts, ctx)
    expect(nearby.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('applyDiversity', () => {
  it('caps per-author and per-type counts', () => {
    const posts = [
      post({ id: 'a1', user_id: 'u1' }), post({ id: 'a2', user_id: 'u1' }), post({ id: 'a3', user_id: 'u1' }), post({ id: 'a4', user_id: 'u1' }),
    ]
    const out = applyDiversity(posts, { maxPerAuthor: 3, maxPerType: 5 })
    expect(out.length).toBe(3)
  })
})
