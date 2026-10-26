import { describe, it, expect } from 'vitest'
import { normalize, findDuplicate, findAllDuplicateGroups, createDuplicateIndex } from '../productMatches.js'

describe('normalize', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalize('  AmoxiL   Capsule ')).toBe('amoxil capsule')
  })

  it('strips punctuation that would otherwise split a name', () => {
    expect(normalize('Paracetamol-125mg/5ml')).toBe('paracetamol125mg5ml')
    expect(normalize('Dolo (650mg)')).toBe('dolo 650mg')
  })

  it('treats undefined, null and empty as empty', () => {
    expect(normalize(undefined)).toBe('')
    expect(normalize(null)).toBe('')
    expect(normalize('')).toBe('')
  })
})

describe('findDuplicate', () => {
  const products = [
    { id: '1', name: 'Amoxil', generic_name: 'Amoxicillin' },
    { id: '2', name: 'Panadol', generic_name: 'Paracetamol' },
  ]

  it('matches an existing product by identical brand name', () => {
    expect(findDuplicate(products, 'panadol', 'Paracetamol', null)).toEqual(products[1])
  })

  it('matches an existing product by generic name when brand differs', () => {
    expect(findDuplicate(products, 'Tylenol', 'paracetamol', null)).toEqual(products[1])
  })

  it('returns null when nothing matches', () => {
    expect(findDuplicate(products, 'Aspirin', 'Acetylsalicylic acid', null)).toBeNull()
  })

  it('returns null when both names are empty', () => {
    expect(findDuplicate(products, '', '', null)).toBeNull()
  })

  it('never matches the product being edited against itself', () => {
    expect(findDuplicate(products, 'Amoxil', 'Amoxicillin', '1')).toBeNull()
  })
})

describe('findAllDuplicateGroups', () => {
  it('groups products that share a brand or generic name', () => {
    const all = [
      { id: '1', name: 'Amoxil', generic_name: 'Amoxicillin' },
      { id: '2', name: 'Panadol', generic_name: 'Paracetamol' },
      { id: '3', name: 'amoxil', generic_name: 'Amoxicillin' },
      { id: '4', name: 'Tylenol', generic_name: 'Paracetamol' },
    ]
    const groups = findAllDuplicateGroups(all)
    expect(groups.length).toBe(2)
    const ids = groups.map((g) => g.map((p) => p.id).sort())
    expect(ids).toContainEqual(['1', '3'])
    expect(ids).toContainEqual(['2', '4'])
  })

  it('returns no groups when every product is unique', () => {
    const list = [
      { id: '1', name: 'Amoxil', generic_name: 'Amoxicillin' },
      { id: '2', name: 'Panadol', generic_name: 'Paracetamol' },
    ]
    expect(findAllDuplicateGroups(list)).toEqual([])
  })

  it('returns no groups for an empty list', () => {
    expect(findAllDuplicateGroups([])).toEqual([])
  })

  it('chained matches collapse into a single group', () => {
    const list = [
      { id: '1', name: 'A', generic_name: 'X' },
      { id: '2', name: 'B', generic_name: 'X' },
      { id: '3', name: 'B', generic_name: 'Y' },
    ]
    const groups = findAllDuplicateGroups(list)
    expect(groups.length).toBe(1)
    expect(groups[0].map((p) => p.id).sort()).toEqual(['1', '2', '3'])
  })
})

describe('createDuplicateIndex', () => {
  const list = [
    { id: '1', name: 'Amoxil 500mg', generic_name: 'Amoxicillin' },
    { id: '2', name: 'Panadol', generic_name: 'Paracetamol' },
    { id: '3', name: 'Emzor Paracetamol', generic_name: 'Paracetamol' },
    { id: '4', name: 'Amoxicillin', genericName: 'Amoxicillin trihydrate' },
    { id: '5', name: '', generic_name: '' },
  ]
  const queries = [
    ['amoxil 500MG', ''],
    ['Unknown', 'paracetamol'],
    ['Amoxicillin', ''],
    ['Something', 'Amoxicillin'],
    // Name matches a later row, generic matches an earlier one: the earlier wins.
    ['Amoxicillin', 'Paracetamol'],
    ['Panadol!', 'Ibuprofen'],
    ['No match', 'Nothing'],
    ['', ''],
    [null, undefined],
  ]

  it('gives exactly the same answer as findDuplicate', () => {
    const index = createDuplicateIndex(list)
    for (const [name, generic] of queries) {
      expect(index.find(name, generic)).toBe(findDuplicate(list, name, generic))
    }
  })

  it('handles an empty catalog', () => {
    expect(createDuplicateIndex([]).find('Panadol', 'Paracetamol')).toBeNull()
  })
})
