import { describe, it, expect } from 'vitest'
import { getAdrNavItems, ADR_NAV_ITEMS } from './AdrNav.js'

const ids = (items) => items.map((i) => i.id)

describe('getAdrNavItems', () => {
  it('shows every module item to the Owner', () => {
    expect(ids(getAdrNavItems('Owner', 'industry'))).toEqual(['adr-industry', 'pv-tracker'])
    expect(ids(getAdrNavItems('Owner', 'hospital'))).toEqual(['adr-hospital'])
  })

  it('resolves the signup taxonomy and enterprise business types through the repositories map', () => {
    expect(ids(getAdrNavItems('Owner', 'clinic'))).toEqual(['adr-hospital'])
    expect(ids(getAdrNavItems('Owner', 'laboratory'))).toEqual(['adr-hospital'])
    expect(ids(getAdrNavItems('Owner', 'aesthetic'))).toEqual(['adr-skincare'])
    expect(ids(getAdrNavItems('Owner', 'spa'))).toEqual(['adr-skincare'])
    expect(ids(getAdrNavItems('Owner', 'haircare'))).toEqual(['adr-skincare'])
    expect(ids(getAdrNavItems('Owner', 'cosmetics'))).toEqual(['adr-skincare'])
    // Repositories maps enterprise to industry; the nav must present the same
    // (before the single-map wiring this collapsed to community_pharmacy).
    expect(ids(getAdrNavItems('Owner', 'manufacturer_importer'))).toEqual(['adr-industry', 'pv-tracker'])
    expect(ids(getAdrNavItems('Owner', 'wholesale'))).toEqual(['adr-industry', 'pv-tracker'])
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
