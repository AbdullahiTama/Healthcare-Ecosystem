import { describe, it, expect } from 'vitest'
import { tallyTerms, demandGaps } from './searchTally'

const q = (query, found = true) => ({ query, found })

describe('tallyTerms', () => {
  it('lower-cases and trims so variants tally together', () => {
    expect(tallyTerms([q('Panadol '), q('panadol'), q('PANADOL')])).toEqual([['panadol', 3]])
  })
  it('sorts by count descending, ties keep first-seen order', () => {
    expect(tallyTerms([q('b'), q('a'), q('a'), q('c'), q('b'), q('d')])).toEqual([['b', 2], ['a', 2], ['c', 1], ['d', 1]])
  })
  it('honours the limit', () => {
    expect(tallyTerms([q('a'), q('b'), q('c')], 2)).toHaveLength(2)
  })
  it('ignores rows without a string query', () => {
    expect(tallyTerms([{}, { query: null }, { query: 5 }, q('  '), q('a')])).toEqual([['a', 1]])
  })
  it('returns [] for empty input', () => {
    expect(tallyTerms([])).toEqual([])
  })
})

describe('demandGaps', () => {
  it('counts only rows that were not found', () => {
    expect(demandGaps([q('a', false), q('A', false), q('b', true), { query: 'c' }])).toEqual([['a', 2], ['c', 1]])
  })
  it('honours the limit and ignores rows with no query', () => {
    expect(demandGaps([{ found: false }, q('a', false), q('b', false)], 1)).toEqual([['a', 1]])
  })
  it('does not throw on a null row', () => {
    expect(demandGaps([null, undefined, q('a', false)])).toEqual([['a', 1]])
  })
  it('returns [] for empty input', () => {
    expect(demandGaps([])).toEqual([])
  })
})
