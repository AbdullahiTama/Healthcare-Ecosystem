import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let listRows = []

vi.mock('../repositories', () => {
  const repo = {
    getCategories: async () => [{ id: 'c-ph', name: 'Pharmacy', business_id: null }],
    getSubcategories: async () => [],
    list: async (...a) => { calls.push(['list', ...a]); return listRows },
    getBatches: async (...a) => { calls.push(['getBatches', ...a]); return [] },
    getDedupIndexRows: async () => [],
    searchWithinBox: async () => [],
    create: async (...a) => { calls.push(['create', ...a]); return { id: 'dir-new', name: a[1].name } },
  }
  return { directoryRepository: repo, createDirectoryRepository: () => repo, PLATFORM: 'platform' }
})
const suggestions = vi.hoisted(() => ({ pending: [], markAccepted: null }))
vi.mock('../suggestions/repository.js', () => ({
  SUGGESTION_TYPES: [['retail', 'Retail shop']],
  suggestionRepository: {
    listPending: async () => suggestions.pending,
    markAccepted: (...a) => { calls.push(['markAccepted', ...a]); return suggestions.markAccepted ? suggestions.markAccepted(...a) : Promise.resolve({}) },
    reject: async () => ({}),
  },
}))
vi.mock('../../territories/repositories', () => ({
  territoryRepository: { getAll: async (...a) => { calls.push(['territories', ...a]); return [] } },
}))

import BusinessDirectory from '../BusinessDirectory'

let host
let root
beforeEach(() => {
  calls.length = 0
  listRows = []
  suggestions.pending = []
  suggestions.markAccepted = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  global.IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const mount = async (el) => { await act(async () => { root.render(el) }); await flush(); await flush() }
const tabs = () => [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent)

describe('BusinessDirectory in platform mode (admin console, platform admin with no company)', () => {
  it('loads the platform registry and renders, instead of a blank page', async () => {
    await mount(<BusinessDirectory brand={null} perms={{ canManageDirectory: true }} platformMode />)
    expect(calls.some((c) => c[0] === 'list' && c[1] === 'platform')).toBe(true)
    expect(host.textContent).toContain('The platform directory is empty')
  })

  it('does not touch company-only data (territories, import batches) and offers Import', async () => {
    await mount(<BusinessDirectory brand={null} perms={{ canManageDirectory: true }} platformMode />)
    expect(calls.some((c) => c[0] === 'territories' || c[0] === 'getBatches')).toBe(false)
    expect(tabs()).toEqual(['Businesses', 'Import', 'Suggestions'])
  })

  it('lists platform rows when there are some', async () => {
    listRows = [{ id: 'p1', name: 'Allen Avenue Pharmacy', is_active: true, verification_status: 'verified', data_source: 'manual', business_id: null }]
    await mount(<BusinessDirectory brand={null} perms={{ canManageDirectory: true }} platformMode />)
    expect(host.textContent).toContain('Allen Avenue Pharmacy')
  })

  it('a company directory is unchanged: it loads the company scope and keeps Import, with no Suggestions', async () => {
    await mount(<BusinessDirectory brand={{ id: 'B1', name: 'Acme' }} perms={{ canManageDirectory: true }} />)
    expect(calls.some((c) => c[0] === 'list' && c[1] === 'B1')).toBe(true)
    expect(tabs()).toContain('Import')
    expect(tabs()).not.toContain('Suggestions')
  })

  const SUGGESTION = { id: 's1', name: 'Kemi Stores', business_type: 'retail', address: '2 Allen Ave', latitude: 6.6, longitude: 3.35, suggested_by_name: 'Ada', created_at: '2026-10-20T10:00:00Z', businesses: { name: 'Pharma Co' } }
  const openSuggestionForm = async () => {
    suggestions.pending = [SUGGESTION]
    await mount(<BusinessDirectory brand={null} perms={{ canManageDirectory: true }} platformMode />)
    await act(async () => { [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Suggestions').click() })
    await flush(); await flush()
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add to directory').click() })
    await flush()
    const name = document.body.querySelector('#bf-name')
    expect(name && name.value).toBe('Kemi Stores')
    // The admin still chooses the directory's own category and the state; a suggestion carries neither.
    for (const [id, pick] of [['#bf-category', 'c-ph'], ['#bf-state', null]]) {
      const el = document.body.querySelector(id)
      const value = pick || [...el.options].map((o) => o.value).find((v) => v)
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })) })
    }
    await act(async () => { [...document.body.querySelectorAll('button')].find((b) => /^(Save|Add business)/.test(b.textContent.trim())).click() })
    await flush(); await flush()
  }

  it('Add to directory opens the form pre-filled; saving creates the listing and marks the suggestion accepted', async () => {
    await openSuggestionForm()
    const created = calls.find((c) => c[0] === 'create')
    expect(created[1]).toBe('platform')
    expect(created[2]).toMatchObject({ name: 'Kemi Stores', address: '2 Allen Ave' })
    expect(calls.find((c) => c[0] === 'markAccepted')).toEqual(['markAccepted', 's1', 'dir-new'])
  })

  it('if marking fails after the listing was created, the suggestion stays with Mark as added', async () => {
    suggestions.markAccepted = () => Promise.reject(new Error('network'))
    await openSuggestionForm()
    expect(host.textContent).toContain('The listing was added but this suggestion is still open.')
    expect(calls.filter((c) => c[0] === 'create')).toHaveLength(1)
  })
})
