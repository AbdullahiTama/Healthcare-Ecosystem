import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import DirectoryBusinessLink, { NEARBY_RADIUS_M } from './DirectoryBusinessLink.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 20)) }) }
const text = () => host.textContent
const btn = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(label))
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const GPS = { lat: 6.6, lng: 3.35 }
const ROWS = [{ id: 'd1', name: 'Alpha Pharmacy', address: '12 Allen Ave', city: 'Ikeja', distance_m: 85 }, { id: 'd2', name: 'Beta Clinic', distance_m: 240 }]
const mount = async (props) => { await act(async () => { root.render(<DirectoryBusinessLink gps={GPS} value={null} onChange={() => {}} {...props} />) }); await settle() }

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('DirectoryBusinessLink', () => {
  it('suggests nearby directory businesses with honest wording and selects nothing by itself', async () => {
    const service = { search: vi.fn().mockResolvedValue({ rows: ROWS }) }
    const onChange = vi.fn()
    await mount({ service, onChange })
    expect(service.search).toHaveBeenCalledWith(expect.objectContaining({ lat: 6.6, lng: 3.35, radiusM: NEARBY_RADIUS_M, limit: 5, sort: 'distance' }))
    expect(text()).toContain('Possible nearby business (optional)')
    expect(text()).toContain('85 m straight-line')
    expect(text()).not.toMatch(/visited|at this business/i)
    expect(onChange).not.toHaveBeenCalled()
  })
  it('links only when the rep presses Select', async () => {
    const onChange = vi.fn()
    await mount({ service: { search: vi.fn().mockResolvedValue({ rows: ROWS }) }, onChange })
    await click(btn('Select'))
    expect(onChange).toHaveBeenCalledWith({ id: 'd1', name: 'Alpha Pharmacy' })
  })
  it('shows the selection and lets the rep remove it', async () => {
    const onChange = vi.fn()
    await mount({ service: { search: vi.fn().mockResolvedValue({ rows: ROWS }) }, value: { id: 'd1', name: 'Alpha Pharmacy' }, onChange })
    expect(text()).toContain('Selected business: Alpha Pharmacy')
    await click(btn('Remove'))
    expect(onChange).toHaveBeenCalledWith(null)
  })
  it('says so, and never blocks the report, when nothing is nearby', async () => {
    await mount({ service: { search: vi.fn().mockResolvedValue({ rows: [] }) } })
    expect(text()).toContain('You can still submit this report')
  })
  it('renders nothing when suggestions cannot load, or there is no position', async () => {
    await mount({ service: { search: vi.fn().mockRejectedValue(new Error('rpc missing')) } })
    expect(host.textContent).toBe('')
    const service = { search: vi.fn() }
    await mount({ service, gps: null })
    expect(service.search).not.toHaveBeenCalled()
    expect(host.textContent).toBe('')
  })
})
