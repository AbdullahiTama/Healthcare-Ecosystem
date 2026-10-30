import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { AuthRetryableFetchError, AuthApiError } from '@supabase/supabase-js'

vi.mock('../../lib/authClient', () => ({ authClient: { auth: { getSession: vi.fn() } } }))
vi.mock('./repositories', () => ({ saleRepository: {}, paymentRepository: {}, shiftRepository: {} }))

import { useAuthUserId } from './useSalesReportData'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
afterEach(async () => { await act(async () => { root?.unmount() }); host?.remove() })

// Renders the hook and returns a function reading its latest value.
async function render(getSession) {
  let value
  function Probe() { value = useAuthUserId({ getSession, retryMs: 5 }); return null }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<Probe />) })
  return () => value
}
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

describe('useAuthUserId', () => {
  it('gives the signed-in user id', async () => {
    const read = await render(async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }))
    await settle()
    expect(read()).toBe('u1')
  })

  // A laptop waking: the refresh hit the network before Wi-Fi rejoined. The session is fine, so the report keeps
  // loading instead of telling the cashier to sign out and in again, and picks the user up once it can.
  it('keeps resolving through a connection failure instead of reporting nobody signed in', async () => {
    const getSession = vi.fn()
      .mockResolvedValueOnce({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
      .mockResolvedValueOnce({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
      .mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    const read = await render(getSession)
    expect(read()).toBeUndefined()
    await settle(60)
    expect(read()).toBe('u1')
    expect(getSession).toHaveBeenCalledTimes(3)
  })

  it('reports nobody signed in when the session is really over', async () => {
    const read = await render(async () => ({ data: { session: null }, error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found') }))
    await settle()
    expect(read()).toBeNull()
  })

  it('reports nobody signed in when there is no session at all', async () => {
    const read = await render(async () => ({ data: { session: null }, error: null }))
    await settle()
    expect(read()).toBeNull()
  })

  it('stops asking once unmounted', async () => {
    const getSession = vi.fn(async () => ({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) }))
    await render(getSession)
    await settle(12)
    await act(async () => { root.unmount() })
    root = null
    const calls = getSession.mock.calls.length
    await new Promise((r) => setTimeout(r, 40))
    expect(getSession.mock.calls.length).toBe(calls)
  })
})
