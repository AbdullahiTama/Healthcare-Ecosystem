import { describe, it, expect } from 'vitest'
import { PLATFORM_PERMISSIONS, PLATFORM_NAV, normalizePlatformPermissions, navCatalogueFor, buildPlatformPermissions, hasPlatformPerm } from '../platformPermissions.js'

describe('platformPermissions', () => {
  it('normalizes object perms', () => {
    expect(normalizePlatformPermissions({ Dashboard: true, Businesses: false })).toEqual({ Dashboard: true, Businesses: false, 'Team-Agents': false, 'Team-Platform': false, Applications: false, Ledger: false, Payouts: false, Coverage: false })
  })
  it('normalizes array perms', () => {
    expect(normalizePlatformPermissions(['Dashboard','Payouts'])).toEqual({ Dashboard: true, Businesses: false, 'Team-Agents': false, 'Team-Platform': false, Applications: false, Ledger: false, Payouts: true, Coverage: false })
  })
  it('navCatalogueFor filters by perm', () => {
    const nav = navCatalogueFor({ Dashboard: true, Businesses: true })
    expect(nav.map(n=>n.id)).toEqual(['dashboard','businesses'])
  })
  it('buildPlatformPermissions round trips', () => {
    const perms = buildPlatformPermissions({ Dashboard: true, Ledger: true })
    expect(perms.Dashboard).toBe(true)
    expect(perms.Ledger).toBe(true)
    expect(perms.Businesses).toBe(false)
  })
  it('hasPlatformPerm checks', () => {
    expect(hasPlatformPerm({ Dashboard: true }, 'Dashboard')).toBe(true)
    expect(hasPlatformPerm({ Dashboard: true }, 'Businesses')).toBe(false)
  })
  it('defines 8 platform perms', () => {
    expect(PLATFORM_PERMISSIONS).toHaveLength(8)
    expect(PLATFORM_PERMISSIONS).toContain('Team-Agents')
    expect(PLATFORM_NAV).toHaveLength(8)
  })
})
