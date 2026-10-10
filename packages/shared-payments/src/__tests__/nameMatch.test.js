import { describe, it, expect } from 'vitest'
import { nameTokens, matchPersonName, matchBusinessName } from '../kyc/nameMatch.js'

const ada = { first: 'Ada', middle: 'Chinyere', last: 'Obi' }

describe('nameTokens', () => {
  it('upper-cases, strips accents/punctuation/titles', () => {
    expect(nameTokens("Mr. Ọbi-O'Neil  Ada")).toEqual(['OBI', 'ONEIL', 'ADA'])
    expect(nameTokens('ALHAJI Musa')).toEqual(['MUSA'])
    expect(nameTokens(null)).toEqual([])
  })
})

describe('matchPersonName', () => {
  it.each([
    ['ADA CHINYERE OBI'],
    ['OBI ADA CHINYERE'],
    ['OBI ADA'],
    ['MRS ADA OBI'],
    ['ADA C OBI'],
    ['ADA OBI CHINYERE'],
  ])('accepts %s', (bank) => expect(matchPersonName(bank, ada).matches).toBe(true))

  it('tolerates one typo only in longer names', () => {
    expect(matchPersonName('ADAEZE CHINYERE OBINNA', { first: 'Adaeze', last: 'Obinna' }).matches).toBe(true)
    expect(matchPersonName('ADAEZE OBINNE', { first: 'Adaeze', last: 'Obinna' }).matches).toBe(true) // 1 edit, 6+ letters
    expect(matchPersonName('ADAEZE BELLA', { first: 'Adaeze', last: 'Bello' }).matches).toBe(false) // 5 letters: no typo allowance
    expect(matchPersonName('ADE OBI', { first: 'Ada', last: 'Obi' }).matches).toBe(false) // short names are different people
  })

  it('handles compound names written split or joined', () => {
    expect(matchPersonName('ADE BAYO OKAFOR', { first: 'Adebayo', last: 'Okafor' }).matches).toBe(true)
    expect(matchPersonName('ADEBAYO OKAFOR', { first: 'Ade-Bayo', last: 'Okafor' }).matches).toBe(true)
  })

  it('needs BOTH first and last name', () => {
    expect(matchPersonName('ADA', ada).matches).toBe(false)
    expect(matchPersonName('OBI', ada).matches).toBe(false)
    expect(matchPersonName('ADA BELLO', ada).matches).toBe(false)
  })

  it('refuses joint accounts and names with unexplained extra words', () => {
    expect(matchPersonName('ADA OBI & TUNDE BELLO', ada).reason).toBe('joint_account')
    expect(matchPersonName('ADA OBI AND SONS', ada).matches).toBe(false)
    expect(matchPersonName('ADA OBI PHARMACY STORES NIG', ada).reason).toBe('extra_words')
  })

  it('does not match a different person who shares one name', () => {
    expect(matchPersonName('TUNDE OBI', ada).matches).toBe(false)
  })

  it('degrades safely on missing data', () => {
    expect(matchPersonName('', ada).matches).toBe(false)
    expect(matchPersonName('ADA OBI', { first: 'Ada', last: '' }).reason).toBe('missing_name')
  })

  it('scores a full-name match higher than a partial one', () => {
    expect(matchPersonName('ADA CHINYERE OBI', ada).score).toBeGreaterThan(matchPersonName('ADA OBI', ada).score)
  })
})

describe('matchBusinessName', () => {
  it('ignores legal-form words and word order noise', () => {
    expect(matchBusinessName('GRACE PHARMACY LIMITED', 'Grace Pharmacy').matches).toBe(true)
    expect(matchBusinessName('GRACE PHARMACY', 'Grace Pharmacy Ltd').matches).toBe(true)
    expect(matchBusinessName('GRACE PHARMACY ENTERPRISES', 'Grace Pharmacy').matches).toBe(true)
  })
  it('rejects a different or much longer name', () => {
    expect(matchBusinessName('MERCY PHARMACY', 'Grace Pharmacy').matches).toBe(false)
    expect(matchBusinessName('GRACE PHARMACY AND DIAGNOSTICS CENTRE', 'Grace Pharmacy').matches).toBe(false)
    expect(matchBusinessName('', 'Grace Pharmacy').matches).toBe(false)
  })
})
