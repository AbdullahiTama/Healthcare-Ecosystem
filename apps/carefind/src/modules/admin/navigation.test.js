import { describe, it, expect } from 'vitest'
import { NAV_GROUPS, ALL_TABS, visibleGroups, findItem } from './navigation'

// Every tab key the admin could open before the redesign. None may disappear.
const LEGACY_KEYS = [
  'overview', 'notifications', 'moderation', 'verifications', 'reports', 'posts', 'stories', 'news', 'golive',
  'shop', 'revenue', 'orders', 'withdrawals', 'reconciliation', 'businesses', 'users', 'claims',
  'audit_log', 'errors', 'teams', 'drugs', 'tasks', 'promotions', 'searches', 'email_templates',
]

const allKeys = NAV_GROUPS.flatMap(g => g.items.map(i => i.key))

describe('admin navigation', () => {
  it('keeps every legacy tab reachable exactly once', () => {
    for (const key of LEGACY_KEYS) expect(allKeys.filter(k => k === key)).toHaveLength(1)
  })

  it('has no duplicate keys', () => {
    expect(new Set(allKeys).size).toBe(allKeys.length)
  })

  it('uses the nine agreed groups in order', () => {
    expect(NAV_GROUPS.map(g => g.label)).toEqual([
      'Overview', 'Platform', 'Trust & Verification', 'Marketplace', 'Content', 'Finance', 'Operations', 'Analytics', 'System',
    ])
  })

  it('gives the moved feed tools their own item, gated by the overview permission', () => {
    expect(findItem('feed_ranking').permissionKey).toBe('overview')
  })

  it('exposes only role-assignable tabs (those without a permissionKey) to role editing', () => {
    expect(ALL_TABS.map(t => t.key)).not.toContain('feed_ranking')
    expect(ALL_TABS.map(t => t.key)).toEqual(expect.arrayContaining(LEGACY_KEYS))
  })

  it('hides items whose permission is explicitly false and drops empty groups', () => {
    const groups = visibleGroups({ users: false, businesses: false })
    expect(groups.some(g => g.label === 'Platform')).toBe(false)
    expect(visibleGroups({}).flatMap(g => g.items)).toHaveLength(allKeys.length)
  })

  it('applies a permissionKey instead of the item key', () => {
    const keys = visibleGroups({ overview: false }).flatMap(g => g.items.map(i => i.key))
    expect(keys).not.toContain('feed_ranking')
    expect(keys).not.toContain('overview')
  })

  it('treats a missing permissions object as everything visible', () => {
    expect(visibleGroups(undefined).flatMap(g => g.items)).toHaveLength(allKeys.length)
  })
})
