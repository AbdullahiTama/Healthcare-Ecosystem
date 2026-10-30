import { describe, it, expect, vi, beforeEach } from 'vitest'
import { watchForResume, createRefreshCycle, RESUME_AFTER_MS } from '../resume.js'

// A document/window pair the test drives by hand: visibility, the network
// and the passage of time (including a device that slept through its timers).
function environment() {
  let clock = 1_000_000
  let tick = null
  const doc = new EventTarget()
  doc.visibilityState = 'visible'
  const win = new EventTarget()
  win.setInterval = (fn) => { tick = fn; return 1 }
  win.clearInterval = () => { tick = null }
  return {
    doc, win,
    now: () => clock,
    advance(ms) { clock += ms },
    tick() { tick && tick() },
    hasTimer: () => tick !== null,
    setVisibility(state) { doc.visibilityState = state; doc.dispatchEvent(new Event('visibilitychange')) },
    goOnline() { win.dispatchEvent(new Event('online')) },
  }
}

describe('watchForResume', () => {
  let env, onResume, stop
  beforeEach(() => {
    env = environment()
    onResume = vi.fn()
    stop = watchForResume(onResume, { doc: env.doc, win: env.win, now: env.now })
  })

  it('fires when the tab comes back after being hidden for a while', () => {
    env.setVisibility('hidden')
    env.advance(RESUME_AFTER_MS)
    env.setVisibility('visible')
    expect(onResume).toHaveBeenCalledWith('returned')
  })

  it('ignores a quick switch to another tab', () => {
    env.setVisibility('hidden')
    env.advance(RESUME_AFTER_MS - 1)
    env.setVisibility('visible')
    expect(onResume).not.toHaveBeenCalled()
  })

  it('notices a device that slept with the tab still visible', () => {
    env.advance(30_000)
    env.tick()
    expect(onResume).not.toHaveBeenCalled()
    env.advance(2 * 60 * 60 * 1000) // lid closed for two hours
    env.tick()
    expect(onResume).toHaveBeenCalledWith('woke')
  })

  it('does not mistake a throttled hidden tab for a sleeping device', () => {
    env.setVisibility('hidden')
    env.advance(RESUME_AFTER_MS * 2)
    env.tick()
    expect(onResume).not.toHaveBeenCalled()
  })

  it('fires when the connection comes back', () => {
    env.goOnline()
    expect(onResume).toHaveBeenCalledWith('reconnected')
  })

  it('stops watching when told to', () => {
    stop()
    env.goOnline()
    env.setVisibility('hidden')
    env.advance(RESUME_AFTER_MS)
    env.setVisibility('visible')
    expect(onResume).not.toHaveBeenCalled()
    expect(env.hasTimer()).toBe(false)
  })
})

describe('createRefreshCycle', () => {
  let clock, online, order, renewSession
  const now = () => clock
  function cycle(overrides = {}) {
    return createRefreshCycle({ renewSession, isOnline: () => online, now, ...overrides })
  }
  beforeEach(() => {
    clock = 1_000_000
    online = true
    order = []
    renewSession = vi.fn(async () => { order.push('session') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('renews the session before any screen refetches, then reports updated', async () => {
    const c = cycle()
    const statuses = []
    c.subscribe((s) => statuses.push(s.state))
    c.register(async () => { order.push('products') })
    c.register(async () => { order.push('sales') })
    await expect(c.refresh()).resolves.toBe(true)
    expect(order[0]).toBe('session')
    expect(order.slice(1).sort()).toEqual(['products', 'sales'])
    expect(statuses).toEqual(['updating', 'updated'])
    expect(c.getStatus()).toEqual({ state: 'updated', at: clock })
  })

  it('reports failure when a screen cannot refresh, and still lets the others finish', async () => {
    const c = cycle()
    const other = vi.fn(async () => {})
    c.register(async () => { throw new Error('Failed to fetch') })
    c.register(other)
    await expect(c.refresh()).resolves.toBe(false)
    expect(other).toHaveBeenCalled()
    expect(c.getStatus().state).toBe('failed')
  })

  it('reports failure without refetching when the session cannot be renewed', async () => {
    renewSession = vi.fn(async () => { throw Object.assign(new Error('Could not renew your session.'), { ended: false }) })
    const c = cycle()
    const screen = vi.fn(async () => {})
    c.register(screen)
    await c.refresh()
    expect(screen).not.toHaveBeenCalled()
    expect(c.getStatus().state).toBe('failed')
  })

  it('stays quiet when the session has ended (the app is already going to sign in)', async () => {
    renewSession = vi.fn(async () => { throw Object.assign(new Error('Your session has ended.'), { ended: true }) })
    const c = cycle()
    const screen = vi.fn(async () => {})
    c.register(screen)
    await c.refresh()
    expect(screen).not.toHaveBeenCalled()
    expect(c.getStatus().state).toBe('idle')
  })

  it('does nothing but note it while offline', async () => {
    online = false
    const c = cycle()
    await c.refresh()
    expect(renewSession).not.toHaveBeenCalled()
    expect(c.getStatus().state).toBe('offline')
  })

  it('runs once for signals that arrive together', async () => {
    const c = cycle()
    const screen = vi.fn(async () => {})
    c.register(screen)
    await Promise.all([c.refresh(), c.refresh()])
    clock += 5_000
    await c.refresh() // 'reconnected' shortly after a successful 'returned'
    expect(renewSession).toHaveBeenCalledTimes(1)
    expect(screen).toHaveBeenCalledTimes(1)
  })

  it('retries once when a signal arrives during a run that then fails', async () => {
    let attempt = 0
    const c = cycle()
    c.register(async () => { attempt++; if (attempt === 1) throw new Error('Failed to fetch') })
    const first = c.refresh()
    c.refresh() // Wi-Fi rejoined mid-run
    await expect(first).resolves.toBe(true)
    expect(attempt).toBe(2)
    expect(c.getStatus().state).toBe('updated')
  })

  it('lets Retry run straight after a success', async () => {
    const c = cycle()
    await c.refresh()
    await c.refresh({ force: true })
    expect(renewSession).toHaveBeenCalledTimes(2)
  })

  it('stops calling a screen once it unregisters', async () => {
    const c = cycle()
    const screen = vi.fn(async () => {})
    const unregister = c.register(screen)
    unregister()
    await c.refresh()
    expect(screen).not.toHaveBeenCalled()
  })

  it('settles back to idle after an update or a dismissed failure', async () => {
    const c = cycle()
    await c.refresh()
    c.settle()
    expect(c.getStatus().state).toBe('idle')
    c.register(async () => { throw new Error('x') })
    await c.refresh({ force: true })
    c.settle()
    expect(c.getStatus().state).toBe('idle')
  })
})
