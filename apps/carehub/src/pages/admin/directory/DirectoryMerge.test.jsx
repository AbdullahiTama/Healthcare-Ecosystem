import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({
  listCategories: vi.fn(),
  listImports: vi.fn(),
  findCandidates: vi.fn(),
  insertBatch: vi.fn(),
  insertOne: vi.fn(),
  mergeImportRow: vi.fn(),
  recordImport: vi.fn(),
}))
vi.mock('../../../modules/directory/repositories', () => ({ directoryRepository: repo }))

import DirectoryImport from './DirectoryImport'

let host, root
const settle = async (ms = 60) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }
const page = () => document.body.textContent
const btn = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.includes(label))
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const choose = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const EXISTING = {
  id: 'e1', name: 'Alpha Pharmacy', name_normalized: 'alpha pharmacy', phone_normalized: '8031234567',
  verification_status: 'unverified', is_active: true, data_source: 'manual', source_ref: null,
  address: '12 Allen Ave', city: null, state: 'Lagos', phone: '08031234567', email: null, latitude: null, longitude: null, category_id: null,
}
const CSV = 'name,category,address,city,state,phone,email\nAlpha Pharmacy Ltd,pharmacy,99 Other Street,Ikeja,Lagos,08031234567,info@alpha.test\n'

async function upload(csv = CSV) {
  const input = host.querySelector('input[type=file]')
  Object.defineProperty(input, 'files', { value: [new File([csv], 'import.csv')], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((r) => setTimeout(r, 80)) })
  await click(btn('Check file'))
  await settle()
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.listCategories.mockResolvedValue([{ id: 'c-ph', slug: 'pharmacy', name: 'Pharmacies', parent_id: null }])
  repo.listImports.mockResolvedValue([])
  repo.findCandidates.mockResolvedValue([EXISTING])
  repo.insertBatch.mockResolvedValue(undefined)
  repo.recordImport.mockResolvedValue({})
  repo.mergeImportRow.mockResolvedValue({ alreadyMerged: false, applied: { city: 'Ikeja', category_id: 'c-ph', email: 'info@alpha.test' }, skipped: [{ field: 'address', reason: 'existing_value_kept' }] })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

const mount = async () => { await act(async () => { root.render(<DirectoryImport />) }); await settle() }
const decision = () => document.body.querySelector('select[aria-label="Decision for row 2"]')

describe('import merge: reviewed, explicit, field by field', () => {
  it('offers Merge only for a row that matches an existing record, and never merges by default', async () => {
    await mount(); await upload()
    expect(page()).toContain('Possible duplicate')
    expect([...decision().options].map((o) => o.textContent)).toContain('Merge into existing...')
    expect(decision().value).toBe('skip')
    expect(btn('Import 0')).toBeTruthy()
    expect(btn('Import 0').disabled).toBe(true) // nothing will happen until the reviewer decides
    expect(repo.mergeImportRow).not.toHaveBeenCalled()
  })

  it('reviews fields, defaults to filling blanks only, then merges exactly what was confirmed', async () => {
    await mount(); await upload()
    await choose(decision(), 'merge')
    expect(page()).toContain('Merge row 2 into an existing business')
    expect(page()).toContain('never changes the name, the verification status or where the record came from')

    // Defaults: blanks (city, email, category) are ticked to fill; the differing address is NOT ticked to replace.
    const boxes = [...document.body.querySelectorAll('input[type=checkbox]')]
    const labelOf = (cb) => cb.closest('label').textContent
    expect(boxes.filter((b) => b.checked).map(labelOf).every((t) => /Fill the blank/.test(t))).toBe(true)
    const replace = boxes.find((b) => /Replace the existing value/.test(labelOf(b)))
    expect(replace.checked).toBe(false)
    expect(page()).toContain('This merge will: fill 3 blanks.')

    await click(btn('Use this merge'))
    expect(page()).toContain('Merge into Alpha Pharmacy: fill 3 blanks.')
    expect(repo.mergeImportRow).not.toHaveBeenCalled() // confirming a review does not run it

    await click(btn('Import 0 and merge 1'))
    await settle(120)
    expect(repo.insertBatch).not.toHaveBeenCalled() // the row was merged, not inserted as a second record
    expect(repo.mergeImportRow).toHaveBeenCalledTimes(1)
    const [target, ref, changes] = repo.mergeImportRow.mock.calls[0]
    expect(target).toBe('e1')
    expect(ref).toMatch(/:2$/)
    expect(changes).toEqual({
      category_id: { value: 'c-ph', mode: 'fill' },
      city: { value: 'Ikeja', mode: 'fill' },
      email: { value: 'info@alpha.test', mode: 'fill' },
    })
    expect(changes).not.toHaveProperty('address') // the differing address was kept
    expect(changes).not.toHaveProperty('name')

    expect(page()).toContain('1 merged')
    expect(page()).toContain('Row 2, address: existing value kept')
    const hist = repo.recordImport.mock.calls[0][0]
    expect(hist.result.merged).toBe(1)
  })

  it('replaces a differing value only after an explicit tick', async () => {
    await mount(); await upload()
    await choose(decision(), 'merge')
    const replace = [...document.body.querySelectorAll('input[type=checkbox]')].find((b) => /Replace the existing value/.test(b.closest('label').textContent))
    await act(async () => { replace.click() })
    expect(page()).toContain('fill 3 blanks, replace 1 value')
    await click(btn('Use this merge'))
    await click(btn('Import 0 and merge 1'))
    await settle(120)
    expect(repo.mergeImportRow.mock.calls[0][2].address).toEqual({ value: '99 Other Street', mode: 'overwrite' })
  })

  it('locks replacement on a verified record and still allows filling blanks', async () => {
    repo.findCandidates.mockResolvedValue([{ ...EXISTING, verification_status: 'verified' }])
    await mount(); await upload()
    await choose(decision(), 'merge')
    expect(page()).toContain('This record is verified, so its existing values are locked')
    expect(page()).toContain('Locked (verified). Existing value kept')
    expect([...document.body.querySelectorAll('label')].some((l) => /Replace the existing value/.test(l.textContent))).toBe(false)
    await click(btn('Use this merge'))
    await click(btn('Import 0 and merge 1'))
    await settle(120)
    expect(repo.mergeImportRow.mock.calls[0][2]).not.toHaveProperty('address')
  })

  it('cancelling the review merges nothing and leaves the row skipped', async () => {
    await mount(); await upload()
    await choose(decision(), 'merge')
    await click(btn('Cancel') && [...document.body.querySelectorAll('button')].filter((b) => b.textContent === 'Cancel').pop())
    expect(page()).not.toContain('Merge row 2 into')
    expect(decision().value).toBe('skip')
    expect(btn('Import 0').disabled).toBe(true)
    expect(repo.mergeImportRow).not.toHaveBeenCalled()
  })

  it('reports a refused merge instead of pretending it worked', async () => {
    repo.mergeImportRow.mockRejectedValue(new Error('Supabase error (403): Directory administrator access required'))
    await mount(); await upload()
    await choose(decision(), 'merge')
    await click(btn('Use this merge'))
    await click(btn('Import 0 and merge 1'))
    await settle(120)
    expect(page()).toContain('you are not permitted')
    expect(page()).not.toContain('1 merged')
  })

  it('cannot merge when no existing record could be loaded for comparison', async () => {
    repo.findCandidates.mockResolvedValue([]) // nothing found, so the row is simply new
    await mount(); await upload()
    expect([...decision().options].map((o) => o.textContent)).not.toContain('Merge into existing...')
  })
})
