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
  }
  return { directoryRepository: repo, createDirectoryRepository: () => repo, PLATFORM: 'platform' }
})
vi.mock('../../territories/repositories', () => ({
  territoryRepository: { getAll: async (...a) => { calls.push(['territories', ...a]); return [] } },
}))

import BusinessDirectory from '../BusinessDirectory'

let host
let root
beforeEach(() => {
  calls.length = 0
  listRows = []
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
    expect(tabs()).toEqual(['Businesses', 'Import'])
  })

  it('lists platform rows when there are some', async () => {
    listRows = [{ id: 'p1', name: 'Allen Avenue Pharmacy', is_active: true, verification_status: 'verified', data_source: 'manual', business_id: null }]
    await mount(<BusinessDirectory brand={null} perms={{ canManageDirectory: true }} platformMode />)
    expect(host.textContent).toContain('Allen Avenue Pharmacy')
  })

  it('a company directory is unchanged: it loads the company scope and keeps Import', async () => {
    await mount(<BusinessDirectory brand={{ id: 'B1', name: 'Acme' }} perms={{ canManageDirectory: true }} />)
    expect(calls.some((c) => c[0] === 'list' && c[1] === 'B1')).toBe(true)
    expect(tabs()).toContain('Import')
  })
})
