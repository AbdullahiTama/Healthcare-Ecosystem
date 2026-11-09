// A USB / Bluetooth scanner in keyboard mode types the code (then Enter) into
// whichever field has focus. Clients has no barcode field: a scan into Phone
// Number looked like a real phone number, and its Enter pressed a focused Add
// Client. Now a scan is undone, explained, and presses nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./repositories', () => ({
  clientRepository: { getAll: vi.fn(), create: vi.fn(), createMany: vi.fn() },
  isDuplicateError: () => false,
}))
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(async () => []), sbFetchWithCount: vi.fn(async () => ({ data: [], count: 0 })), sbUpload: vi.fn() }))
vi.mock('../../lib/authClient', () => ({ authClient: { auth: { getSession: vi.fn() } } }))

import Clients from './Clients.jsx'
import { clientRepository } from './repositories'

const ADA = { id: 'c1', full_name: 'Ada Okafor', first_name: 'Ada', last_name: 'Okafor', phone: '08012345678', created_at: '2026-10-01', total_spend: 0 }
const UPC = '615110000123'

let root, host, queryClient, where
function Where() { where = useLocation().pathname; return null }
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const button = (t) => [...host.querySelectorAll('button')].filter((b) => b.textContent.trim() === t).pop()
const byLabel = (t) => {
  const label = [...host.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(t))
  return label && document.getElementById(label.htmlFor)
}
const setValue = (el, value) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const keydown = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
async function scan(el, code, suffix = 'Enter') {
  await act(async () => {
    for (const ch of code) {
      keydown(el, ch)
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') setValue(el, el.value + ch)
    }
    if (suffix) keydown(el, suffix)
  })
  await flush()
}
const countEnter = (el) => { const n = { v: 0 }; el.addEventListener('keydown', (e) => { if (e.key === 'Enter') n.v++ }); return n }

async function mount() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/dashboard/clients']}>
          <Routes><Route path='*' element={<><Where /><Clients brand={{ id: 'b1', business_type: 'pharmacy' }} role='Owner' /></>} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
  await flush()
}
async function openAdd() {
  await act(async () => { button('+ Add Client')?.click() || [...host.querySelectorAll('button')].find((b) => /Add Client/.test(b.textContent))?.click() })
  await flush()
  await act(async () => { setValue(byLabel('First Name'), 'Bisi'); setValue(byLabel('Surname'), 'Ade'); setValue(byLabel('Phone Number'), '08031112222') })
}

beforeEach(() => {
  vi.clearAllMocks()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clientRepository.getAll.mockResolvedValue([ADA])
  clientRepository.create.mockResolvedValue([{ id: 'new' }])
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Clients — a USB scan is never recorded', () => {
  it('a scan into Phone Number is undone, and its Enter does not add the client', async () => {
    await mount()
    await openAdd()
    const phone = byLabel('Phone Number')
    const enter = countEnter(phone)
    await scan(phone, UPC)
    expect(enter.v).toBe(0)
    expect(byLabel('Phone Number').value).toBe('08031112222')
    expect(clientRepository.create).not.toHaveBeenCalled()
    expect(text()).toContain('Scan ignored (' + UPC + '): Clients has no barcode field, so nothing was changed.')
  })

  it('the scanner\'s Enter on a focused Add Client does not save', async () => {
    await mount()
    await openAdd()
    const save = [...host.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Add Client')
    const enter = countEnter(save)
    await scan(save, UPC)
    expect(enter.v).toBe(0)
    expect(clientRepository.create).not.toHaveBeenCalled()
  })

  it('a scan into the search box is undone', async () => {
    await mount()
    const search = host.querySelector('input[aria-label="Search clients"]')
    await act(async () => { setValue(search, 'Ad') })
    await scan(search, UPC, 'Tab')
    expect(search.value).toBe('Ad')
    expect(text()).toContain('Ada Okafor')
  })

  it('in Client Details, the scanner\'s Enter on New consultation does not leave the page', async () => {
    await mount()
    // The list renders as cards here; clicking the name bubbles to the card's onClick.
    const name = [...host.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim() === 'Ada Okafor')
    await act(async () => { name.click() })
    await flush()
    const consult = [...host.querySelectorAll('[role="dialog"] button')].find((b) => b.title === 'Start a new consultation for this client')
    expect(consult).toBeTruthy()
    const enter = countEnter(consult)
    await scan(consult, UPC)
    expect(enter.v).toBe(0)
    expect(where).toBe('/dashboard/clients')
  })

  it('a scan without Enter is still undone once the keys stop', async () => {
    await mount()
    await openAdd()
    await scan(byLabel('Address'), UPC, null)
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    expect(byLabel('Address').value).toBe('')
  })

  it('the Notes text area is left alone', async () => {
    await mount()
    await openAdd()
    const notes = host.querySelector('[role="dialog"] textarea')
    await scan(notes, 'CARD000123')
    expect(notes.value).toBe('CARD000123')
    expect(text()).not.toContain('Scan ignored')
  })

  it('typing a phone number by hand is not a scan', async () => {
    await mount()
    await openAdd()
    const phone = byLabel('Phone Number')
    await act(async () => { setValue(phone, '') })
    for (const ch of '08099998888') {
      await act(async () => { keydown(phone, ch); setValue(phone, phone.value + ch) })
      await act(async () => { await new Promise((r) => setTimeout(r, 70)) })
    }
    expect(phone.value).toBe('08099998888')
    expect(text()).not.toContain('Scan ignored')
  })

  it('fields outside Clients are left alone', async () => {
    await mount()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    try {
      await scan(outside, UPC)
      expect(outside.value).toBe(UPC)
      expect(text()).not.toContain('Scan ignored')
    } finally {
      outside.remove()
    }
  })
})
