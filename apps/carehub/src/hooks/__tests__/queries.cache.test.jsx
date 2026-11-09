// The two immediate cache updates: a held sale the till just saved, and a client just added (POS or Clients page).
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const clientRepo = vi.hoisted(() => ({ getAll: vi.fn(), create: vi.fn() }))
vi.mock('../../modules/clients/repositories', () => ({ clientRepository: clientRepo }))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn(), sbUpload: vi.fn() }))

import { keys, upsertOpenSale, useCreateClient } from '../queries'

describe('upsertOpenSale', () => {
  it('adds the held sale newest first, and replaces (never doubles) one with the same id', () => {
    const qc = new QueryClient()
    qc.setQueryData(keys.openSales('b'), [{ id: 'old', created_at: '2026-10-01T00:00:00' }])
    upsertOpenSale(qc, 'b', { id: 'n', created_at: '2026-10-02T00:00:00', total: 5 })
    upsertOpenSale(qc, 'b', { id: 'n', created_at: '2026-10-02T00:00:00', total: 7 })
    expect(qc.getQueryData(keys.openSales('b'))).toEqual([{ id: 'n', created_at: '2026-10-02T00:00:00', total: 7 }, { id: 'old', created_at: '2026-10-01T00:00:00' }])
  })
  it('works before the list has loaded, and ignores a sale without an id', () => {
    const qc = new QueryClient()
    upsertOpenSale(qc, 'b', { total: 1 })
    expect(qc.getQueryData(keys.openSales('b'))).toBeUndefined()
    upsertOpenSale(qc, 'b', { id: 'x' })
    expect(qc.getQueryData(keys.openSales('b'))).toEqual([{ id: 'x' }])
  })
})

describe('useCreateClient', () => {
  it('puts the new client into the shared client list at once (sorted by name), then re-reads it', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(keys.clients('b'), [{ id: '1', full_name: 'Ada' }, { id: '2', full_name: 'Musa' }])
    clientRepo.create.mockResolvedValue([{ id: '3', full_name: 'Bisi' }])
    clientRepo.getAll.mockReturnValue(new Promise(() => {})) // the re-read is still in flight
    let mutate
    function Probe() { mutate = useCreateClient('b').mutateAsync; return null }
    const host = document.createElement('div'); const root = createRoot(host)
    await act(async () => { root.render(<QueryClientProvider client={qc}><Probe /></QueryClientProvider>) })
    await act(async () => { await mutate({ full_name: 'Bisi' }) })
    expect(qc.getQueryData(keys.clients('b')).map((c) => c.full_name)).toEqual(['Ada', 'Bisi', 'Musa'])
    expect(qc.getQueryState(keys.clients('b')).isInvalidated).toBe(true)
    await act(async () => root.unmount())
  })
})
