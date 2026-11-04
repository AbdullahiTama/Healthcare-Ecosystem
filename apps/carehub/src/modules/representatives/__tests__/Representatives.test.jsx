// The company's Representatives page and the Settings operating-model switch, against a mocked repository.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const repo = vi.hoisted(() => ({
  list: vi.fn(), summary: vi.fn(), statement: vi.fn(), pending: vi.fn(), candidateStaff: vi.fn(), add: vi.fn(), setStatus: vi.fn(),
  searchProducts: vi.fn(), payment: vi.fn(), supply: vi.fn(), decide: vi.fn(), reverse: vi.fn(), newRequestKey: vi.fn(() => 'key-1'),
  accountProfile: vi.fn(), history: vi.fn(), preview: vi.fn(), switchModel: vi.fn(), territories: vi.fn(), setTerritory: vi.fn(), register: vi.fn(),
}))
vi.mock('../repositories', () => ({ representativesRepository: repo }))

import Representatives from '../Representatives.jsx'
import OperatingModelSettings from '../OperatingModelSettings.jsx'

const BRAND = { id: 'co', name: 'Zenith Pharma Ltd', business_type: 'manufacturer_importer', parent_business_id: null }
const ADA = { id: 'r1', full_name: 'Ada Obi', rep_code: 'REP-001', status: 'active', staff_id: 's1', rep_account_id: null }
const SUMMARY = { period: { from: '2026-11-01', to: '2026-11-02' }, representatives: [{ id: 'r1', full_name: 'Ada Obi', rep_code: 'REP-001', closing_balance: 6000, pending_count: 1,
  opening_balance: 0, supplies: 10000, payments: 4000, returns: 0, transfers_net: 0, adjustments_net: 0 }], totals: { closing_balance: 6000 } }

const REGISTER = { period: { from: '2026-11-01', to: '2026-11-04' }, generated_at: '2026-11-04T10:00:00Z', currency: 'NGN', filters: {}, has_more: false,
  totals: { count: 2, posted: 1, pending: 0, rejected: 1, debits: 10000, credits: 0 },
  entries: [
    { id: 'e1', entry_no: 'RL-1', entry_type: 'supply', status: 'posted', entry_date: '2026-11-01', description: 'Products supplied on credit', debit: 10000, credit: 0,
      representative_id: 'r1', representative_name: 'Ada Obi', rep_code: 'REP-001', territory_name: 'Lagos Mainland', created_by_name: 'Musa Manager', lines: [] },
    { id: 'e2', entry_no: 'RL-2', entry_type: 'return', status: 'rejected', entry_date: '2026-11-02', description: 'Products returned (good)', debit: 0, credit: 0,
      representative_id: 'r1', representative_name: 'Ada Obi', rep_code: 'REP-001', created_by_name: 'Musa Manager', decided_by_name: 'Mrs Owner', decision_note: 'Not ours', lines: [] },
  ] }

let host, root
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const text = () => document.body.textContent
const btn = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const click = async (el) => { await act(async () => { el.click() }); await flush() }
const setValue = async (el, v) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
const render = async (el) => { await act(async () => { root.render(el) }); await flush(); await flush() }

beforeEach(() => {
  vi.clearAllMocks()
  repo.list.mockResolvedValue({ available: true, representatives: [ADA] })
  repo.summary.mockResolvedValue(SUMMARY)
  repo.payment.mockResolvedValue({ id: 'e9', entry_no: 'RL-9', status: 'posted', balance: 5000 })
  repo.accountProfile.mockResolvedValue({ available: true, profile: { operating_model: 'centralised', account_kind: 'business' } })
  repo.history.mockResolvedValue({ available: true, changes: [] })
  repo.territories.mockResolvedValue([{ id: 't1', name: 'Lagos Mainland' }])
  repo.register.mockResolvedValue(REGISTER)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('Representatives page', () => {
  it('lists each representative with their current balance and what it means', async () => {
    await render(<Representatives brand={BRAND} role='Owner' perms={{}} accountProfile={{ operating_model: 'centralised' }} />)
    expect(text()).toContain('Centralised operation')
    expect(text()).toContain('Ada Obi')
    expect(text()).toContain('₦6,000.00')
    expect(text()).toContain('Owes the company ₦6,000.00')
    expect(text()).toContain('1 awaiting approval')
  })

  it('a viewer sees statements but no recording buttons', async () => {
    await render(<Representatives brand={BRAND} role='Accounts' perms={{ canViewRepLedger: true }} accountProfile={{ operating_model: 'centralised' }} />)
    expect(btn('Statement')).toBeDefined()
    expect(btn('Payment')).toBeUndefined()
    expect(btn('Add representative')).toBeUndefined()
  })

  it('records a payment with the request key and refreshes', async () => {
    await render(<Representatives brand={BRAND} role='Owner' perms={{}} accountProfile={{ operating_model: 'centralised' }} />)
    await click(btn('Payment'))
    await click(btn('Save'))
    expect(text()).toContain('Enter an amount greater than zero.')
    await setValue(document.getElementById('rep-pay-amount'), '1000')
    await setValue(document.getElementById('rep-pay-recipient'), 'Accounts desk')
    await click(btn('Save'))
    expect(repo.payment).toHaveBeenCalledWith('co', 'r1', expect.objectContaining({ amount: 1000, method: 'cash', recipient: 'Accounts desk', requestKey: 'key-1' }))
    expect(text()).toContain('Payment recorded (RL-9).')
    expect(repo.list).toHaveBeenCalledTimes(2)
  })

  it('shows the database refusal as a sentence', async () => {
    repo.payment.mockRejectedValue(new Error('Supabase error (400): Ada Obi is inactive. Reactivate them to record new entries.'))
    await render(<Representatives brand={BRAND} role='Owner' perms={{}} accountProfile={{ operating_model: 'centralised' }} />)
    await click(btn('Payment'))
    await setValue(document.getElementById('rep-pay-amount'), '10')
    await setValue(document.getElementById('rep-pay-recipient'), 'Desk')
    await click(btn('Save'))
    expect(text()).toContain('Ada Obi is inactive. Reactivate them to record new entries.')
  })

  it('says so plainly before the database update, and when there are no representatives', async () => {
    repo.list.mockResolvedValueOnce({ available: false, representatives: [] })
    await render(<Representatives brand={BRAND} role='Owner' perms={{}} accountProfile={null} />)
    expect(text()).toContain('Not available yet')
    repo.list.mockResolvedValueOnce({ available: true, representatives: [] })
    await render(<Representatives brand={{ ...BRAND, id: 'co2' }} role='Owner' perms={{}} accountProfile={null} />)
    expect(text()).toContain('No representatives yet')
  })

  it('the Transactions tab lists every entry with its audit trail and filters by representative, type and territory', async () => {
    await render(<Representatives brand={BRAND} role='Accounts' perms={{ canViewRepLedger: true }} accountProfile={{ operating_model: 'centralised' }} />)
    await click([...document.body.querySelectorAll('[role=tab]')].find((t) => t.textContent === 'Transactions'))
    expect(repo.register).toHaveBeenLastCalledWith('co', expect.objectContaining({ representativeId: '', entryType: '', territoryId: '', productId: undefined, offset: 0 }))
    expect(text()).toContain('Recorded by Musa Manager')
    expect(text()).toContain('Rejected by Mrs Owner (Not ours)')
    expect(text()).toContain('1 posted')
    expect(text()).toContain('₦10,000.00')
    await setValue(document.getElementById('register-rep'), 'r1')
    await flush()
    await setValue(document.getElementById('register-type'), 'transfer')
    await flush()
    await setValue(document.getElementById('register-territory'), 't1')
    await flush()
    expect(repo.register).toHaveBeenLastCalledWith('co', expect.objectContaining({ representativeId: 'r1', entryType: 'transfer', territoryId: 't1' }))
  })

  it('the Transactions tab says when nothing matches, and when it could not load', async () => {
    repo.register.mockResolvedValueOnce({ ...REGISTER, entries: [], totals: { count: 0 } })
    await render(<Representatives brand={BRAND} role='Owner' perms={{}} accountProfile={{ operating_model: 'centralised' }} />)
    await click([...document.body.querySelectorAll('[role=tab]')].find((t) => t.textContent === 'Transactions'))
    expect(text()).toContain('No transactions match these filters')
    repo.register.mockRejectedValueOnce(new Error('Failed to fetch'))
    await setValue(document.getElementById('register-type'), 'payment')
    await flush()
    expect(text()).toContain("We couldn't load the transactions.")
  })

  it('a manager places a representative in a territory; a viewer cannot', async () => {
    await render(<Representatives brand={BRAND} role='Owner' perms={{}} accountProfile={{ operating_model: 'centralised' }} />)
    await setValue(document.getElementById('territory-r1'), 't1')
    await flush()
    expect(repo.setTerritory).toHaveBeenCalledWith('r1', 't1')
    await act(async () => root.unmount()); root = createRoot(host)
    await render(<Representatives brand={BRAND} role='Accounts' perms={{ canViewRepLedger: true }} accountProfile={{ operating_model: 'centralised' }} />)
    expect(document.getElementById('territory-r1')).toBeNull()
  })

  it('opens a statement with opening and closing balances', async () => {
    repo.statement.mockResolvedValue({ company: { name: 'Zenith' }, representative: { full_name: 'Ada Obi', rep_code: 'REP-001' }, period: { from: '2026-11-01', to: '2026-11-02' },
      currency: 'NGN', opening_balance: 0, closing_balance: 6000, position: 'owes', totals: { supplies: 10000, payments: 4000 }, pending: [],
      entries: [{ id: 'e1', entry_no: 'RL-1', entry_type: 'supply', entry_date: '2026-11-01', description: 'Products supplied on credit', debit: 10000, credit: 0, running_balance: 10000, lines: [] },
        { id: 'e2', entry_no: 'RL-2', entry_type: 'payment', entry_date: '2026-11-02', description: 'Payment received', debit: 0, credit: 4000, running_balance: 6000, lines: [] }] })
    await render(<Representatives brand={BRAND} role='Owner' perms={{}} accountProfile={{ operating_model: 'centralised' }} />)
    await click(btn('Statement'))
    expect(text()).toContain('Opening balance brought forward')
    expect(text()).toContain('Closing balance carried forward')
    expect(text()).toContain('Owes the company ₦6,000.00')
    expect(btn('Reverse RL-2')).toBeDefined()
  })
})

describe('Settings > Operating model', () => {
  const PREVIEW = { from: 'centralised', to: 'decentralised', token: 'tok-1', blockers: [], warnings: [], total_balance: 6000, changes: ['Each active representative gets their own account.'],
    representatives: [{ id: 'r1', full_name: 'Ada Obi', rep_code: 'REP-001', balance: 6000, converts: true, reuses_account: false,
      stock: [{ company_product_id: 'p1', product_name: 'Amoxil 500', custody: 4, company_stock: 99, carry: 4 }] }] }

  it('reviews the migration summary, lets the owner change custody quantities, and switches with the reviewed token', async () => {
    repo.preview.mockResolvedValue(PREVIEW)
    repo.switchModel.mockResolvedValue({ from: 'centralised', to: 'decentralised', converted: 1, exceptions: [],
      reconciliation: { balanced: true, before: { total_balance: 6000, ledger_entries: 4, stock_units: 160, stock_value: 1000, custody_units: 4 },
        after: { total_balance: 6000, ledger_entries: 4, stock_units: 160, stock_value: 1000, custody_units: 0 } } })
    await render(<OperatingModelSettings brand={BRAND} />)
    expect(text()).toContain('Current')
    await click(btn('Switch to Decentralised'))
    expect(repo.preview).toHaveBeenCalledWith('co', 'decentralised')
    expect(text()).toContain('Each active representative gets their own account.')
    expect(text()).toContain('Gets a new account of their own.')
    await setValue(document.getElementById('plan-r1:p1'), '2')
    await click(btn('Confirm switch to Decentralised'))
    expect(repo.switchModel).toHaveBeenCalledWith('co', 'decentralised', 'tok-1', { stockPlan: [{ representative_id: 'r1', company_product_id: 'p1', qty: 2 }], note: '' })
    expect(text()).toContain('1 representative(s) moved')
    expect(text()).toContain('Reconciled')
    expect(text()).toContain('Stock units (company and representative accounts)')
  })

  it('cannot confirm while something blocks the switch', async () => {
    repo.preview.mockResolvedValue({ ...PREVIEW, blockers: [{ code: 'pending_entries', message: '1 return(s) or transfer(s) are awaiting approval. Approve or reject them first.' }] })
    await render(<OperatingModelSettings brand={BRAND} />)
    await click(btn('Switch to Decentralised'))
    expect(text()).toContain('Resolve these first')
    expect(btn('Confirm switch to Decentralised').disabled).toBe(true)
  })

  it('renders nothing before the database update', async () => {
    repo.accountProfile.mockResolvedValue({ available: false, profile: null })
    await render(<OperatingModelSettings brand={BRAND} />)
    expect(text()).not.toContain('Operating model')
  })
})
