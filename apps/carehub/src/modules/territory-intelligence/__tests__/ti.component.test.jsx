import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let summary = []
let totals = { activities_total: 20, activities_linked: 16, businesses_visited: 9 }
let unvisitedRows = []
const CATS = [{ id: 'c1', business_id: null, name: 'Pharmacy' }]

vi.mock('../../business-directory/repositories', () => {
  const repo = {
    getCategories: async () => CATS,
    getSubcategories: async () => [],
    coverageSummary: async (...a) => { calls.push(['coverageSummary', ...a]); return summary },
    visitTotals: async () => totals,
    unvisited: async (...a) => { calls.push(['unvisited', ...a]); return unvisitedRows },
    repActivity: async () => [{ staff_id: 's1', rep_name: 'Ada', activities: 4, linked_activities: 2, businesses: 1 }],
    assignTerritoryToUnassigned: async (...a) => { calls.push(['assign', ...a]); return 3 },
  }
  return { directoryRepository: repo, createDirectoryRepository: () => repo }
})
vi.mock('../../territories/repositories', () => ({
  territoryRepository: {
    getAll: async () => [{ id: 't1', name: 'Lagos Mainland' }, { id: 't2', name: 'Ibadan' }],
    getAssignments: async () => [{ territory_id: 't1', staff: { full_name: 'Ada Rep' } }],
  },
}))

import TerritoryIntelligence from '../TerritoryIntelligence'

let host
let root
beforeEach(() => {
  calls.length = 0
  summary = [
    { group_key: 't1', group_label: 'Lagos Mainland', total: '10', visited: '9' },
    { group_key: 't2', group_label: 'Ibadan', total: '5', visited: '1' },
    { group_key: '', group_label: '', total: '4', visited: '0' },
  ]
  totals = { activities_total: 20, activities_linked: 16, businesses_visited: 9 }
  unvisitedRows = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  global.IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const mount = async (perms = {}) => { await act(async () => { root.render(<TerritoryIntelligence brand={{ id: 'B1', name: 'Acme' }} perms={perms} />) }); await flush(); await flush() }
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const tab = (name) => [...host.querySelectorAll('[role=tab]')].find((t) => t.textContent === name)

describe('TerritoryIntelligence', () => {
  it('shows headline numbers, weakest territory first, and the explanation of "covered"', async () => {
    await mount()
    const text = host.textContent
    expect(text).toContain('A business counts as covered only when a rep confirmed it')
    expect(text).toContain('Registered businesses19') // 10 + 5 + 4
    expect(text).toContain('Coverage53%') // 10 of 19
    const names = [...host.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent)
    expect(names).toEqual(['Ibadan', 'Lagos Mainland', 'No territory assigned'])
    expect(host.textContent).toContain('Ada Rep') // reps assigned to the territory
    expect(host.textContent).toContain('No rep assigned')
  })

  it('warns when few reports confirmed a business, because coverage is then understated', async () => {
    totals = { activities_total: 20, activities_linked: 4, businesses_visited: 3 }
    await mount()
    expect(host.querySelector('[role=alert]').textContent).toContain('Only 20% of field reports')
  })

  it('does not alarm when most reports confirm a business', async () => {
    await mount()
    expect(host.querySelector('[role=alert]')).toBeNull()
  })

  it('has a clear empty state for an empty directory', async () => {
    summary = []
    await mount()
    expect(host.textContent).toContain('No businesses in your directory match these filters')
  })

  it('lists businesses not visited, never-visited labelled, and states the ordering', async () => {
    unvisitedRows = [
      { id: 'u1', name: 'Never Pharmacy', category_id: 'c1', state: 'Lagos', last_visit_at: null, verification_status: 'unverified', total_count: '1' },
    ]
    await mount()
    await click(tab('Not visited'))
    expect(host.textContent).toContain('Never Pharmacy')
    expect(host.textContent).toContain('Never visited')
    expect(host.textContent).toContain('1 not covered')
  })

  it('hides the assign tab from people who cannot manage the directory', async () => {
    await mount({ canManageDirectory: false })
    expect(tab('Assign territories')).toBeUndefined()
  })

  it('bulk assign asks for confirmation, then assigns only unassigned businesses', async () => {
    await mount({ canManageDirectory: true })
    await click(tab('Assign territories'))
    expect(calls.find((c) => c[0] === 'coverageSummary' && c[3] === 'state')[4]).toMatchObject({ unassignedOnly: true })
    const sel = host.querySelector('#ti-aterr')
    await act(async () => { sel.value = 't1'; sel.dispatchEvent(new Event('change', { bubbles: true })) })
    const btn = [...host.querySelectorAll('button')].find((b) => /^Assign \d/.test(b.textContent))
    await click(btn)
    expect(calls.some((c) => c[0] === 'assign')).toBe(false) // not yet: needs confirmation
    const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Assign')
    await click(confirm)
    expect(calls.find((c) => c[0] === 'assign').slice(1, 3)).toEqual(['B1', 't1'])
  })

  it('is read-only apart from the explicit assign action', async () => {
    await mount()
    await click(tab('Representatives'))
    expect(new Set(calls.map((c) => c[0]))).toEqual(new Set(['coverageSummary']))
    expect(host.textContent).toContain('Ada')
  })
})
