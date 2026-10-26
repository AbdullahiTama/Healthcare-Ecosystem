import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import ClientsLoadNote from './ClientsLoadNote.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function render(query) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => root.render(<ClientsLoadNote query={query} />))
}

describe('ClientsLoadNote', () => {
  it('renders nothing while the client list is fine', async () => {
    await render({ isError: false })
    expect(host.textContent).toBe('')
  })
  it('says the list failed, that a name can still be typed, and retries', async () => {
    const refetch = vi.fn()
    await render({ isError: true, refetch })
    expect(host.querySelector('[role="status"]').textContent).toContain("Saved clients couldn't be loaded")
    await act(async () => host.querySelector('button').click())
    expect(refetch).toHaveBeenCalled()
  })
})
