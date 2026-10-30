// The admin Product Library: review queue, approve and retire, add, suggestions, and importing an official list.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import ProductLibrary from '../../../pages/admin/trust/ProductLibrary.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const AMOX = { id: 'c1', brand_name: 'Amoxil 500 mg', generic_name: 'Amoxicillin', rx_status: 'prescription_only', category_code: 'antibiotics', status: 'pending', source: 'seeded', business_count: 4, linked: 0, barcodes: ['5012345'] }
const PANADOL = { id: 'c2', brand_name: 'Panadol Extra', rx_status: 'otc', status: 'pending', source: 'seeded', business_count: 3, linked: 2, barcodes: [] }
const SUGGESTION = { id: 's1', brand_name: 'Allen House Tea', rx_status: 'otc', business_name: 'Allen Pharmacy', suggested_by_email: 'owner@allen.com', note: 'Our blend', created_at: '2026-10-28T10:00:00Z', existing: null }
const DUP = { id: 's2', brand_name: 'Panadol Extra', business_name: 'Bello Chemist', created_at: '2026-10-28T11:00:00Z', existing: { id: 'c2', brand_name: 'Panadol Extra', status: 'active' } }

let host, root, repo
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const btn = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const setValue = async (el, v) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
async function show() {
  await act(async () => { root.render(<ProductLibrary repository={repo} categoriesRepository={{ getCategories: async () => [{ code: 'antibiotics', label: 'Antibiotics' }] }} />) })
  await flush(); await flush()
}

beforeEach(() => {
  repo = {
    adminPage: vi.fn(async ({ status }) => (status === 'pending' ? { items: [AMOX, PANADOL], total: 2, available: true } : { items: [], total: 0, available: true })),
    review: vi.fn(async (ids) => ids.length), save: vi.fn(async (_id, f) => ({ ...f, id: 'c9' })), merge: vi.fn(async () => 1),
    seed: vi.fn(async () => 5), suggestions: vi.fn(async () => ({ suggestions: [SUGGESTION, DUP], total: 2, available: true })),
    decide: vi.fn(async () => 'c9'), importRows: vi.fn(async (rows) => ({ inserted: rows.length - 1, updated: 1, skipped: 0, errors: [] })),
    search: vi.fn(async () => [{ id: 'c2', brand_name: 'Panadol Extra', rx_status: 'otc' }]),
  }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('review queue', () => {
  it('lists candidates, most used first, with counts on the tabs', async () => {
    await show()
    expect(text()).toContain('Review queue (2)')
    expect(text()).toContain('Suggestions (2)')
    expect(text()).toContain('Amoxil 500 mg')
    expect(text()).toContain('Used by 4 businesses')
    expect(text()).toContain('Prescription only')
    expect(repo.adminPage).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', offset: 0 }))
  })

  it('approves a selection in one go', async () => {
    await show()
    await click(document.body.querySelector('input[aria-label="Select Amoxil 500 mg"]'))
    await click(document.body.querySelector('input[aria-label="Select Panadol Extra"]'))
    expect(text()).toContain('2 selected')
    await click(btn('Approve 2'))
    expect(repo.review).toHaveBeenCalledWith(['c1', 'c2'], 'approve')
    expect(text()).toContain('2 items approved.')
  })

  it('asks before retiring an item that businesses are linked to', async () => {
    await show()
    await click(btn('Retire Panadol Extra'))
    expect(text()).toContain('2 business items are linked to this and will be unlinked')
    expect(repo.review).not.toHaveBeenCalled()
    await click([...document.body.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Retire').at(-1))
    expect(repo.review).toHaveBeenCalledWith(['c2'], 'retire')
  })

  it('finds new candidates from business catalogues', async () => {
    await show()
    await click(btn('Find new candidates'))
    expect(repo.seed).toHaveBeenCalledWith(2)
    expect(text()).toContain('5 new candidates added to the queue.')
  })

  it('shows an error with retry, and a notice before the update is installed', async () => {
    repo.adminPage.mockRejectedValueOnce(new Error('Failed to fetch'))
    await show()
    expect(text()).toContain("We couldn't load the library")
    repo.adminPage.mockResolvedValue({ items: [], total: 0, available: false })
    await click(btn('Retry'))
    expect(text()).toContain('The product library is not installed yet')
  })
})

describe('approved library', () => {
  it('adds an item, showing the database refusal for a duplicate', async () => {
    await show()
    await click(btn('Approved'))
    expect(text()).toContain('No approved items yet')
    await click(btn('+ Add item'))
    await click(btn('Add item'))
    expect(text()).toContain('Enter the product name.')
    await setValue(document.getElementById('lib-name'), 'Ventolin')
    await setValue(document.getElementById('lib-strength'), '100mcg')
    repo.save.mockRejectedValueOnce(new Error('Supabase error (409): Another library item already has this name and strength, or this NAFDAC number. Search for it and merge instead.'))
    await click(btn('Add item'))
    expect(text()).toContain('Another library item already has this name and strength')
    await click(btn('Add item'))
    expect(repo.save).toHaveBeenLastCalledWith(null, expect.objectContaining({ brand_name: 'Ventolin', strength: '100mcg', barcodes: [] }))
    expect(text()).toContain('Ventolin 100mcg saved.')
  })
})

describe('suggestions', () => {
  it('adds a suggestion to the library with the admin\'s edits, and links a duplicate to the existing item', async () => {
    await show()
    await click(btn('Suggestions (2)'))
    expect(text()).toContain('From Allen Pharmacy (owner@allen.com)')
    expect(text()).toContain('“Our blend”')
    expect(text()).toContain('Already in the library: Panadol Extra')
    await click(btn('Add to library…'))
    await setValue(document.getElementById('lib-name'), 'Allen House Tea Bags')
    await click(btn('Add and link'))
    expect(repo.decide).toHaveBeenCalledWith('s1', 'create', { fields: expect.objectContaining({ brand_name: 'Allen House Tea Bags' }) })
    await click(btn('Link to Panadol Extra'))
    expect(repo.decide).toHaveBeenCalledWith('s2', 'link', { catalogItemId: 'c2' })
  })

  it('rejects with a reason', async () => {
    await show()
    await click(btn('Suggestions (2)'))
    await click([...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Reject…'))
    await setValue(document.getElementById('reject-reason'), 'Please add the strength')
    await click(btn('Reject'))
    expect(repo.decide).toHaveBeenCalledWith('s1', 'reject', { note: 'Please add the strength' })
    expect(text()).toContain('rejected. Allen Pharmacy has been told.')
  })
})

describe('importing an official list', () => {
  it('reads a CSV, matches the columns, and imports in batches', async () => {
    await show()
    await click(btn('Import list'))
    const csv = 'Product Name,NAFDAC Reg No,Manufacturer,Extra\nCoartem 20/120mg,A4-1234,Novartis,x\n,B1-1,Emzor,y\nPanadol Extra,A4-5555,GSK,z\n'
    const input = document.body.querySelector('input[type="file"]')
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [new File([csv], 'nafdac.csv', { type: 'text/csv' })], configurable: true })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush(); await flush()
    expect(text()).toContain('first 5 of 3 rows')
    expect(document.body.querySelector('select[aria-label="Column Product Name holds"]').value).toBe('brand_name')
    expect(document.body.querySelector('select[aria-label="Column NAFDAC Reg No holds"]').value).toBe('nafdac_no')
    expect(document.body.querySelector('select[aria-label="Column Extra holds"]').value).toBe('')
    expect(text()).toContain('3 rows to import; 1 without a name will be skipped.')
    await click(btn('Import 3 rows'))
    expect(repo.importRows).toHaveBeenCalledWith([
      { brand_name: 'Coartem 20/120mg', nafdac_no: 'A4-1234', manufacturer: 'Novartis' },
      { nafdac_no: 'B1-1', manufacturer: 'Emzor' },
      { brand_name: 'Panadol Extra', nafdac_no: 'A4-5555', manufacturer: 'GSK' }])
    expect(text()).toContain('Import finished')
    expect(text()).toContain('2 added · 1 matched and updated · 0 skipped')
  })

  it('requires the product name column', async () => {
    await show()
    await click(btn('Import list'))
    const input = document.body.querySelector('input[type="file"]')
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [new File(['Code,Maker\n1,GSK\n'], 'list.csv')], configurable: true })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush(); await flush()
    expect(text()).toContain('Choose the column that holds the product name.')
    expect(btn('Import 1 rows')).toBeUndefined()
  })
})
