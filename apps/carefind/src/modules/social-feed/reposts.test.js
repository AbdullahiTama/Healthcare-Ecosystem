import { describe, it, expect } from 'vitest'
import {
  isRepostRow, unresolvedSourceIds, indexPosts, sourceOf, resolveCard, legacyContentOf,
} from './reposts.js'

const original = { id: 'src1', user_id: 'author', content: 'Movement is medicine', post_type: 'article' }
const repost = { id: 'rp1', user_id: 'sharer', content: '🔁', repost_of: 'src1', post_type: 'text' }
const legacyRepost = { id: 'rp0', user_id: 'sharer', content: '🔁 Movement is medicine', repost_of: 'src1' }
const plain = { id: 'p1', user_id: 'someone', content: 'a normal post' }

describe('isRepostRow', () => {
  it('recognises a reference repost', () => {
    expect(isRepostRow(repost)).toBe(true)
  })

  it('recognises a legacy content-marker repost that predates repost_of', () => {
    expect(isRepostRow({ id: 'x', content: '🔁 copied words' })).toBe(true)
  })

  it('is false for an ordinary post and for nothing', () => {
    expect(isRepostRow(plain)).toBe(false)
    expect(isRepostRow(null)).toBe(false)
    expect(isRepostRow({})).toBe(false)
  })
})

describe('unresolvedSourceIds', () => {
  it('asks for a source that is not already on the page', () => {
    expect(unresolvedSourceIds([repost, plain])).toEqual(['src1'])
  })

  it('asks for nothing when the source is already on the page', () => {
    expect(unresolvedSourceIds([original, repost])).toEqual([])
  })

  it('deduplicates two users reposting the same source', () => {
    const second = { ...repost, id: 'rp2', user_id: 'other' }
    expect(unresolvedSourceIds([repost, second])).toEqual(['src1'])
  })

  it('handles an empty or missing list', () => {
    expect(unresolvedSourceIds([])).toEqual([])
    expect(unresolvedSourceIds(null)).toEqual([])
  })
})

describe('resolveCard', () => {
  it('renders an ordinary post as itself, with no repost attribution', () => {
    const card = resolveCard(plain, indexPosts([plain]))
    expect(card.source).toBe(plain)
    expect(card.repostedBy).toBeNull()
    expect(card.pending).toBe(false)
  })

  it('renders a repost from the SOURCE, crediting the original author', () => {
    const card = resolveCard(repost, indexPosts([repost, original]))
    expect(card.source).toBe(original)
    expect(card.source.user_id).toBe('author')
    expect(card.repostedBy).toBe('sharer')
  })

  it('keeps the source post_type, so a reposted article is still an article', () => {
    const card = resolveCard(repost, indexPosts([repost, original]))
    expect(card.source.post_type).toBe('article')
  })

  it('marks a repost pending rather than falling back to the repost row', () => {
    // Falling back is how the reposter ended up credited as the author.
    const card = resolveCard(repost, indexPosts([repost]))
    expect(card.pending).toBe(true)
    expect(card.source).toBeNull()
  })

  it('resolves a legacy copied-content repost from its source too', () => {
    const card = resolveCard(legacyRepost, indexPosts([legacyRepost, original]))
    expect(card.source).toBe(original)
    expect(card.repostedBy).toBe('sharer')
  })
})

describe('sourceOf', () => {
  it('returns null for a non-repost', () => {
    expect(sourceOf(plain, indexPosts([plain]))).toBeNull()
  })

  it('tolerates a missing index', () => {
    expect(sourceOf(repost, undefined)).toBeNull()
  })
})

describe('legacyContentOf', () => {
  it('strips the marker from an un-backfilled repost', () => {
    expect(legacyContentOf(legacyRepost)).toBe('Movement is medicine')
  })

  it('leaves an ordinary post content alone', () => {
    expect(legacyContentOf(plain)).toBe('a normal post')
  })

  it('is empty for a bare marker row', () => {
    expect(legacyContentOf(repost)).toBe('')
  })
})
