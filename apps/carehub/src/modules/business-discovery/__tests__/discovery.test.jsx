import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
const CATS = [{ id: 'c-ph', name: 'Pharmacy', business_id: null }, { id: 'c-hosp', name: 'Hospital', business_id: null }]
let boxRows = []
let listRows = []

vi.mock('../../business-directory/repositories', () => {
  const rec = (name) => async (...args) => { calls.push([name, ...args]); return null }
  const repo = {
    getCategories: async () => CATS,
    getSubcategories: async () => [],
    searchWithinBox: async (...a) => { calls.push(['searchWithinBox', ...a]); return boxRows },
    searchByPlaceName: async (...a) => { calls.push(['searchByPlaceName', ...a]); return [] },
    list: async (...a) => { calls.push(['list', ...a]); return listRows },
    reportIncorrect: rec('reportIncorrect'),
  }
  return { directoryRepository: repo, createDirectoryRepository: () => repo }
})
vi.mock('../../business-directory/services/geocoding', () => ({ geocodePlace: vi.fn(async () => null) }))

import BusinessDiscovery from '../BusinessDiscovery'
import FieldWorkSwitch from '../../field-work/FieldWorkSwitch'
import NearbyBusinessPicker from '../../business-directory/components/NearbyBusinessPicker'

const biz = (o) => ({ business_id: 'B1', is_active: true, verification_status: 'unverified', data_source: 'manual', latitude: 6.5, longitude: 3.4, ...o })

let host
let root
beforeEach(() => {
  calls.length = 0
  boxRows = []
  listRows = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  global.IS_REACT_ACT_ENVIRONMENT = true
  navigator.geolocation = { getCurrentPosition: (ok) => ok({ coords: { latitude: 6.5, longitude: 3.4, accuracy: 25 } }) }
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const type = async (input, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const mount = async (el) => { await act(async () => { root.render(<MemoryRouter>{el}</MemoryRouter>) }); await flush() }
const brand = { id: 'B1', name: 'Acme Pharma' }

describe('BusinessDiscovery', () => {
  it('turns “Find pharmacies around me” into a category + GPS radius search, and lists the nearest first', async () => {
    boxRows = [biz({ id: 'far', name: 'Far Pharmacy', name_normalized: 'far pharmacy', latitude: 6.53, longitude: 3.4, category_id: 'c-ph' }),
      biz({ id: 'near', name: 'Near Pharmacy', name_normalized: 'near pharmacy', latitude: 6.5003, longitude: 3.4, category_id: 'c-ph', verification_status: 'verified' })]
    await mount(<BusinessDiscovery brand={brand} perms={{}} allowedModules={['activity', 'discovery']} />)

    await type(host.querySelector('#disc-q'), 'Find pharmacies around me')
    await act(async () => { host.querySelector('form[role="search"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()

    const search = calls.find((c) => c[0] === 'searchWithinBox')
    expect(search).toBeTruthy()
    expect(search[1]).toBe('B1')
    expect(search[2]).toMatchObject({ lat: 6.5, lng: 3.4, radiusKm: 5 })
    expect(search[3]).toMatchObject({ categoryId: 'c-ph', active: 'active' })

    const items = [...host.querySelectorAll('li')].map((li) => li.textContent)
    expect(items[0]).toContain('Near Pharmacy')
    expect(items[0]).toContain('Verified')
    expect(items[1]).toContain('Far Pharmacy')
    expect(host.textContent).toContain('Understood:')
  })

  it('never writes: only reads are issued by a search', async () => {
    await mount(<BusinessDiscovery brand={brand} perms={{}} allowedModules={[]} />)
    await type(host.querySelector('#disc-q'), 'Find hospitals within 5 km')
    await act(async () => { host.querySelector('form[role="search"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    const names = new Set(calls.map((c) => c[0]))
    expect([...names].every((n) => ['searchWithinBox', 'searchByPlaceName', 'list'].includes(n))).toBe(true)
    // "within 5 km" with no place means "around me"
    expect(calls.find((c) => c[0] === 'searchWithinBox')[2]).toMatchObject({ lat: 6.5, lng: 3.4, radiusKm: 5 })
  })

  it('says nothing was found instead of inventing results', async () => {
    await mount(<BusinessDiscovery brand={brand} perms={{}} allowedModules={[]} />)
    await type(host.querySelector('#disc-q'), 'Find eye clinics near me')
    await act(async () => { host.querySelector('form[role="search"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(host.textContent).toContain('Nothing is invented')
    expect(host.querySelectorAll('li').length).toBe(0)
  })

  it('labels demo records DEMO DATA', async () => {
    boxRows = [biz({ id: 'd', name: 'Sample Pharmacy', name_normalized: 'sample pharmacy', data_source: 'demo', category_id: 'c-ph' })]
    await mount(<BusinessDiscovery brand={brand} perms={{}} allowedModules={[]} />)
    await type(host.querySelector('#disc-q'), 'pharmacies near me')
    await act(async () => { host.querySelector('form[role="search"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(host.querySelector('li').textContent).toContain('DEMO DATA')
  })

  it('explains itself when the text cannot be understood and does not search', async () => {
    await mount(<BusinessDiscovery brand={brand} perms={{}} allowedModules={[]} />)
    await type(host.querySelector('#disc-q'), 'what is the weather')
    await act(async () => { host.querySelector('form[role="search"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(calls.some((c) => c[0] === 'searchWithinBox' || c[0] === 'list')).toBe(false)
  })

  it('reports a denied location permission with a way forward', async () => {
    navigator.geolocation = { getCurrentPosition: (ok, err) => err({ code: 1 }) }
    await mount(<BusinessDiscovery brand={brand} perms={{}} allowedModules={[]} />)
    await type(host.querySelector('#disc-q'), 'pharmacies near me')
    await act(async () => { host.querySelector('form[role="search"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    await flush()
    expect(host.querySelector('[role="alert"]').textContent).toContain('permission')
  })
})

describe('FieldWorkSwitch', () => {
  it('presents the two options with their purpose, and marks the current one', async () => {
    await mount(<FieldWorkSwitch current='discovery' allowed={['activity', 'discovery']} />)
    const text = host.textContent
    expect(text).toContain('LIVE FIELD REPORT')
    expect(text).toContain('Report your current field activity to your manager.')
    expect(text).toContain('BUSINESS DISCOVERY')
    expect(text).toContain('Find businesses and healthcare facilities around you or another location.')
    expect(host.querySelector('[aria-current="page"]').textContent).toContain('BUSINESS DISCOVERY')
  })
  it('renders nothing when the role has only one of them', async () => {
    await mount(<FieldWorkSwitch current='activity' allowed={['activity']} />)
    expect(host.textContent).toBe('')
  })
})

describe('NearbyBusinessPicker (Live Field Report)', () => {
  const repoWith = (rows) => ({ searchWithinBox: async () => rows })

  it('suggests nearby businesses, selects NOTHING by itself, and never says “visited”', async () => {
    const onSelect = vi.fn()
    const rows = [biz({ id: 'n1', name: 'Near Pharmacy', address: '1 Road', latitude: 6.5002, longitude: 3.4 })]
    await mount(<NearbyBusinessPicker businessId='B1' gps={{ lat: 6.5, lng: 3.4, accuracy: 20 }} selected={null} onSelect={onSelect} repo={repoWith(rows)} />)
    expect(onSelect).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Possible nearby businesses')
    expect(host.textContent).toContain('Detected nearby')
    expect(host.textContent.toLowerCase()).not.toMatch(/visited|checked in/)
    await act(async () => { host.querySelector('li button').click() })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }))
  })

  it('shows the confirmed business as “Selected business” with a way to clear it', async () => {
    const onSelect = vi.fn()
    await mount(<NearbyBusinessPicker businessId='B1' gps={{ lat: 6.5, lng: 3.4 }} selected={{ id: 'n1', name: 'Near Pharmacy' }} onSelect={onSelect} repo={repoWith([])} />)
    expect(host.textContent).toContain('Selected business')
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Clear').click() })
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('renders nothing without GPS, with no candidates, or when the directory lookup fails', async () => {
    await mount(<NearbyBusinessPicker businessId='B1' gps={null} selected={null} onSelect={() => {}} repo={repoWith([])} />)
    expect(host.textContent).toBe('')
    await mount(<NearbyBusinessPicker businessId='B1' gps={{ lat: 6.5, lng: 3.4 }} selected={null} onSelect={() => {}} repo={repoWith([])} />)
    expect(host.textContent).toBe('')
    await mount(<NearbyBusinessPicker businessId='B1' gps={{ lat: 6.5, lng: 3.4 }} selected={null} onSelect={() => {}} repo={{ searchWithinBox: async () => { throw new Error('offline') } }} />)
    expect(host.textContent).toBe('')
  })
})
