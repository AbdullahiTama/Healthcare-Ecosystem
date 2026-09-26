import { describe, it, expect } from 'vitest'
import { PLATFORM_PERMISSIONS, PLATFORM_NAV, normalizePlatformPermissions, navCatalogueFor, buildPlatformPermissions, hasPlatformPerm } from '../platformPermissions.js'

describe('platformPermissions', () => {
  const withPermissions = (enabled = []) => Object.fromEntries(
    PLATFORM_PERMISSIONS.map(permission => [permission, enabled.includes(permission)])
  )

  it('normalizes object perms', () => {
    expect(normalizePlatformPermissions({ Dashboard: true, Businesses: false })).toEqual(withPermissions(['Dashboard']))
  })
  it('normalizes array perms', () => {
    expect(normalizePlatformPermissions(['Dashboard','Payouts'])).toEqual(withPermissions(['Dashboard', 'Payouts']))
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
  it('defines a nav entry for every platform permission', () => {
    expect(PLATFORM_PERMISSIONS).toHaveLength(14)
    expect(PLATFORM_PERMISSIONS).toContain('Team-Agents')
    expect(PLATFORM_NAV).toHaveLength(PLATFORM_PERMISSIONS.length)
  })
})
