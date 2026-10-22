import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import NearbyBusinessPicker from '../components/NearbyBusinessPicker'

let host
let root
beforeEach(() => {
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
const mount = async (el) => { await act(async () => { root.render(el) }); await flush() }

const GPS = { lat: 6.5, lng: 3.4, accuracy: 20 }
const row = (o) => ({ id: 'n1', name: 'Near Pharmacy', address: '1 Road', business_type: 'pharmacy', verification_status: 'verified', distance_km: 0.02, ...o })
// The picker may only talk to the bounded nearby function; a repo with nothing else proves it.
const repoWith = (rows) => ({ nearbyBusinesses: vi.fn(async () => rows) })

describe('NearbyBusinessPicker (Live Field Report)', () => {
  it('suggests nearby businesses from the CareHub directory, selects NOTHING by itself, and never says “visited”', async () => {
    const onSelect = vi.fn()
    const repo = repoWith([row()])
    await mount(<NearbyBusinessPicker gps={GPS} selected={null} onSelect={onSelect} repo={repo} />)
    expect(onSelect).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Possible nearby businesses')
    expect(host.textContent).toContain('from the CareHub directory')
    expect(host.textContent).not.toMatch(/your company directory/i)
    expect(host.textContent).toContain('Detected nearby')
    expect(host.textContent.toLowerCase()).not.toMatch(/visited|checked in/)
    expect(repo.nearbyBusinesses).toHaveBeenCalledWith({ lat: 6.5, lng: 3.4, radiusKm: 0.2, limit: 5 })
    await act(async () => { host.querySelector('li button').click() })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }))
  })

  it('shows the confirmed business as “Selected business” with a way to clear it', async () => {
    const onSelect = vi.fn()
    await mount(<NearbyBusinessPicker gps={{ lat: 6.5, lng: 3.4 }} selected={{ id: 'n1', name: 'Near Pharmacy' }} onSelect={onSelect} repo={repoWith([])} />)
    expect(host.textContent).toContain('Selected business')
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Clear').click() })
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('renders nothing without GPS, and nothing when there is nothing nearby', async () => {
    const repo = repoWith([])
    await mount(<NearbyBusinessPicker gps={null} selected={null} onSelect={() => {}} repo={repo} />)
    expect(host.textContent).toBe('')
    expect(repo.nearbyBusinesses).not.toHaveBeenCalled()
    await mount(<NearbyBusinessPicker gps={{ lat: 6.5, lng: 3.4 }} selected={null} onSelect={() => {}} repo={repo} />)
    expect(host.textContent).toBe('')
  })

  it('says so when the lookup fails, instead of silently disappearing, and never blocks logging', async () => {
    const repo = { nearbyBusinesses: async () => { throw new Error('offline') } }
    await mount(<NearbyBusinessPicker gps={{ lat: 6.5, lng: 3.4 }} selected={null} onSelect={() => {}} repo={repo} />)
    const note = host.querySelector('[role="status"]')
    expect(note.textContent).toContain('could not be loaded')
    expect(note.textContent).toContain('You can still log this report')
    expect(host.querySelector('button')).toBeNull()
  })

  it('keeps showing a business the rep already confirmed even if a later lookup fails', async () => {
    const repo = { nearbyBusinesses: async () => { throw new Error('offline') } }
    await mount(<NearbyBusinessPicker gps={{ lat: 6.5, lng: 3.4 }} selected={{ id: 'n1', name: 'Near Pharmacy' }} onSelect={() => {}} repo={repo} />)
    expect(host.textContent).toContain('Near Pharmacy')
  })
})
