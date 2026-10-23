import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import OutboxStrip, { STALE_AFTER_MS } from './OutboxStrip.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host, entries, listeners, outbox
const NOW = 2_000_000_000_000
const entry = (id, over = {}) => ({ id, state: 'pending', attempts: 0, lastError: null, createdAt: NOW - 1000, activity: { id }, ...over })
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim().includes(text))

async function show() {
  await act(async () => { root.render(<OutboxStrip outbox={outbox} now={() => NOW} />) })
  await flush()
}

beforeEach(() => {
  entries = []
  listeners = new Set()
  outbox = {
    list: vi.fn(async () => entries),
    subscribe: vi.fn((fn) => { listeners.add(fn); return () => listeners.delete(fn) }),
    retry: vi.fn(async () => {}), discard: vi.fn(async () => {}), flush: vi.fn(async () => ({})),
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('OutboxStrip', () => {
  it('shows nothing when no report is waiting', async () => {
    await show()
    expect(host.textContent).toBe('')
  })

  it('says how many reports are waiting, in a polite live region', async () => {
    entries = [entry('a'), entry('b')]
    await show()
    const region = host.querySelector('[role="status"]')
    expect(region.textContent).toMatch(/2 reports? waiting to send/i)
    expect(region.getAttribute('aria-live')).toBe('polite')
  })

  it('uses the singular for one report', async () => {
    entries = [entry('a')]
    await show()
    expect(host.textContent).toMatch(/1 report waiting to send/i)
  })

  it('a waiting report offers "Send now"; a parked one offers Retry and Discard with the reason', async () => {
    entries = [entry('a'), entry('b', { state: 'failed_permanent', lastError: 'Supabase error (403): denied' })]
    await show()
    expect(button('Send now')).toBeTruthy()
    expect(host.textContent).toMatch(/could not be sent/i)
    expect(host.textContent).toContain('Supabase error (403): denied')
    expect(button('Retry')).toBeTruthy()
    expect(button('Discard')).toBeTruthy()
    await act(async () => { button('Retry').click() })
    expect(outbox.retry).toHaveBeenCalledWith('b')
  })

  it('Discard asks the person to confirm in the page (no browser dialog) before removing a report', async () => {
    entries = [entry('b', { state: 'failed_permanent', lastError: 'denied' })]
    await show()
    await act(async () => { button('Discard').click() })
    expect(outbox.discard).not.toHaveBeenCalled()
    await act(async () => { button('Yes, discard it').click() })
    expect(outbox.discard).toHaveBeenCalledWith('b')
  })

  it('Send now flushes the queue', async () => {
    entries = [entry('a')]
    await show()
    await act(async () => { button('Send now').click() })
    expect(outbox.flush).toHaveBeenCalled()
  })

  it('warns, without deleting anything, when a report has waited more than 7 days', async () => {
    entries = [entry('old', { createdAt: NOW - STALE_AFTER_MS - 1 })]
    await show()
    expect(host.textContent).toMatch(/browsers? may delete/i)
    expect(STALE_AFTER_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('refreshes when the queue changes and stops listening when it goes away', async () => {
    await show()
    expect(host.textContent).toBe('')
    entries = [entry('a')]
    await act(async () => { listeners.forEach((fn) => fn()) })
    await flush()
    expect(host.textContent).toMatch(/1 report waiting/i)
    act(() => root.unmount())
    expect(listeners.size).toBe(0)
    root = createRoot(host)
  })

  it('shows nothing, and does not crash, when the list cannot be read', async () => {
    outbox.list.mockRejectedValue(new Error('no storage'))
    await show()
    expect(host.textContent).toBe('')
  })
})
