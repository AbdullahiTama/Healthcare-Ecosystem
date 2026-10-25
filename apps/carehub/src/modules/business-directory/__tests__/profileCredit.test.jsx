import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import BusinessProfile from '../components/BusinessProfile.jsx'

// A listing that came from OpenStreetMap credits it (ODbL); others do not.

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
afterEach(() => { act(() => root.unmount()); host.remove() })
async function show(business) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<BusinessProfile business={{ id: 'b1', name: 'Allen Pharmacy', is_active: true, verification_status: 'unverified', ...business }} onClose={() => {}} />) })
}

describe('BusinessProfile OpenStreetMap credit', () => {
  it('credits OpenStreetMap contributors with a link when the listing came from it', async () => {
    await show({ data_source: 'external', source_detail: 'OpenStreetMap node/1' })
    const link = [...document.body.querySelectorAll('a')].find((a) => a.getAttribute('href') === 'https://www.openstreetmap.org/copyright')
    expect(link).toBeTruthy()
    expect(document.body.textContent).toContain('OpenStreetMap contributors')
  })

  it('says nothing about OpenStreetMap for other listings', async () => {
    await show({ data_source: 'manual', source_detail: null })
    expect(document.body.textContent).not.toContain('OpenStreetMap')
  })
})
