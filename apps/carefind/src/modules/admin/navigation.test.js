import { describe, it, expect } from 'vitest'
import {
  SCREENS, GROUPS, PERMISSION_ITEMS, LEGACY_REDIRECTS,
  pathFor, screenByKey, screenForPath, canAccess, visibleGroups, firstAccessiblePath, isAdminPath,
} from './navigation'

const superAdmin = { adminUser: { role: 'super_admin' }, permissions: {} }
const moderator = { adminUser: { role: 'moderator' }, permissions: { users: false, reports: true } }

describe('navigation registry', () => {
  it('keeps every permission key the old sidebar had', () => {
    const old = ['overview', 'moderation', 'verifications', 'reports', 'posts', 'stories', 'news', 'golive',
      'shop', 'revenue', 'orders', 'withdrawals', 'businesses', 'users', 'claims', 'audit_log', 'errors',
      'teams', 'drugs', 'tasks', 'promotions', 'searches', 'email_templates']
    const keys = SCREENS.map(s => s.permission)
    old.forEach(k => expect(keys).toContain(k))
  })

  it('has unique keys and paths, and every screen belongs to a known group', () => {
    expect(new Set(SCREENS.map(s => s.key)).size).toBe(SCREENS.length)
    expect(new Set(SCREENS.map(s => s.path)).size).toBe(SCREENS.length)
    const groupIds = GROUPS.map(g => g.id)
    SCREENS.forEach(s => expect(groupIds).toContain(s.group))
  })

  it('builds absolute paths', () => {
    expect(pathFor('overview')).toBe('/admin')
    expect(pathFor('verifications')).toBe('/admin/moderation/verifications')
    expect(pathFor('notifications')).toBe('/admin/alerts')
    expect(pathFor('does-not-exist')).toBe('/admin')
  })

  it('finds a screen by key and by pathname', () => {
    expect(screenByKey('reports').path).toBe('moderation/reports')
    expect(screenForPath('/admin').key).toBe('overview')
    expect(screenForPath('/admin/').key).toBe('overview')
    expect(screenForPath('/admin/moderation/reports').key).toBe('reports')
    expect(screenForPath('/admin/nope')).toBeUndefined()
  })

  it('allows existing keys unless explicitly false', () => {
    expect(canAccess(screenByKey('reports'), moderator)).toBe(true)
    expect(canAccess(screenByKey('posts'), moderator)).toBe(true)
    expect(canAccess(screenByKey('users'), moderator)).toBe(false)
  })

  it('denies new keys to restricted roles unless explicitly granted', () => {
    const transfers = screenByKey('agent_transfers')
    expect(transfers.explicit).toBe(true)
    expect(canAccess(transfers, moderator)).toBe(false)
    expect(canAccess(transfers, { adminUser: { role: 'moderator' }, permissions: { agent_transfers: true } })).toBe(true)
    expect(canAccess(transfers, superAdmin)).toBe(true)
  })

  it('treats a missing screen or missing admin as no access', () => {
    expect(canAccess(undefined, superAdmin)).toBe(false)
    expect(canAccess(screenByKey('agent_transfers'), { adminUser: null, permissions: {} })).toBe(false)
  })

  it('hides groups with no permitted screens', () => {
    const ctx = { adminUser: { role: 'moderator' }, permissions: { withdrawals: false } }
    const ids = visibleGroups(ctx).map(g => g.id)
    expect(ids).not.toContain('finance')
    expect(ids).not.toContain('agents')
    expect(ids).toContain('moderation')
  })

  it('returns the first permitted path, or null when there is none', () => {
    expect(firstAccessiblePath(superAdmin)).toBe('/admin')
    expect(firstAccessiblePath({ adminUser: { role: 'moderator' }, permissions: { overview: false } }))
      .toBe('/admin/moderation/queue')
    const none = Object.fromEntries(SCREENS.map(s => [s.permission, false]))
    expect(firstAccessiblePath({ adminUser: { role: 'moderator' }, permissions: none })).toBeNull()
  })

  it('lists each permission key once for the role editor', () => {
    const keys = PERMISSION_ITEMS.map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('notifications')
    expect(keys).toContain('businesses')
    expect(keys).not.toContain('businesses_hub')
  })

  it('recognises admin paths, including the legacy ones', () => {
    ;['/admin', '/admin/', '/admin/moderation/queue', '/admin-panel', '/business-directory',
      '/agents/approval', '/agents/earnings', '/agents/transfer'].forEach(p => expect(isAdminPath(p)).toBe(true))
    ;['/', '/feed', '/administrator', '/agents/register', '/agent-login', '/business-discovery', '/login']
      .forEach(p => expect(isAdminPath(p)).toBe(false))
  })

  it('redirects every legacy address to a registered screen path', () => {
    const paths = SCREENS.map(s => pathFor(s.key))
    LEGACY_REDIRECTS.forEach(r => expect(paths).toContain(r.to))
  })
})
