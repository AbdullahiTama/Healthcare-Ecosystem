import { describe, it, expect } from 'vitest'
import { filterByScope, scopeTabs } from './feedScope'
import { canSeeAllActivity, getPerms, buildCustomPerms } from '../../lib/permissions'

const ME = 'staff-me'
const OTHER = 'staff-other'
const acts = [
  { id: 'a1', staff_id: ME },
  { id: 'a2', staff_id: OTHER },
  { id: 'a3', staff_id: OTHER },
  { id: 'a4', staff_id: null }, // written by the owner
]
const viewers = { a3: [{ staff_id: ME }] }
const ids = (list) => list.map((a) => a.id)

describe('canSeeAllActivity: mirrors caller_sees_all_activity()', () => {
  it('owner, manager roles and directory-management roles see all', () => {
    expect(canSeeAllActivity({ isOwner: true })).toBe(true)
    expect(canSeeAllActivity({ role: 'Manager', perms: getPerms('Manager') })).toBe(true)
    expect(canSeeAllActivity({ role: 'Regional Manager', perms: getPerms('Regional Manager') })).toBe(true)
    const custom = buildCustomPerms({ canManageDirectory: true })
    expect(canSeeAllActivity({ role: 'Field Coordinator', perms: custom })).toBe(true)
  })
  it('ordinary staff and a custom role without the grant do not', () => {
    expect(canSeeAllActivity({ role: 'Staff', perms: getPerms('Staff') })).toBe(false)
    expect(canSeeAllActivity({ role: 'Field Rep', perms: buildCustomPerms({ canViewReports: true }) })).toBe(false)
    expect(canSeeAllActivity({})).toBe(false)
  })
})

describe('filterByScope', () => {
  it('Team Reports for a see-all person includes untagged colleagues', () => {
    const r = filterByScope(acts, { scope: 'team', canSeeAll: true, meStaffId: ME, viewersByAct: viewers })
    expect(ids(r)).toEqual(['a1', 'a2', 'a3', 'a4'])
  })
  it('My Feed is only the person\'s own reports, for every role', () => {
    for (const canSeeAll of [true, false]) {
      expect(ids(filterByScope(acts, { scope: 'mine', canSeeAll, meStaffId: ME, viewersByAct: viewers }))).toEqual(['a1'])
    }
  })
  it('ordinary staff see only reports shared with them under the second tab, never untagged ones', () => {
    const r = filterByScope(acts, { scope: 'team', canSeeAll: false, meStaffId: ME, viewersByAct: viewers })
    expect(ids(r)).toEqual(['a3'])
  })
  it('owner (no staff id) owns only the null-author rows under My Feed and is not "tagged" anywhere', () => {
    expect(ids(filterByScope(acts, { scope: 'mine', canSeeAll: true, meStaffId: null }))).toEqual(['a4'])
    expect(ids(filterByScope(acts, { scope: 'team', canSeeAll: false, meStaffId: null, viewersByAct: { a3: [{ staff_id: null }] } }))).toEqual([])
  })
  it('being tagged does not change what a see-all person sees', () => {
    const none = filterByScope(acts, { scope: 'team', canSeeAll: true, meStaffId: ME, viewersByAct: {} })
    expect(ids(none)).toEqual(ids(acts))
  })
})

describe('scopeTabs', () => {
  it('labels the second tab by what it really shows', () => {
    expect(scopeTabs(true)[1][1]).toBe('Team Reports')
    expect(scopeTabs(false)[1][1]).toBe('Shared with me')
  })
})

import { scopeQuery, dateWindow, inWindow } from './feedScope'

describe('scopeQuery', () => {
  it('maps each tab to the narrowest server query', () => {
    expect(scopeQuery('mine', { canSeeAll: true, meStaffId: 's1' })).toEqual({ staffId: 's1' })
    expect(scopeQuery('mine', { canSeeAll: true, meStaffId: null })).toEqual({ ownerOnly: true })
    expect(scopeQuery('team', { canSeeAll: true, meStaffId: 's1' })).toEqual({})
    expect(scopeQuery('team', { canSeeAll: false, meStaffId: 's1' })).toEqual({ excludeStaffId: 's1' })
  })
})

describe('dateWindow', () => {
  const now = new Date(2026, 9, 21, 15, 30) // Wed 21 Oct 2026, local
  it('all time is open ended', () => {
    expect(dateWindow('all', '', '', now)).toEqual({ since: null, until: null })
  })
  it('this week starts Monday 00:00; last week ends the millisecond before it', () => {
    expect(dateWindow('week', '', '', now).since).toEqual(new Date(2026, 9, 19, 0, 0, 0, 0))
    const lw = dateWindow('lastweek', '', '', now)
    expect(lw.since).toEqual(new Date(2026, 9, 12))
    expect(inWindow(new Date(2026, 9, 18, 23, 59).toISOString(), lw)).toBe(true)
    expect(inWindow(new Date(2026, 9, 19, 0, 0).toISOString(), lw)).toBe(false)
  })
  it('custom is inclusive of the whole last day', () => {
    const w = dateWindow('custom', '2026-10-01', '2026-10-05', now)
    expect(inWindow(new Date(2026, 9, 5, 23, 59).toISOString(), w)).toBe(true)
    expect(inWindow(new Date(2026, 9, 6, 0, 1).toISOString(), w)).toBe(false)
  })
})
