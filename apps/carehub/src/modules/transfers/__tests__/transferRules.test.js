import { describe, it, expect } from 'vitest'
import { checkSendLines, checkReceived, totals, directionFor, transferError, locationName } from '../transferRules'
import { createTransferRepository } from '../repositories'

describe('transfer rules', () => {
  it('a new transfer needs whole quantities within the stock here', () => {
    expect(checkSendLines([])).toBe('Add at least one item.')
    expect(checkSendLines([{ name: 'Amoxil', qty: '', stock: 5 }])).toBe('Enter a whole quantity for Amoxil.')
    expect(checkSendLines([{ name: 'Amoxil', qty: 2.5, stock: 5 }])).toBe('Enter a whole quantity for Amoxil.')
    expect(checkSendLines([{ name: 'Amoxil', qty: 6, stock: 5 }])).toBe('Only 5 of Amoxil in stock here.')
    expect(checkSendLines([{ name: 'Amoxil', qty: 5, stock: 5 }])).toBeNull()
  })

  it('receiving sends only the short lines; empty or full means it all arrived', () => {
    const lines = [{ id: 'l1', product_name: 'Amoxil', qty_sent: 10 }, { id: 'l2', product_name: 'Vit C', qty_sent: 4 }, { id: 'l3', product_name: 'Para', qty_sent: 3 }]
    expect(checkReceived(lines, { l1: '8', l2: '', l3: '3' })).toEqual({ lines: [{ line_id: 'l1', qty_received: 8 }] })
    expect(checkReceived(lines, { l1: '0' })).toEqual({ lines: [{ line_id: 'l1', qty_received: 0 }] })
    expect(checkReceived(lines, { l2: '5' }).error).toMatch(/Vit C must be a whole number from 0 to 4/)
  })

  it('totals and direction from one location\'s side', () => {
    const t = { status: 'received', to_branch_id: 'y', stock_transfer_lines: [{ qty_sent: 10, qty_received: 8 }, { qty_sent: 4, qty_received: 4 }] }
    expect(totals(t)).toEqual({ items: 2, sent: 14, received: 12, shortfall: 2 })
    expect(totals({ ...t, status: 'in_transit' }).shortfall).toBe(0)
    expect(directionFor(t, 'y')).toBe('in')
    expect(directionFor(t, 'x')).toBe('out')
    expect(locationName({ parent_business_id: null, name: 'Allen' })).toBe('Main Location')
  })

  it('shows the database\'s sentence, never a raw error', () => {
    expect(transferError(new Error('Supabase error (400): Only 10 of Paracetamol in stock at Ikeja.'))).toBe('Only 10 of Paracetamol in stock at Ikeja.')
    expect(transferError(new Error('Supabase error (500): relation "x" does not exist'))).toBe('Could not complete this. Please try again.')
  })
})

describe('transfer repository', () => {
  const recording = (result = []) => {
    const calls = []
    const repo = createTransferRepository(async (path, o) => { calls.push({ path, body: o?.body ? JSON.parse(o.body) : null }); return result })
    return { calls, repo }
  }

  it('lists transfers in and out of one location, with lines', async () => {
    const { calls, repo } = recording([{ id: 't1' }])
    expect(await repo.list('loc')).toEqual({ available: true, transfers: [{ id: 't1' }] })
    expect(calls[0].path).toContain('or=(from_branch_id.eq.loc,to_branch_id.eq.loc)')
    expect(calls[0].path).toContain('select=*,stock_transfer_lines(*)')
  })

  it('before the migration, the list reports unavailable', async () => {
    const repo = createTransferRepository(async () => { throw new Error("Supabase error (400): Could not find a relationship between 'stock_transfers' and 'stock_transfer_lines'") })
    expect(await repo.list('loc')).toEqual({ available: false, transfers: [] })
  })

  it('send, receive and cancel call the database functions with their arguments', async () => {
    const { calls, repo } = recording([{ id: 't1', transfer_no: 'TRF-1' }])
    expect(await repo.send('a', 'b', [{ master_product_id: 'm1', qty: 3, name: 'x', stock: 9 }], 'note')).toEqual({ id: 't1', transfer_no: 'TRF-1' })
    await repo.receive('t1', [{ line_id: 'l1', qty_received: 2 }], '')
    await repo.cancel('t1', 'wrong branch')
    expect(calls.map((c) => [c.path, c.body])).toEqual([
      ['rpc/send_stock_transfer', { p_from_branch_id: 'a', p_to_branch_id: 'b', p_note: 'note', p_lines: [{ master_product_id: 'm1', qty: 3 }] }],
      ['rpc/receive_stock_transfer', { p_transfer_id: 't1', p_lines: [{ line_id: 'l1', qty_received: 2 }], p_note: null }],
      ['rpc/cancel_stock_transfer', { p_transfer_id: 't1', p_reason: 'wrong branch' }],
    ])
  })

  it('the item search is limited to linked products in stock here', async () => {
    const { calls, repo } = recording([])
    await repo.sendable('loc', 'amox(')
    expect(calls[0].path).toBe('products?business_id=eq.loc&master_product_id=not.is.null&stock=gt.0&name=ilike.*amox*&order=name.asc,id.asc&limit=30&select=id,name,stock,master_product_id')
  })
})
