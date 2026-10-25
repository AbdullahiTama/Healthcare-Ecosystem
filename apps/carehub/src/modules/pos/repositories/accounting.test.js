import { describe, it, expect } from 'vitest'
import { createSaleRepository, createPaymentRepository, createShiftRepository, isMissingObject } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'
const FROM = '2026-10-20T23:00:00.000Z'
const TO = '2026-10-21T23:00:00.000Z'

// Records every call and answers RPCs from a table of canned replies, so the
// exact request each method issues is the assertion.
function rpcStub(replies = {}) {
  const calls = []
  const request = async (path, options = {}) => {
    calls.push({ path, options, body: options.body ? JSON.parse(options.body) : undefined })
    const reply = replies[path]
    if (reply instanceof Error) throw reply
    return typeof reply === 'function' ? reply() : reply
  }
  return { request, calls }
}

describe('saleRepository.getRange', () => {
  it('returns only the tenant’s sales inside [from, to)', async () => {
    const client = createInMemoryClient({
      sales: [
        { id: 'in', business_id: A, created_at: '2026-10-21T08:00:00' },
        { id: 'edge-start', business_id: A, created_at: '2026-10-20T23:00:00.000Z' },
        { id: 'edge-end', business_id: A, created_at: '2026-10-21T23:00:00.000Z' },
        { id: 'before', business_id: A, created_at: '2026-10-19T08:00:00' },
        { id: 'other', business_id: B, created_at: '2026-10-21T08:00:00' },
      ],
    })
    const rows = await createSaleRepository({ request: client }).getRange(A, FROM, TO)
    expect(rows.map((r) => r.id).sort()).toEqual(['edge-start', 'in'])
  })

  it('pages past the 1000-row server cap', async () => {
    const sales = Array.from({ length: 1205 }, (_, i) => ({ id: 's' + i, business_id: A, created_at: '2026-10-21T08:00:00' }))
    const client = createInMemoryClient({ sales })
    const rows = await createSaleRepository({ request: client }).getRange(A, FROM, TO)
    expect(rows).toHaveLength(1205)
  })
})

describe('saleRepository.getByIds', () => {
  it('fetches the tenant’s sales by id, in chunks, and skips the request when empty', async () => {
    const client = createInMemoryClient({
      sales: [{ id: 'a', business_id: A }, { id: 'b', business_id: A }, { id: 'x', business_id: B }],
    })
    const repo = createSaleRepository({ request: client })
    expect((await repo.getByIds(A, ['a', 'x', 'b'])).map((r) => r.id).sort()).toEqual(['a', 'b'])
    expect(await repo.getByIds(A, [])).toEqual([])
  })
})

describe('paymentRepository', () => {
  it('getRange returns the tenant’s ledger rows in range and says the ledger is available', async () => {
    const client = createInMemoryClient({
      sale_payments: [
        { id: 1, business_id: A, received_at: '2026-10-21T08:00:00+00:00', amount: 10 },
        { id: 2, business_id: A, received_at: '2026-10-22T08:00:00+00:00', amount: 20 },
        { id: 3, business_id: B, received_at: '2026-10-21T08:00:00+00:00', amount: 30 },
      ],
    })
    const r = await createPaymentRepository({ request: client }).getRange(A, FROM, TO)
    expect(r).toEqual({ available: true, rows: [{ id: 1, business_id: A, received_at: '2026-10-21T08:00:00+00:00', amount: 10 }] })
  })

  it('getRange reports the ledger as unavailable when the table is not deployed', async () => {
    const missing = async () => { throw new Error("Supabase error (404): Could not find the table 'public.sale_payments' in the schema cache") }
    expect(await createPaymentRepository({ request: missing }).getRange(A, FROM, TO)).toEqual({ available: false, rows: [] })
  })

  it('getRange rethrows any other failure', async () => {
    const boom = async () => { throw new Error('Supabase error (500): boom') }
    await expect(createPaymentRepository({ request: boom }).getRange(A, FROM, TO)).rejects.toThrow('boom')
  })

  it('getForSale is scoped to the tenant', async () => {
    const client = createInMemoryClient({
      sale_payments: [{ id: 1, business_id: A, sale_id: 's1' }, { id: 2, business_id: B, sale_id: 's1' }],
    })
    const rows = await createPaymentRepository({ request: client }).getForSale(A, 's1')
    expect(rows.map((r) => r.id)).toEqual([1])
  })

  it('getForShift is scoped to the tenant and the shift', async () => {
    const client = createInMemoryClient({
      sale_payments: [
        { id: 1, business_id: A, shift_id: 'sh1' }, { id: 2, business_id: A, shift_id: 'sh2' }, { id: 3, business_id: B, shift_id: 'sh1' },
      ],
    })
    expect((await createPaymentRepository({ request: client }).getForShift(A, 'sh1')).map((r) => r.id)).toEqual([1])
  })

  it('recordCollection calls record_sale_payment with the sale, amount and method', async () => {
    const { request, calls } = rpcStub({ 'rpc/record_sale_payment': { applied: 500, balance: 0 } })
    const r = await createPaymentRepository({ request }).recordCollection('s1', 500, 'Transfer')
    expect(r).toEqual({ applied: 500, balance: 0 })
    expect(calls[0].path).toBe('rpc/record_sale_payment')
    expect(calls[0].options.method).toBe('POST')
    expect(calls[0].body).toEqual({ p_sale_id: 's1', p_amount: 500, p_method: 'Transfer' })
  })

  it('refund calls refund_sale with the reason', async () => {
    const { request, calls } = rpcStub({ 'rpc/refund_sale': { refunded: 100 } })
    await createPaymentRepository({ request }).refund('s1', 100, 'Cash', 'Damaged')
    expect(calls[0].body).toEqual({ p_sale_id: 's1', p_amount: 100, p_method: 'Cash', p_reason: 'Damaged' })
  })
})

describe('shiftRepository', () => {
  it('getOpen finds the caller’s open shift in this business only', async () => {
    const client = createInMemoryClient({
      pos_shifts: [
        { id: 'closed', business_id: A, opened_by: 'u1', closed_at: '2026-10-20T10:00:00+00:00' },
        { id: 'open', business_id: A, opened_by: 'u1', closed_at: null },
        { id: 'someone-else', business_id: A, opened_by: 'u2', closed_at: null },
        { id: 'other-biz', business_id: B, opened_by: 'u1', closed_at: null },
      ],
    })
    const r = await createShiftRepository({ request: client }).getOpen(A, 'u1')
    expect(r).toEqual({ available: true, shift: expect.objectContaining({ id: 'open' }) })
  })

  it('getOpen with no user id or a missing table is unavailable, not an error', async () => {
    const client = createInMemoryClient({ pos_shifts: [] })
    expect(await createShiftRepository({ request: client }).getOpen(A, null)).toEqual({ available: true, shift: null })
    const missing = async () => { throw new Error('Supabase error (404): PGRST205 Could not find the table') }
    expect(await createShiftRepository({ request: missing }).getOpen(A, 'u1')).toEqual({ available: false, shift: null })
  })

  it('getRange returns shifts that overlap the period, including still-open ones', async () => {
    const client = createInMemoryClient({
      pos_shifts: [
        { id: 'inside', business_id: A, opened_at: '2026-10-21T08:00:00+00:00', closed_at: '2026-10-21T16:00:00+00:00' },
        { id: 'spans-start', business_id: A, opened_at: '2026-10-20T20:00:00+00:00', closed_at: '2026-10-21T02:00:00+00:00' },
        { id: 'still-open', business_id: A, opened_at: '2026-10-19T08:00:00+00:00', closed_at: null },
        { id: 'ended-before', business_id: A, opened_at: '2026-10-19T08:00:00+00:00', closed_at: '2026-10-19T16:00:00+00:00' },
        { id: 'starts-after', business_id: A, opened_at: '2026-10-22T08:00:00+00:00', closed_at: null },
        { id: 'other-biz', business_id: B, opened_at: '2026-10-21T08:00:00+00:00', closed_at: null },
      ],
    })
    const r = await createShiftRepository({ request: client }).getRange(A, FROM, TO)
    expect(r.available).toBe(true)
    expect(r.rows.map((s) => s.id).sort()).toEqual(['inside', 'spans-start', 'still-open'])
  })

  it('open and close call their functions', async () => {
    const { request, calls } = rpcStub({ 'rpc/open_pos_shift': 'sh1', 'rpc/close_pos_shift': { expected_cash: 100 } })
    const repo = createShiftRepository({ request })
    expect(await repo.open(A, 5000)).toBe('sh1')
    expect(await repo.close('sh1', 4800, 'short')).toEqual({ expected_cash: 100 })
    expect(calls.map((c) => c.body)).toEqual([
      { p_business_id: A, p_opening_float: 5000 },
      { p_shift_id: 'sh1', p_counted_cash: 4800, p_note: 'short' },
    ])
  })
})

describe('isMissingObject', () => {
  it('recognises an undeployed table or function, and nothing else', () => {
    expect(isMissingObject(new Error('Supabase error (404): PGRST202 Could not find the function public.refund_sale'))).toBe(true)
    expect(isMissingObject(new Error("Could not find the table 'public.pos_shifts' in the schema cache"))).toBe(true)
    expect(isMissingObject(new Error('relation "public.sale_payments" does not exist'))).toBe(true)
    expect(isMissingObject(new Error('Supabase error (403): permission denied'))).toBe(false)
    expect(isMissingObject(null)).toBe(false)
  })
})
