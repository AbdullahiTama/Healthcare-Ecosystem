import { describe, it, expect } from 'vitest'
import { extractMentions } from './mentions'

describe('extractMentions', () => {
  it('returns unique usernames in first-seen order', () => {
    expect(extractMentions('@ada asked and @bola replied to @ada')).toEqual(['ada', 'bola'])
  })

  it('normalises case to lower', () => {
    expect(extractMentions('Hi @DrAda')).toEqual(['drada'])
  })

  it('supports digits, underscore, dot and dash in usernames', () => {
    expect(extractMentions('@doc_ada and @nurse.2 and @dr-dan')).toEqual(['doc_ada', 'nurse.2', 'dr-dan'])
  })

  it('ignores email addresses and @ not followed by a username', () => {
    expect(extractMentions('mail me at ada@example.com or @ or price @10')).toEqual([])
  })

  it('returns [] for empty or null input', () => {
    expect(extractMentions('')).toEqual([])
    expect(extractMentions(null)).toEqual([])
    expect(extractMentions(undefined)).toEqual([])
  })
})