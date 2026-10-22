import { describe, it, expect } from 'vitest'
import { parseReviewHash, reviewAnchorId } from './reviewLink'

const ID = '28afe617-c882-433c-b02f-5ad6661ebca1'

describe('parseReviewHash', () => {
  it('extracts the report id from the reviewer alert link', () => {
    expect(parseReviewHash(`#adr-${ID}`)).toBe(ID)
  })

  it('normalises case', () => {
    expect(parseReviewHash(`#adr-${ID.toUpperCase()}`)).toBe(ID)
  })

  it.each([
    '', null, undefined, '#', '#adr-', '#adr-123', `adr-${ID}`, `#other-${ID}`,
    `#adr-${ID}x`, `#adr-${ID}"><img src=x>`, `#adr-${ID}&x=1`,
  ])('rejects %j', (hash) => {
    expect(parseReviewHash(hash)).toBeNull()
  })
})

describe('reviewAnchorId', () => {
  it('matches the id the alert link points at', () => {
    expect(reviewAnchorId(ID)).toBe(`adr-${ID}`)
  })
})
