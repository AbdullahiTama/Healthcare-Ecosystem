import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({
  listCategories: vi.fn(),
  search: vi.fn(),
  listImports: vi.fn(),
  findCandidates: vi.fn(),
  setVerification: vi.fn(),
  setActive: vi.fn(),
}))
vi.mock('../../../modules/directory/repositories', () => ({ directoryRepository: repo }))

import DirectoryPanel from './DirectoryPanel'
import { makeXlsx } from '../../../test/makeXlsx'

let host, root
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 450)) }) }
const text = () => host.textContent
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(label))

const ROW = { id: 'd1', name: 'Alpha Pharmacy', category_id: 'c1', city: 'Ikeja', state: 'Lagos', latitude: 6.6, longitude: 3.35, verification_status: 'unverified', data_source: 'manual', is_active: true }

beforeEach(() => {
  vi.clearAllMocks()
  repo.listCategories.mockResolvedValue([{ id: 'c1', slug: 'pharmacy', name: 'Pharmacies', parent_id: null }])
  repo.listImports.mockResolvedValue([])
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('DirectoryPanel', () => {
  it('lists businesses with their explicit verification status', async () => {
    repo.search.mockResolvedValue([ROW])
    await act(async () => { root.render(<DirectoryPanel />) })
    await flush()
    expect(text()).toContain('Alpha Pharmacy')
    expect(text()).toContain('Pharmacies · Ikeja · Lagos')
    expect(text()).toContain('unverified')
  })

  it('shows an empty state and an error state with retry', async () => {
    repo.search.mockResolvedValueOnce([])
    await act(async () => { root.render(<DirectoryPanel />) })
    await flush()
    expect(text()).toContain('No businesses found')

    repo.search.mockRejectedValueOnce(new Error('permission denied'))
    await act(async () => { root.unmount() }); root = createRoot(host)
    await act(async () => { root.render(<DirectoryPanel />) })
    await flush()
    expect(text()).toContain('permission denied')
  })

  it('paginates server-side: asks for one extra row and offers Next only when it exists', async () => {
    repo.search.mockResolvedValue(Array.from({ length: 26 }, (_, i) => ({ ...ROW, id: 'd' + i, name: 'B' + i })))
    await act(async () => { root.render(<DirectoryPanel />) })
    await flush()
    expect(repo.search.mock.calls[0][0]).toMatchObject({ limit: 26, offset: 0 })
    expect(text()).not.toContain('B25')
    expect(button('Next').disabled).toBe(false)
  })

  it('import wizard rejects a non-CSV file before reading it', async () => {
    repo.search.mockResolvedValue([])
    await act(async () => { root.render(<DirectoryPanel />) })
    await flush()
    await click([...host.querySelectorAll('[role=tab]')].find((t) => t.textContent.includes('Import')))
    const input = host.querySelector('input[type=file]')
    const file = new File(['x'], 'sheet.xls')
    Object.defineProperty(input, 'files', { value: [file] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(text()).toContain('Choose an .xlsx or .csv file')
    expect(repo.findCandidates).not.toHaveBeenCalled()
  })

  it('import wizard reads an Excel workbook and reaches column mapping, naming the sheet used', async () => {
    repo.search.mockResolvedValue([])
    await act(async () => { root.render(<DirectoryPanel />) })
    await flush()
    await click([...host.querySelectorAll('[role=tab]')].find((t) => t.textContent.includes('Import')))
    const input = host.querySelector('input[type=file]')
    const bytes = makeXlsx([{ name: 'Lagos pharmacies', rows: { 1: ['Business Name', 'State'], 2: ['Alpha Pharmacy', 'Lagos'], 3: ['Beta Pharmacy', 'Lagos'] } }])
    const file = new File([bytes], 'directory.xlsx')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 400)) })
    expect(text()).toContain('Sheet "Lagos pharmacies"')
    expect(text()).toContain('2 data rows')
    expect(button('Check file')).toBeTruthy()
    expect(repo.findCandidates).not.toHaveBeenCalled() // nothing is looked up or saved until the admin continues
  })

  it('import wizard explains an unreadable workbook instead of failing silently', async () => {
    repo.search.mockResolvedValue([])
    await act(async () => { root.render(<DirectoryPanel />) })
    await flush()
    await click([...host.querySelectorAll('[role=tab]')].find((t) => t.textContent.includes('Import')))
    const input = host.querySelector('input[type=file]')
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4])], 'old.xlsx')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 300)) })
    expect(text()).toMatch(/old \.xls|password-protected/)
  })
})
