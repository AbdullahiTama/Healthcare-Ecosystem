import { describe, it, expect, vi } from 'vitest'
import { createRepresentativesRepository } from '../repositories'

// A recording transport: what the repository sends is what the database receives.
function recorder(reply = () => ({})) {
  const calls = []
  const request = vi.fn(async (path, opts = {}) => { calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null }); return reply(path) })
  return { calls, repo: createRepresentativesRepository(request) }
}

describe('representatives repository', () => {
  it('records a supply through the database function with the request key, never a raw insert', async () => {
    const { calls, repo } = recorder(() => ({ id: 'e1', entry_no: 'RL-1', balance: 9000 }))
    const r = await repo.supply('co', 'rep', { lines: [{ product_id: 'p', qty: 2, unit_value: 10 }], reference: 'INV-1', requestKey: 'k1' })
    expect(r).toEqual({ id: 'e1', entry_no: 'RL-1', balance: 9000 })
    expect(calls).toEqual([{ path: 'rpc/record_rep_supply', method: 'POST', body: {
      p_company: 'co', p_representative_id: 'rep', p_lines: [{ product_id: 'p', qty: 2, unit_value: 10 }],
      p_entry_date: null, p_reference: 'INV-1', p_note: null, p_idempotency_key: 'k1' } }])
  })

  it('sends returns, transfers, adjustments, decisions and reversals to their functions', async () => {
    const { calls, repo } = recorder()
    await repo.returnGoods('co', 'rep', { lines: [], condition: 'damaged', accept: false, requestKey: 'k' })
    await repo.transfer('co', 'a', 'b', { lines: [], reason: 'Cover', approve: true, requestKey: 'k' })
    await repo.adjustment('co', 'rep', { direction: 'credit', amount: 5, reason: 'r', reference: 'M-1', requestKey: 'k' })
    await repo.decide('e', 'approve', { values: [{ line_id: 'l', unit_value: 1 }] })
    await repo.reverse('e', 'Wrong', 'k2')
    expect(calls.map((c) => c.path)).toEqual(['rpc/record_rep_return', 'rpc/record_rep_transfer', 'rpc/record_rep_adjustment', 'rpc/decide_rep_entry', 'rpc/reverse_rep_entry'])
    expect(calls[0].body).toMatchObject({ p_condition: 'damaged', p_accept: false })
    expect(calls[1].body).toMatchObject({ p_from_representative_id: 'a', p_to_representative_id: 'b', p_reason: 'Cover', p_approve: true })
    expect(calls[3].body).toEqual({ p_entry_id: 'e', p_decision: 'approve', p_note: null, p_values: [{ line_id: 'l', unit_value: 1 }] })
    expect(calls[4].body).toEqual({ p_entry_id: 'e', p_reason: 'Wrong', p_idempotency_key: 'k2' })
  })

  it('previews and switches with the reviewed token', async () => {
    const { calls, repo } = recorder()
    await repo.preview('co', 'decentralised')
    await repo.switchModel('co', 'decentralised', 'tok', { stockPlan: [{ representative_id: 'r', company_product_id: 'p', qty: 1 }], note: 'Go' })
    expect(calls[1]).toEqual({ path: 'rpc/switch_operating_model', method: 'POST', body: {
      p_company: 'co', p_target: 'decentralised', p_token: 'tok', p_stock_plan: [{ representative_id: 'r', company_product_id: 'p', qty: 1 }], p_note: 'Go' } })
  })

  it('reports "not available" before the migration instead of failing', async () => {
    const repo = createRepresentativesRepository(async () => { throw new Error('Supabase error (400): column businesses.operating_model does not exist') })
    expect(await repo.accountProfile('co')).toEqual({ available: false, profile: null })
    const repo2 = createRepresentativesRepository(async () => { throw new Error('Supabase error (404): Could not find the function public.my_representative') })
    expect(await repo2.myProfile()).toEqual({ available: false, profile: null })
  })

  it('a genuine failure still surfaces', async () => {
    const repo = createRepresentativesRepository(async () => { throw new Error('Failed to fetch') })
    await expect(repo.list('co')).rejects.toThrow('Failed to fetch')
  })

  it('offers only staff who are not representatives yet', async () => {
    const { repo } = recorder(() => [{ id: 's1' }, { id: 's2' }])
    expect(await repo.candidateStaff('co', ['s1', null])).toEqual([{ id: 's2' }])
  })

  it('runs the register with every filter, and the summary by territory', async () => {
    const { calls, repo } = recorder()
    await repo.register('co', { from: '2026-11-01', to: '2026-11-30', representativeId: 'r1', entryType: 'transfer', productId: 'p1', territoryId: 't1', offset: 200 })
    await repo.register('co', { from: '2026-11-01', to: '2026-11-30' })
    await repo.summary('co', '2026-11-01', '2026-11-30', 't1')
    expect(calls[0]).toEqual({ path: 'rpc/rep_ledger_register', method: 'POST', body: { p_company: 'co', p_from: '2026-11-01', p_to: '2026-11-30',
      p_representative_id: 'r1', p_entry_type: 'transfer', p_product_id: 'p1', p_territory: 't1', p_limit: 200, p_offset: 200 } })
    expect(calls[1].body).toMatchObject({ p_representative_id: null, p_entry_type: null, p_product_id: null, p_territory: null, p_offset: 0 })
    expect(calls[2].body).toEqual({ p_company: 'co', p_from: '2026-11-01', p_to: '2026-11-30', p_territory: 't1' })
  })

  it('assigns or clears a territory through the database function', async () => {
    const { calls, repo } = recorder()
    await repo.setTerritory('r1', 't1')
    await repo.setTerritory('r1', '')
    expect(calls.map((c) => c.body)).toEqual([{ p_representative_id: 'r1', p_territory_id: 't1' }, { p_representative_id: 'r1', p_territory_id: null }])
    expect(calls[0].path).toBe('rpc/set_representative_territory')
  })
})
