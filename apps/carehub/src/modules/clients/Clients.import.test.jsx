import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Regression: choosing a CSV in "Upload CSV" rendered the import preview, which
// read two identifiers that were never defined (`warningBg` and `importing`).
// React threw during render and the whole CareHub app went blank. The preview
// and the Import button must render, and the button must disable while the
// create-many mutation is pending.

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The real query hooks run (so `createManyClients.isPending` is the real
// react-query flag); only the repository underneath them is replaced.
vi.mock('./repositories', () => ({
  clientRepository: {
    getAll: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
  },
  isDuplicateError: () => false,
}))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), sbUpload: vi.fn() }))
vi.mock('../../lib/authClient', () => ({ authClient: { auth: { getSession: vi.fn() } } }))

import Clients from './Clients.jsx'
import { clientRepository } from './repositories'

// Row 1 is valid, row 2 has no phone, row 3 repeats an existing client's number
// (written differently from the stored one: the dedupe key is digits only).
const CSV = [
  'First Name,Last Name,Phone,Email,Gender,Date of Birth,Address,Notes',
  'Ada,Okafor,08012345678,ada@email.com,Female,1990-05-12,12 Broad Street,VIP',
  'Musa,Bello,,,Male,,,',
  'Chi,Existing,0803-111-2222,,,,,',
].join('\n')

let root, host, queryClient

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const dialog = () => host.querySelector('[role="dialog"]')

const mount = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Clients brand={{ id: 'b1', business_type: 'pharmacy' }} role="Owner" />
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
  await flush() // let the clients query resolve
}

// Hands the dialog's file input a CSV and waits for the component's FileReader
// to deliver it (the preview appears once the parse state is set).
const chooseCsv = async (text) => {
  const input = dialog().querySelector('input[type="file"]')
  const file = new File([text], 'clients.csv', { type: 'text/csv' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  for (let i = 0; i < 20 && !dialog().textContent.includes('clients in file'); i++) await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  clientRepository.getAll.mockResolvedValue([
    { id: 'c1', full_name: 'Chi Existing', phone: '0803 111 2222', total_spend: 0, visit_count: 0 },
  ])
  clientRepository.createMany.mockReturnValue(new Promise(() => {})) // never settles: stays pending
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  queryClient.clear()
})

describe('Clients: CSV import preview', () => {
  it('renders the preview for a chosen CSV without throwing, flagging rows that will be skipped', async () => {
    await mount()
    await act(async () => { button('Upload CSV').click() })
    expect(dialog().textContent).toContain('Upload Clients from Excel / CSV')

    await chooseCsv(CSV)

    // A render-time ReferenceError would have unmounted the whole tree.
    expect(host.querySelector('[role="dialog"]')).toBeTruthy()
    const text = dialog().textContent
    expect(text).toContain('3 clients in file')
    expect(text).toContain('1 missing a phone (will be skipped)')
    expect(text).toContain('Ada Okafor')
    expect(text).toContain('08012345678 · Female')
    expect(text).toContain('No phone')
    expect(text).toContain('Already exists')
    expect(button('Import 3 Clients').disabled).toBe(false)
  })

  it('disables the Import button and shows "Importing…" while the create-many mutation is pending', async () => {
    await mount()
    await act(async () => { button('Upload CSV').click() })
    await chooseCsv(CSV)

    await act(async () => { button('Import 3 Clients').click() })
    await flush() // react-query publishes the pending state on a macrotask

    // Only the one new, valid client reaches the repository.
    expect(clientRepository.createMany).toHaveBeenCalledTimes(1)
    const [brandId, fresh] = clientRepository.createMany.mock.calls[0]
    expect(brandId).toBe('b1')
    expect(fresh.map((c) => c.full_name)).toEqual(['Ada Okafor'])

    const importing = button('Importing…')
    expect(importing).toBeTruthy()
    expect(importing.disabled).toBe(true)
    expect(button('Import 3 Clients')).toBeUndefined()
  })
})
