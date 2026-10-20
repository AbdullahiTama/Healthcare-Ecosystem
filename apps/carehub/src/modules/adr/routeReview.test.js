import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { availableActions, validateReviewInput, selectionBasis, reviewActionLabel } from './routeReview'
import { ROLES } from '../../lib/permissions'

describe('routeReview helpers', () => {
  it('offers approve only for an eligible registered selection', () => {
    expect(availableActions({ selection_kind: 'verified', selected_business_eligible: true })).toEqual(['approve', 'redirect', 'hold'])
    expect(availableActions({ selection_kind: 'verified', selected_business_eligible: false })).toEqual(['redirect', 'hold'])
    expect(availableActions({ selection_kind: 'unverified_candidate' })).toEqual(['redirect', 'hold'])
    expect(availableActions({ selection_kind: 'unknown' })).toEqual(['redirect', 'hold'])
    expect(availableActions(null)).toEqual([])
  })

  it('requires a real reason and, for redirect, a company', () => {
    expect(validateReviewInput({ action: 'approve', reason: '  ' })).toMatch(/reason/)
    expect(validateReviewInput({ action: 'approve', reason: 'ok!' })).toBeNull()
    expect(validateReviewInput({ action: 'redirect', reason: 'matches', businessId: '' })).toMatch(/company/)
    expect(validateReviewInput({ action: 'redirect', reason: 'matches', businessId: 'b1' })).toBeNull()
    expect(validateReviewInput({ action: 'delete', reason: 'matches' })).toMatch(/action/)
  })

  it('never describes a registered pick as verified', () => {
    expect(selectionBasis({ selection_kind: 'verified' })).toMatch(/not independently verified/)
    expect(selectionBasis({ selection_kind: 'unverified_candidate' })).toMatch(/no registry match/)
    expect(selectionBasis({ selection_kind: 'unknown' })).toMatch(/did not know/)
    expect(reviewActionLabel('hold')).toMatch(/Hold/)
  })
})

// The migration decides who is notified with a SQL list of preset roles that
// cannot open the PV Tracker. permissions.js is the source of truth for the UI;
// if a preset gains or loses 'pv-tracker' this fails until the SQL list follows.
describe('company notification recipients follow the real permission model', () => {
  it('SQL preset list equals the preset roles without pv-tracker', () => {
    const sql = readFileSync(
      resolve(process.cwd(), '../../supabase/migrations/carehub_20261114_adr_route_review.sql'),
      'utf8'
    )
    const m = sql.match(/s\.role = ANY \(ARRAY\[([^\]]+)\]\)/)
    expect(m).toBeTruthy()
    const sqlRoles = m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).sort()
    const jsRoles = Object.entries(ROLES)
      .filter(([name, p]) => name !== 'Owner' && !p.nav.includes('pv-tracker'))
      .map(([name]) => name)
      .sort()
    expect(sqlRoles).toEqual(jsRoles)
  })
})
