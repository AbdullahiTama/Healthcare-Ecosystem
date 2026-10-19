import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { createCheckinRepository } from './repositories/index.js'
import { describeStaffRow, formatAge } from './checkinView.js'
import CheckInPanel from './CheckInPanel.jsx'
import TeamLocations from './TeamLocations.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function recording(returns = []) {
  const calls = []
  const repo = createCheckinRepository(async (path, o) => { calls.push({ path, body: o && o.body ? JSON.parse(o.body) : null }); return returns })
  return { calls, repo }
}

describe('checkin repository', () => {
  it('sends a captured position with its source and accuracy, never a user or staff id', async () => {
    const { repo, calls } = recording({ id: 'c1', status: 'captured' })
    await repo.record('biz1', 'workday_checkin', { ok: true, lat: 6.5, lng: 3.4, accuracyM: 24.6, capturedAt: '2026-10-19T10:00:00Z' })
    expect(calls[0].path).toBe('rpc/record_checkin')
    expect(calls[0].body).toEqual({ p_business_id: 'biz1', p_event_type: 'workday_checkin', p_lat: 6.5, p_lng: 3.4, p_accuracy_m: 25, p_source: 'browser_geolocation', p_client_captured_at: '2026-10-19T10:00:00Z' })
  })
  it('records a failed capture as failed, with a reason and NO coordinates', async () => {
    const { repo, calls } = recording({})
    await repo.record('biz1', 'workday_checkin', { ok: false, reason: 'denied' })
    expect(calls[0].body).toEqual({ p_business_id: 'biz1', p_event_type: 'workday_checkin', p_failure_reason: 'denied' })
    await repo.record('biz1', 'workday_checkin', { ok: false, reason: 'weird' })
    expect(calls[1].body.p_failure_reason).toBe('unavailable')
  })
  it('refuses to send without a business and clamps the history size', async () => {
    const { repo, calls } = recording([])
    await expect(repo.record('', 'workday_checkin', { ok: false })).rejects.toThrow()
    await repo.mine(9999)
    expect(calls[0].path).toContain('limit=50')
  })
})

describe('describeStaffRow', () => {
  it('current: says when they checked in, not where they are', () => {
    const d = describeStaffRow({ freshness: 'current', age_minutes: 12, last_checkin: { event_type: 'workday_checkin', accuracy_m: 30 } })
    expect(d).toMatchObject({ tone: 'current', headline: 'Checked in 12 min ago' })
  })
  it('stale: labelled as an old position, never as current', () => {
    const d = describeStaffRow({ freshness: 'stale', age_minutes: 300, last_checkin: { event_type: 'workday_checkin' } })
    expect(d.tone).toBe('stale')
    expect(d.headline).toBe('Last known position, 5 hours ago')
    expect(d.detail).toMatch(/may not reflect where they are now/)
  })
  it('unavailable: no position, and a failed attempt is explained', () => {
    expect(describeStaffRow({ freshness: 'unavailable', last_checkin: null, last_failed_attempt: { reason: 'denied' } })).toMatchObject({ tone: 'none', headline: 'No location on record', detail: expect.stringContaining('permission was denied') })
    expect(describeStaffRow({ freshness: 'unavailable', last_checkin: null, last_failed_attempt: null }).detail).toBe('They have not checked in.')
  })
  it('a newer failure is shown next to an older success', () => {
    expect(describeStaffRow({ freshness: 'stale', age_minutes: 200, last_checkin: { event_type: 'workday_checkin' }, last_failed_attempt: { reason: 'timeout' } }).detail).toMatch(/newer attempt failed/)
  })
  it('formats ages', () => {
    expect([0, 1, 59, 60, 125, 3000].map(formatAge)).toEqual(['just now', '1 min ago', '59 min ago', '1 hour ago', '2 hours ago', '2 days ago'])
    expect(formatAge(null)).toBe('')
  })
})

let host, root
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 30)) }) }
const text = () => host.textContent
const btn = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(label))
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const geo = (impl) => Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: impl }, configurable: true })

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('CheckInPanel', () => {
  const fakeRepo = (over = {}) => ({ mine: vi.fn().mockResolvedValue([]), record: vi.fn().mockResolvedValue({ status: 'captured' }), ...over })
  const mount = async (repo) => { await act(async () => { root.render(<CheckInPanel businessId="biz1" repo={repo} />) }); await settle() }

  it('does not ask for location until a button is pressed', async () => {
    const asked = vi.fn(); geo(asked)
    await mount(fakeRepo())
    expect(asked).not.toHaveBeenCalled()
    expect(text()).toContain('You have not checked in yet')
  })
  it('captures once and records the position on success', async () => {
    geo((ok) => ok({ coords: { latitude: 6.5, longitude: 3.4, accuracy: 20 } }))
    const repo = fakeRepo()
    await mount(repo)
    await click(btn('Check in')); await settle()
    expect(repo.record).toHaveBeenCalledWith('biz1', 'workday_checkin', expect.objectContaining({ ok: true, lat: 6.5, lng: 3.4 }))
    expect(text()).toContain('Your position was shared once')
  })
  it('permission denied: the attempt is recorded as FAILED and the screen says nothing was saved', async () => {
    geo((_, bad) => bad({ code: 1 }))
    const repo = fakeRepo({ record: vi.fn().mockResolvedValue({ status: 'failed' }) })
    await mount(repo)
    await click(btn('Check in')); await settle()
    expect(repo.record).toHaveBeenCalledWith('biz1', 'workday_checkin', expect.objectContaining({ ok: false, reason: 'denied' }))
    expect(text()).toContain('No position was saved')
    expect(text()).toContain('recorded as failed')
    expect(text()).not.toContain('shared once')
  })
  it('a server refusal is shown as an error, not as success', async () => {
    geo((ok) => ok({ coords: { latitude: 6.5, longitude: 3.4, accuracy: 20 } }))
    await mount(fakeRepo({ record: vi.fn().mockRejectedValue(new Error('You are not an active member of this business')) }))
    await click(btn('Check in')); await settle()
    expect(text()).toContain('not an active member')
    expect(text()).not.toContain('shared once')
  })
  it('shows an error state when history cannot load', async () => {
    await mount(fakeRepo({ mine: vi.fn().mockRejectedValue(new Error('offline')) }))
    expect(text()).toContain('offline')
  })
})

describe('TeamLocations', () => {
  const ROWS = [
    { staff_id: 's1', name: 'Rep One', role: 'Sales Rep', freshness: 'current', age_minutes: 5, last_checkin: { event_type: 'workday_checkin', latitude: 6.5, longitude: 3.4, accuracy_m: 20 }, last_failed_attempt: null, last_activity_at: null },
    { staff_id: 's2', name: 'Rep Two', role: 'Sales Rep', freshness: 'stale', age_minutes: 400, last_checkin: { event_type: 'workday_checkin', latitude: 6.6, longitude: 3.3, accuracy_m: 40 }, last_failed_attempt: null, last_activity_at: '2026-10-19T09:00:00Z' },
    { staff_id: 's3', name: 'Rep Three', role: 'Sales Rep', freshness: 'unavailable', age_minutes: null, last_checkin: null, last_failed_attempt: { reason: 'denied' }, last_activity_at: null },
  ]
  const mount = async (repo) => { await act(async () => { root.render(<TeamLocations businessId="biz1" repo={repo} />) }); await settle() }

  it('loads nothing (so logs nothing) until a manager opens it', async () => {
    const repo = { overview: vi.fn().mockResolvedValue({ rows: ROWS }) }
    await mount(repo)
    expect(repo.overview).not.toHaveBeenCalled()
    await click(btn('Show')); await settle()
    expect(repo.overview).toHaveBeenCalledTimes(1)
  })
  it('separates current, stale and unavailable and never links a missing position', async () => {
    await mount({ overview: vi.fn().mockResolvedValue({ rows: ROWS }) })
    await click(btn('Show')); await settle()
    expect(text()).toContain('Current'); expect(text()).toContain('Stale'); expect(text()).toContain('Unavailable')
    expect(text()).toContain('Last known position, 6 hours ago')
    expect(text()).toContain('permission was denied')
    const links = [...host.querySelectorAll('a')].map((a) => a.textContent)
    expect(links).toEqual(['View on map', 'View last known position'])
  })
  it('shows a clear message when the caller is not a manager', async () => {
    await mount({ overview: vi.fn().mockRejectedValue(new Error('Supabase error (403): Manager access required')) })
    await click(btn('Show')); await settle()
    expect(text()).toContain('Only managers can see team check-ins')
  })
})
