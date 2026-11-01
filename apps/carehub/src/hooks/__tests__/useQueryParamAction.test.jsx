import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useQueryParamAction } from '../useQueryParamAction'

// A link from the Owner's activity feed (?purchase=<id>) opens that record once,
// then the parameter is dropped so a refresh does not open it again.

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

function Probe({ action, ready = true }) {
  useQueryParamAction('purchase', action, ready)
  const loc = useLocation()
  return <div data-testid='loc'>{loc.pathname + loc.search}</div>
}
async function mount(ui) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(ui) })
}

describe('useQueryParamAction', () => {
  it('acts once on the named record and drops only its own parameter', async () => {
    const action = vi.fn()
    await mount(<MemoryRouter initialEntries={['/dashboard/purchases?purchase=p-1&view=x']}><Probe action={action} /></MemoryRouter>)
    expect(action).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledWith('p-1')
    expect(host.textContent).toBe('/dashboard/purchases?view=x')
  })

  it('waits until the page is ready', async () => {
    const action = vi.fn()
    await mount(<MemoryRouter initialEntries={['/d?purchase=p-1']}><Probe action={action} ready={false} /></MemoryRouter>)
    expect(action).not.toHaveBeenCalled()
    await act(async () => { root.render(<MemoryRouter initialEntries={['/d?purchase=p-1']}><Probe action={action} ready /></MemoryRouter>) })
    expect(action).toHaveBeenCalledWith('p-1')
  })

  it('does nothing without the parameter, or outside a router', async () => {
    const action = vi.fn()
    await mount(<MemoryRouter initialEntries={['/d']}><Probe action={action} /></MemoryRouter>)
    expect(action).not.toHaveBeenCalled()
    await act(async () => { root.unmount() }); host.remove()
    function Bare() { useQueryParamAction('purchase', action); return <span>ok</span> }
    await mount(<Bare />)
    expect(host.textContent).toBe('ok')
    expect(action).not.toHaveBeenCalled()
  })
})
