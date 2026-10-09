import { describe, it, expect } from 'vitest'
import { parseDiscoveryQuery, matchCategory } from '../services/queryParser'

const CATS = [
  'Pharmacy', 'Hospital', 'Clinic', 'Specialist Hospital', 'Diagnostic Centre', 'Eye Clinic/Optometry',
  'Pharmaceutical Distributor', 'Cosmetics Business', 'Aesthetic/Cosmetic Centre', 'Medical Laboratory',
].map((name) => ({ name }))

describe('parseDiscoveryQuery — the specification examples', () => {
  it('Find pharmacies around me.', () => {
    expect(parseDiscoveryQuery('Find pharmacies around me.', CATS)).toMatchObject({ category: 'Pharmacy', location: { kind: 'current' }, quantity: null, radiusKm: null })
  })
  it('Find hospitals within 5 km.', () => {
    const r = parseDiscoveryQuery('Find hospitals within 5 km.', CATS)
    expect(r).toMatchObject({ category: 'Hospital', radiusKm: 5, location: null })
    expect(r.quantity).toBeNull()
  })
  it('Show me 20 cosmetic businesses around Surulere.', () => {
    expect(parseDiscoveryQuery('Show me 20 cosmetic businesses around Surulere.', CATS)).toMatchObject({
      category: 'Cosmetics Business', quantity: 20, location: { kind: 'named', name: 'Surulere' },
    })
  })
  it('Find diagnostic centres around Ikeja.', () => {
    expect(parseDiscoveryQuery('Find diagnostic centres around Ikeja.', CATS)).toMatchObject({ category: 'Diagnostic Centre', location: { kind: 'named', name: 'Ikeja' } })
  })
  it('Find pharmaceutical distributors in Lagos.', () => {
    expect(parseDiscoveryQuery('Find pharmaceutical distributors in Lagos.', CATS)).toMatchObject({ category: 'Pharmaceutical Distributor', location: { kind: 'named', name: 'Lagos' } })
  })
  it('Find eye clinics near me.', () => {
    expect(parseDiscoveryQuery('Find eye clinics near me.', CATS)).toMatchObject({ category: 'Eye Clinic/Optometry', location: { kind: 'current' } })
  })
})

describe('parseDiscoveryQuery — edges', () => {
  it('longest phrase wins: specialist hospital, not hospital', () => {
    expect(parseDiscoveryQuery('specialist hospitals in Yaba', CATS).category).toBe('Specialist Hospital')
  })
  it('radius in metres and miles', () => {
    expect(parseDiscoveryQuery('pharmacies within 500 m of Yaba', CATS).radiusKm).toBe(0.5)
    expect(parseDiscoveryQuery('clinics within 2 miles', CATS).radiusKm).toBeCloseTo(3.22, 1)
  })
  it('the radius number is not mistaken for a quantity', () => {
    expect(parseDiscoveryQuery('Find hospitals within 10 km of Ikeja', CATS)).toMatchObject({ radiusKm: 10, quantity: null, location: { kind: 'named', name: 'Ikeja' } })
  })
  it('does not invent a category or location', () => {
    const r = parseDiscoveryQuery('what is the weather', CATS)
    expect(r.category).toBeNull()
    expect(r.location).toBeNull()
    expect(r.understood).toBe(false)
  })
  it('empty input', () => expect(parseDiscoveryQuery('   ', CATS).understood).toBe(false))
  it('only returns categories the tenant actually has', () => {
    expect(parseDiscoveryQuery('pharmacies near me', [{ name: 'Hospital' }]).category).toBeNull()
  })
  it('matches admin-created categories by their own name', () => {
    expect(parseDiscoveryQuery('find veterinary pharmacies in Ibadan', [{ name: 'Veterinary Pharmacy' }, { name: 'Pharmacy' }]).category).toBe('Veterinary Pharmacy')
  })
})

describe('matchCategory', () => {
  it('tolerates plurals, case and aliases', () => {
    expect(matchCategory('pharmacies', CATS).name).toBe('Pharmacy')
    expect(matchCategory('EYE CLINIC/OPTOMETRY', CATS).name).toBe('Eye Clinic/Optometry')
    expect(matchCategory('chemist', CATS).name).toBe('Pharmacy')
    expect(matchCategory('spaceship dealer', CATS)).toBeNull()
  })
})
