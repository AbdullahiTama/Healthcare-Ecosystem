// Financial Reports show what the period's expenses cost, how much is paid and how much is still owed, plus every
// unpaid expense of any date, and export the same figures. Profit still counts expenses when they are incurred.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const now = new Date()
const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
const h = vi.hoisted(() => ({ expenses: [] }))

vi.mock('../pos/repositories', () => ({
  saleRepository: { getSince: vi.fn(async () => []), getOpen: vi.fn(async () => []), history: vi.fn(async () => []), correct: vi.fn(), remove: vi.fn() },
  paymentRepository: { getForSale: vi.fn(async () => []), refund: vi.fn(), recordCollection: vi.fn() },
  isMissingObject: () => false,
}))
vi.mock('../expenses/repositories', () => ({ expenseRepository: { getAll: vi.fn(async () => h.expenses) } }))
vi.mock('../purchases/repositories', () => ({ purchaseRepository: { getAll: vi.fn(async () => []) } }))
vi.mock('../adr/repositories', () => ({ adrReportRepository: { getReports: vi.fn(async () => []) } }))
vi.mock('../../hooks/queries', () => ({ useSettings: vi.fn(() => ({ data: {} })), useClients: vi.fn(() => ({ data: [] })) }))
vi.mock('../inventory/hooks/useProductCatalog', () => ({ useProductCatalog: vi.fn(() => ({ products: [] })) }))
vi.mock('../../hooks/usePlanGate', () => ({ usePlanGate: () => ({ allow: () => true }) }))

import Reports from './Reports.jsx'

let host, root
const card = (title) => [...host.querySelectorAll('div')].find((d) => d.children.length === 3 && d.children[0].textContent.trim() === title)
async function mount(perms = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<QueryClientProvider client={qc}><Reports brand={{ id: 'biz-1', name: 'Pharm' }} role='Owner' perms={perms} embedded /></QueryClientProvider>) })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
}

beforeEach(() => {
  h.expenses = [
    { id: 'p', category: 'Rent', description: 'Shop rent', amount: 50000, amount_paid: 50000, date: ym + '-01', staff_name: 'Ada' },
    { id: 'h', category: 'Maintenance', description: 'Generator', amount: 20000, amount_paid: 5000, date: ym + '-02', staff_name: 'Ada' },
    { id: 'u', category: 'Utilities', description: 'Water', amount: 3000, amount_paid: 0, date: ym + '-03', staff_name: 'Ada' },
    // Last year and still unpaid: not in this period's totals, but still a bill to pay.
    { id: 'old', category: 'Rent', description: 'Old rent', amount: 8000, amount_paid: 0, date: '2020-05-01', staff_name: 'Ada' },
  ]
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Financial Reports: expense payment status', () => {
  it("shows the period's expenses split into paid and still to pay; profit still counts the full amount", async () => {
    await mount()
    const group = host.querySelector('[aria-label="Expense payment status for this period"]')
    expect(group.textContent).toContain('Total ₦73,000')
    expect(group.textContent).toContain('Paid ₦55,000')
    expect(group.textContent).toContain('Still to pay ₦18,000 (2 expenses)')
    expect(card('Total expenditure').textContent).toContain('₦73,000')
    expect(card('Net profit').textContent).toContain('73,000')
    expect(card('Net profit').textContent).toContain('Loss')
  })

  it('"Expenses still to pay" covers every unpaid expense, any date', async () => {
    await mount()
    const c = card('Expenses still to pay')
    expect(c.textContent).toContain('₦26,000')
    expect(c.textContent).toContain('3 expenses not fully paid, any date')
    expect(c.textContent).toContain('₦18,000 from this period')
  })

  it('expenses from before payment status existed read as paid', async () => {
    h.expenses = [{ id: 'l', category: 'Rent', amount: 4000, date: ym + '-01' }]
    await mount()
    expect(card('Expenses still to pay').textContent).toContain('₦0')
    expect(host.querySelector('[aria-label="Expense payment status for this period"]').textContent).toContain('Paid ₦4,000')
  })

  it('the export carries the paid and still-to-pay figures and each expense\'s status', async () => {
    const written = []
    const RealBlob = globalThis.Blob
    globalThis.Blob = class { constructor(parts) { written.push(parts.join('')) } }
    const createObjectURL = URL.createObjectURL
    URL.createObjectURL = () => 'blob:x'; URL.revokeObjectURL = () => {}
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      await mount({ canExportReports: true })
      await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent.includes('Export to Excel / CSV')).click() })
      const csv = written[0]
      expect(csv).toContain('"Expenses Paid","55000"')
      expect(csv).toContain('"Expenses Still To Pay (this period)","18000"')
      expect(csv).toContain('"Unpaid Expenses (any date)","26000"')
      expect(csv).toContain('"Date","Category","Description","Amount","Paid","Still To Pay","Status","Staff"')
      expect(csv).toMatch(/"Maintenance","Generator","20000","5000","15000","Partially paid","Ada"/)
      expect(csv).toMatch(/"Utilities","Water","3000","0","3000","Unpaid","Ada"/)
    } finally {
      globalThis.Blob = RealBlob; URL.createObjectURL = createObjectURL; clickSpy.mockRestore()
    }
  })
})
