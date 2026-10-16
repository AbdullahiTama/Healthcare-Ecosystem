import { describe, it, expect } from 'vitest'
import { getAdrNavItems, ADR_NAV_ITEMS } from './AdrNav.js'

const ids = (items) => items.map((i) => i.id)

describe('getAdrNavItems', () => {
  it('shows every module item to the Owner', () => {
    expect(ids(getAdrNavItems('Owner', 'industry'))).toEqual(['adr-industry', 'pv-tracker'])
    expect(ids(getAdrNavItems('Owner', 'hospital'))).toEqual(['adr-hospital'])
  })

  it('shows the Tracker only to roles whose nav grants pv-tracker', () => {
    expect(ids(getAdrNavItems('Manager', 'industry'))).toContain('pv-tracker')
    // Nurse may file ADR reports but has no Tracker permission.
    expect(ids(getAdrNavItems('Nurse', 'industry'))).toEqual(['adr-industry'])
  })

  it('falls back to the community-pharmacy module for unknown business types', () => {
    expect(ids(getAdrNavItems('Owner', 'nope'))).toEqual(ids(ADR_NAV_ITEMS['community_pharmacy']))
  })

  it('uses safe default permissions for unknown roles', () => {
    const items = getAdrNavItems('Mystery Role', 'hospital')
    expect(ids(items)).toEqual(['adr-hospital'])
  })
})
