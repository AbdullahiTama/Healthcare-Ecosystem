// Inventory bulk upload, end to end through the modal: a 1,000-row file is checked (nothing saved), saved in batches,
// and every row is accounted for in the result: imported, duplicate or failed with its reason. The rows not imported
// can be downloaded and uploaded again.
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const exportService = vi.hoisted(() => ({ downloadBlob: vi.fn() }))
vi.mock('../../../services/supabase', () => ({ sbFetch: vi.fn(), sbFetchWithCount: vi.fn() }))
vi.mock('../../business-directory/services/exportService', async (orig) => ({ ...(await orig()), downloadBlob: exportService.downloadBlob }))

import InventoryImportModal from './InventoryImportModal'

let host, root
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await flush() }
const btn = (pred) => [...document.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await settle() }
const text = () => document.body.textContent

const HEADER = 'Product Name,Generic Name,Category,Selling Price (NGN),Cost Price (NGN),Stock Quantity,Reorder Level,Barcode,List on CareFind (yes/no),Expiry Date'
const existing = [{ id: 'old', name: 'Panadol 500mg', generic_name: 'Paracetamol', barcode: '' }]

function mount(props) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  return act(async () => { root.render(<InventoryImportModal show onClose={vi.fn()} existing={existing} businessId='B1' {...props} />) })
}
async function upload(csv) {
  const input = document.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { value: [new File([csv], 'products.csv', { type: 'text/csv' })], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await settle()
}

beforeEach(() => { vi.clearAllMocks(); globalThis.IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

describe('InventoryImportModal', () => {
  it('imports all 1,000 valid rows of a large file, including brands that share a generic name with stock', async () => {
    const rows = [HEADER]
    for (let i = 0; i < 1000; i++) rows.push(`Brand ${i} 500mg,Paracetamol,Medicines,${100 + i},50,10,5,,yes,`)
    const repository = { createMany: vi.fn(async (_b, recs) => recs.map((r, k) => ({ id: 'n' + k + r.name, ...r }))), create: vi.fn() }
    const onSaved = vi.fn()
    await mount({ repository, onSaved })
    await upload(rows.join('\n'))

    expect(repository.createMany).not.toHaveBeenCalled()
    expect(text()).toContain('Ready to import1,000')
    await click(btn(b => b.textContent === 'Import 1,000 products'))

    expect(repository.createMany).toHaveBeenCalledTimes(10)
    expect(repository.createMany.mock.calls[0][0]).toBe('B1')
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onSaved.mock.calls[0][0]).toHaveLength(1000)
    expect(text()).toContain('1,000 of 1,000 rows imported.')
  })

  it('shows submitted / imported / duplicates / failed with reasons, and offers the rows to fix', async () => {
    const csv = [HEADER,
      'Zinc 20mg,Zinc,Supplements,300,150,40,5,,yes,',
      'Panadol 500mg,Paracetamol,Medicines,500,300,10,5,,yes,', // already in Inventory
      ',No name,Medicines,1,1,1,1,,yes,', // invalid
      'Bad Price,,Medicines,abc,1,1,1,,yes,', // invalid
      'Vitamin C,,Supplements,800,400,6,5,,yes,', // refused by the database
    ].join('\n')
    const repository = {
      createMany: vi.fn(async () => { throw new Error('Supabase error (400): check constraint') }),
      create: vi.fn(async (_b, r) => { if (r.name === 'Vitamin C') throw new Error('Supabase error (400): value too long'); return [{ id: 'z', ...r }] }),
    }
    await mount({ repository, onSaved: vi.fn() })
    await upload(csv)
    expect(text()).toContain('Duplicate: already in Inventory as Panadol 500mg.')
    expect(text()).toContain('Product name is missing.')
    expect(text()).toContain('Selling price "abc" is not a number.')

    await click(btn(b => b.textContent === 'Import 2 products'))
    expect(text()).toContain('1 of 5 rows imported. 1 duplicate skipped. 3 not imported (reasons below).')
    expect(text()).toContain('value too long')

    await click(btn(b => b.textContent.includes('Download 3 rows to fix')))
    const [csvOut, fileName] = exportService.downloadBlob.mock.calls.at(-1)
    expect(fileName).toBe('CareHub_Inventory_Rows_To_Fix.csv')
    expect(csvOut).toContain('Vitamin C')
    expect(csvOut).toContain('Bad Price')
    expect(csvOut).not.toContain('Zinc 20mg')
    expect(csvOut).toContain('Problem')
  })

  it('stops at the plan limit and says how many rows are over it', async () => {
    const csv = [HEADER, 'A,,Medicines,1,1,1,1,,yes,', 'B,,Medicines,1,1,1,1,,yes,', 'C,,Medicines,1,1,1,1,,yes,'].join('\n')
    await mount({ remaining: 2, repository: { createMany: vi.fn(), create: vi.fn() } })
    await upload(csv)
    expect(text()).toContain("Over your plan's product limit.")
    expect(btn(b => b.textContent === 'Import 2 products')).toBeTruthy()
  })

  it('names a missing Product Name column instead of importing nothing silently', async () => {
    await mount({ repository: { createMany: vi.fn(), create: vi.fn() } })
    await upload('Generic Name,Category\nZinc,Supplements')
    expect(text()).toContain('has no Product Name column')
  })
})
