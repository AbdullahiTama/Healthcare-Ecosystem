import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import BuildUpdateWatcher from '../BuildUpdateWatcher.jsx'
import { fetchDeployedBuildId, isOutdated } from '../../../lib/buildVersion'

// A device left on an old build kept computing figures with a superseded rule
// (financial consistency audit, F1). The watcher spots a newer deployment and
// moves the device onto it at the next change of screen, never mid-screen.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host, go
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

function Nav() {
  go = useNavigate()
  return null
}

async function mount(props) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/dashboard/pos']}>
        <Nav />
        <BuildUpdateWatcher intervalMs={60_000} {...props} />
      </MemoryRouter>,
    )
  })
  await flush()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  sessionStorage.clear()
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

describe('BuildUpdateWatcher', () => {
  it('stays silent while the device runs the deployed build', async () => {
    const reload = vi.fn()
    await mount({ currentId: 'b1', fetchDeployed: async () => 'b1', reload })
    expect(host.textContent).toBe('')
    await act(async () => { go('/dashboard/pos/report') })
    expect(reload).not.toHaveBeenCalled()
  })

  it('offers a reload, and reloads at the next change of screen, not before', async () => {
    const reload = vi.fn()
    await mount({ currentId: 'b1', fetchDeployed: async () => 'b2', reload })
    expect(host.querySelector('[role="status"]').textContent).toContain('CareHub has been updated')
    expect(reload).not.toHaveBeenCalled()
    await act(async () => { go('/dashboard') })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('"Reload now" reloads straight away', async () => {
    const reload = vi.fn()
    await mount({ currentId: 'b1', fetchDeployed: async () => 'b2', reload })
    await act(async () => { host.querySelector('button').click() })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload in a loop, nor while offline', async () => {
    const reload = vi.fn()
    await mount({ currentId: 'b1', fetchDeployed: async () => 'b2', reload })
    await act(async () => { go('/dashboard') })
    await act(async () => { go('/dashboard/pos') })
    expect(reload).toHaveBeenCalledTimes(1)

    sessionStorage.clear()
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await act(async () => { go('/dashboard/reports') })
    expect(reload).toHaveBeenCalledTimes(1)
    online.mockRestore()
  })

  it('does nothing outside a production build (no build id)', async () => {
    const fetchDeployed = vi.fn(async () => 'b2')
    await mount({ currentId: null, fetchDeployed, reload: vi.fn() })
    expect(fetchDeployed).not.toHaveBeenCalled()
    expect(host.textContent).toBe('')
  })
})

describe('buildVersion', () => {
  it('reads the deployed id without the cache, and treats any failure as unknown', async () => {
    const ok = vi.fn(async () => ({ ok: true, json: async () => ({ buildId: 'abc' }) }))
    expect(await fetchDeployedBuildId(ok)).toBe('abc')
    expect(ok.mock.calls[0][1]).toEqual({ cache: 'no-store' })
    expect(await fetchDeployedBuildId(async () => ({ ok: false }))).toBeNull()
    expect(await fetchDeployedBuildId(async () => { throw new Error('offline') })).toBeNull()
    expect(await fetchDeployedBuildId(async () => ({ ok: true, json: async () => ({}) }))).toBeNull()
  })

  it('is outdated only when both ids are known and differ', () => {
    expect(isOutdated('b2', 'b1')).toBe(true)
    expect(isOutdated('b1', 'b1')).toBe(false)
    expect(isOutdated(null, 'b1')).toBe(false)
    expect(isOutdated('b2', null)).toBe(false)
  })
})
