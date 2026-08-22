import { describe, it, expect, vi } from 'vitest'
import {
  articleStats, compareForLoss, validateArticleForPublish, LOSS_TOLERANCE_CHARS,
} from './articleContent.js'

const silent = { info: vi.fn(), error: vi.fn() }

const body = (...contents) => JSON.stringify(
  contents.map((c, i) => ({ id: `b${i}`, type: 'text', content: c }))
)

describe('articleStats', () => {
  it('counts blocks and non-whitespace prose characters', () => {
    const stats = articleStats(body('one two', 'three'))
    expect(stats.blocks).toBe(2)
    expect(stats.chars).toBe('onetwo'.length + 'three'.length)
  })

  it('treats legacy plain text as a single block', () => {
    expect(articleStats('just plain text').blocks).toBe(1)
  })

  it('counts a drawing block by its caption only, not its stroke data', () => {
    const withDrawing = JSON.stringify([
      { id: 'a', type: 'text', content: 'prose' },
      { id: 'b', type: 'drawing', caption: 'fig 1', strokes: [{ points: [{ x: 1, y: 2 }] }] },
    ])
    const stats = articleStats(withDrawing)
    expect(stats.blocks).toBe(2)
    expect(stats.chars).toBe('prose'.length + 'fig1'.length)
  })

  it('never throws on malformed input', () => {
    expect(articleStats(null).chars).toBe(0)
    expect(articleStats('[not json').blocks).toBe(1)
    expect(articleStats(42).blocks).toBe(0)
  })
})

describe('compareForLoss', () => {
  it('accepts an unchanged body', () => {
    const b = body('hello world')
    expect(compareForLoss(b, b).ok).toBe(true)
  })

  it('accepts a body that only lost formatting markers', () => {
    const before = body('==color|hello== world')
    const after = body('hello== world')
    const result = compareForLoss(before, after)
    expect(result.ok).toBe(true)
    expect(result.lostChars).toBeLessThanOrEqual(LOSS_TOLERANCE_CHARS)
  })

  it('rejects a body that lost a whole block', () => {
    const result = compareForLoss(body('para one', 'para two'), body('para one'))
    expect(result.ok).toBe(false)
    expect(result.lostBlocks).toBe(1)
  })

  it('rejects a body that lost a paragraph of prose', () => {
    const long = 'x'.repeat(200)
    const result = compareForLoss(body('kept', long), body('kept', ''))
    expect(result.ok).toBe(false)
    expect(result.lostChars).toBe(200)
  })

  it('accepts a body that grew', () => {
    expect(compareForLoss(body('short'), body('short', 'plus more')).ok).toBe(true)
  })
})

describe('validateArticleForPublish', () => {
  it('passes a clean article through unchanged', () => {
    const clean = body('A complete article body.')
    const result = validateArticleForPublish(clean, { logger: silent })
    expect(result.ok).toBe(true)
    expect(result.content).toBe(clean)
  })

  it('refuses an empty article with a clear message', () => {
    const result = validateArticleForPublish(body('   '), { logger: silent })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/empty/i)
  })

  it('repairs malformed colour markers instead of persisting them', () => {
    const result = validateArticleForPublish(body('**==color|Heading==color|**\n\nBody text here.'), { logger: silent })
    expect(result.ok).toBe(true)
    expect(result.content).not.toContain('color|')
    expect(result.content).toContain('Heading')
    expect(result.content).toContain('Body text here.')
  })

  it('leaves a valid highlight alone while repairing a broken one', () => {
    const result = validateArticleForPublish(body('==#fde68a|kept== and ==color|broken=='), { logger: silent })
    expect(result.content).toContain('==#fde68a|kept==')
    expect(result.content).not.toContain('==color|')
  })

  it('logs the published shape so content loss is visible in logs', () => {
    const logger = { info: vi.fn(), error: vi.fn() }
    validateArticleForPublish(body('hello world'), { logger })
    expect(logger.info).toHaveBeenCalledWith('[article] publish integrity', expect.objectContaining({
      blocks: 1,
      chars: 'helloworld'.length,
      repairedMarkers: 0,
    }))
  })

  it('does not throw on a legacy plain-text body', () => {
    const result = validateArticleForPublish('a legacy plain text article', { logger: silent })
    expect(result.ok).toBe(true)
  })
})
