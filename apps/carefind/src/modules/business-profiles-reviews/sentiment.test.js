import { describe, it, expect } from 'vitest'
import { classifySentiment, extractCommonThemes, getSentimentSummary } from './sentiment.js'

describe('classifySentiment', () => {
  it('classifies high ratings as positive', () => {
    expect(classifySentiment(5, '')).toBe('positive')
    expect(classifySentiment(4, '')).toBe('positive')
  })

  it('classifies low ratings as negative', () => {
    expect(classifySentiment(1, '')).toBe('negative')
    expect(classifySentiment(2, '')).toBe('negative')
  })

  it('treats a 3-star rating with no comment as neutral', () => {
    expect(classifySentiment(3, '')).toBe('neutral')
  })

  it('positive keywords push a middling rating into positive', () => {
    expect(classifySentiment(3, 'very good and effective, I recommend')).toBe('positive')
  })

  it('negative keywords push a good rating into negative', () => {
    expect(classifySentiment(4, 'fake product, expired and a scam')).toBe('negative')
  })

  it('ignores missing comments', () => {
    expect(classifySentiment(3, null)).toBe('neutral')
    expect(classifySentiment(3, undefined)).toBe('neutral')
  })

  it('matches keywords case-insensitively', () => {
    expect(classifySentiment(3, 'GOOD effective product')).toBe('positive')
  })
})

describe('extractCommonThemes', () => {
  it('returns words mentioned by at least two reviews, most frequent first', () => {
    const reviews = [
      { comment: 'the packaging arrived damaged' },
      { comment: 'packaging was fine but shipping slow' },
      { comment: 'shipping was delayed' },
    ]
    const themes = extractCommonThemes(reviews)
    expect(themes[0]).toBe('packaging') // 2 mentions, tied with shipping but seen first
    expect(themes).toContain('shipping')
    expect(themes).not.toContain('damaged') // single mention is filtered out
  })

  it('returns no themes for an empty review list', () => {
    expect(extractCommonThemes([])).toEqual([])
  })

  it('ignores stop words and words of four letters or fewer', () => {
    const reviews = [
      { comment: 'this product is extremely effective' },
      { comment: 'this product is really effective' },
    ]
    const themes = extractCommonThemes(reviews)
    expect(themes).not.toContain('this')
    expect(themes).not.toContain('very')
    expect(themes).not.toContain('product')
    expect(themes).toContain('effective')
  })

  it('caps the theme list at eight entries', () => {
    const comments = ['alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo']
    const reviews = comments.map((comment) => ({ comment }))
    for (let i = 0; i < 5; i++) reviews.push({ comment: comments[0] })
    expect(extractCommonThemes(reviews).length).toBeLessThanOrEqual(8)
  })
})

describe('getSentimentSummary', () => {
  const reviews = [
    { id: '1', rating: 5, comment: 'excellent' },
    { id: '2', rating: 3, comment: '' },
    { id: '3', rating: 1, comment: 'terrible' },
  ]

  it('classifies each review and keeps the original shape', () => {
    const summary = getSentimentSummary(reviews)
    expect(summary.classified).toHaveLength(3)
    expect(summary.classified[0].id).toBe('1')
    expect(summary.classified[0].sentiment).toBe('positive')
    expect(summary.classified[2].sentiment).toBe('negative')
  })

  it('splits reviews into positive, negative and neutral buckets', () => {
    const summary = getSentimentSummary(reviews)
    expect(summary.positive.map((r) => r.id)).toEqual(['1'])
    expect(summary.neutral.map((r) => r.id)).toEqual(['2'])
    expect(summary.negative.map((r) => r.id)).toEqual(['3'])
  })

  it('extracts themes across the whole review set', () => {
    const summary = getSentimentSummary(reviews)
    expect(Array.isArray(summary.themes)).toBe(true)
  })
})