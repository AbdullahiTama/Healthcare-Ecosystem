// Debts import (a dry run first, so the preview shows which customer each row is linked to or creates) and export of
// the rows on screen, audited.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const debts = vi.hoisted(() => ({ getAll: vi.fn(), update: vi.fn(), create: vi.fn(), importRows: vi.fn() }))
vi.mock('./repositories', () => ({ debtRepository: debts }))
const audit = vi.hoisted(() => ({ recordExport: vi.fn() }))
vi.mock('../audit/repositories', () => ({ auditRepository: audit }))
const exp = vi.hoisted(() => ({ downloadBlob: vi.fn(), buildCsv: vi.fn(() => 'csv'), buildXlsx: vi.fn(async () => 'xlsx') }))
vi.mock('../business-directory/services/exportService', () => exp)
const reader = vi.hoisted(() => ({ readSpreadsheet: vi.fn() }))
vi.mock('../business-directory/services/importService', () => reader)
vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(async () => []), sbFetchWithCount: vi.fn() }))

import Debts from './Debts.jsx'

const ROWS = [
  { id: 'd1', party_name: 'Ada', direction: 'owes_us', amount: 900, amount_paid: 400, balance: 500, status: 'pending', source: 'manual', created_at: '2026-10-02' },
  { id: 'd2', party_name: 'Emzor', direction: 'we_owe', amount: 7000, amount_paid: 0, balance: 7000, status: 'pending', source: 'manual', created_at: '2026-10-03' },
]
let host, root, qc
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const dialog = () => document.querySelector('[role="dialog"]')
const btn = (pred, scope = document) => [...scope.querySelectorAll('button')].find(pred)
const click = async (el) => { await act(async () => { el.click() }); await flush(); await flush() }

async function mount(role = 'Owner', perms = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><Debts brand={{ id: 'b' }} role={role} perms={perms} /></QueryClientProvider>) })
  await flush()
}
beforeEach(() => {
  vi.clearAllMocks()
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  debts.getAll.mockResolvedValue(ROWS)
  audit.recordExport.mockResolvedValue({ status: 'recorded' })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = '' })

async function chooseFile() {
  const input = dialog().querySelector('input[type="file"]')
  const file = new File(['x'], 'receivables.csv', { type: 'text/csv' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await flush(); await flush()
}

describe('Debts import', () => {
  it('previews with a dry run (links, new customers, duplicates, errors), then imports the ready rows', async () => {
    reader.readSpreadsheet.mockResolvedValue([
      ['Customer', 'Phone', 'Amount Owed (NGN)', 'Amount Paid (NGN)', 'Reference'],
      ['Ada', '0803', '2000', '', 'INV-1'],
      ['Ngozi', '', '1500', '500', ''],
      ['Ada', '', '2000', '', 'INV-1'],
      ['', '', '5', '', ''],
    ])
    const answer = (dry) => ({
      dry_run: dry, direction: 'owes_us',
      summary: { rows: 3, debts: 2, payments: 0, duplicates: 1, errors: 0, clients_created: 1, matched: 2, amount: 3500, paid: 500 },
      rows: [
        { row: 2, status: 'ok', kind: 'debt', party: 'Ada', matched_by: 'phone', amount: 2000, paid: 0 },
        { row: 3, status: 'ok', kind: 'debt', party: 'Ngozi', matched_by: 'created', amount: 1500, paid: 500 },
        { row: 4, status: 'duplicate', kind: 'debt', party: 'Ada', matched_by: 'name', amount: 2000, paid: 0, message: 'Already recorded; skipped.' },
      ],
    })
    debts.importRows.mockImplementation(async (_b, _d, _rows, { dryRun }) => answer(dryRun))
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Import'))
    await chooseFile()
    expect(debts.importRows).toHaveBeenCalledWith('b', 'owes_us', [
      expect.objectContaining({ row: 2, party: 'Ada', phone: '0803', amount: 2000, reference: 'INV-1' }),
      expect.objectContaining({ row: 3, party: 'Ngozi', amount: 1500, paid: 500 }),
      expect.objectContaining({ row: 4, party: 'Ada' }),
    ], { dryRun: true, allowDuplicates: false })
    const text = dialog().textContent
    expect(text).toContain('Existing customer (phone)')
    expect(text).toContain('New customer')
    expect(text).toContain('Skipped: already recorded')
    expect(text).toContain('Row 5: No customer name')
    expect(text).toContain('The name is missing.')
    expect(text).toMatch(/1 row will not be imported/)
    await click(btn((b) => b.textContent === 'Import 2 rows', dialog()))
    expect(debts.importRows).toHaveBeenLastCalledWith('b', 'owes_us', expect.any(Array), { dryRun: false, allowDuplicates: false })
    expect(dialog().textContent).toContain('2 debts and 0 payments imported.')
    expect(dialog().textContent).toContain('1 new customer, 2 linked to existing customers, 1 skipped as already recorded')
    expect(debts.getAll).toHaveBeenCalledTimes(2)
  })

  it('before the database update, says import is not available yet', async () => {
    reader.readSpreadsheet.mockResolvedValue([['Customer', 'Amount'], ['Ada', '10']])
    debts.importRows.mockRejectedValue(new Error('Supabase error (404): PGRST202 Could not find the function public.import_debts'))
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Import'))
    await chooseFile()
    expect(dialog().textContent).toContain('Importing becomes available once the latest database update is applied.')
  })

  it('on the Payables tab the import is for suppliers', async () => {
    await mount()
    await click([...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent.startsWith('Payables')))
    await click(btn((b) => b.textContent.trim() === 'Import'))
    expect(dialog().textContent).toMatch(/Import payables/)
    expect(dialog().textContent).toContain('existing supplier')
  })
})

describe('Debts export', () => {
  it('exports the tab on screen in the import columns and records the audit', async () => {
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Export'))
    await click(btn((b) => b.textContent.trim() === 'Export', dialog()))
    expect(exp.buildXlsx).toHaveBeenCalled()
    const [rows, , opts] = exp.buildXlsx.mock.calls[0]
    expect(rows).toEqual([expect.objectContaining({ party: 'Ada', amount: 900, paid: 400, balance: 500, reference: 'D-D1' })])
    expect(opts).toEqual({ sheetName: 'Receivables' })
    expect(audit.recordExport).toHaveBeenCalledWith('b', expect.objectContaining({ exportType: 'debts.xlsx', rowCount: 1 }))
    expect(exp.downloadBlob).toHaveBeenCalled()
  })

  it('a refused audit saves no file; a role without export permission has no Export', async () => {
    audit.recordExport.mockResolvedValue({ status: 'refused' })
    await mount()
    await click(btn((b) => b.textContent.trim() === 'Export'))
    await click(btn((b) => b.textContent.trim() === 'Export', dialog()))
    expect(exp.downloadBlob).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Your role is not allowed to export data.')
    await act(async () => root.unmount()); host.remove()
    await mount('Cashier', {})
    expect(btn((b) => b.textContent.trim() === 'Export')).toBeUndefined()
  })
})
