import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import OutboxRunner from './OutboxRunner.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host
afterEach(() => { act(() => root.unmount()); host.remove() })

function mount(outbox) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<OutboxRunner outbox={outbox} />))
}

// The queue must keep sending while the person is on ANY dashboard page, not only on Live Activity: a rep
// who logs a report offline and then opens POS would otherwise never send it.
describe('OutboxRunner', () => {
  it('starts the queue when the dashboard mounts, renders nothing, and stops it when it unmounts', () => {
    const stop = vi.fn()
    const outbox = { start: vi.fn(() => stop) }
    mount(outbox)
    expect(outbox.start).toHaveBeenCalledTimes(1)
    expect(host.innerHTML).toBe('')
    act(() => root.unmount())
    expect(stop).toHaveBeenCalledTimes(1)
    root = createRoot(host) // so afterEach can unmount a live root
  })
})
