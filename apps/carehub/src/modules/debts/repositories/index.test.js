import { describe, it, expect } from 'vitest'
import { createDebtRepository, debtRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    debts: [
      { id: '1', business_id: A, party_name: 'Ada', direction: 'owes_us', amount: 500, amount_paid: 0, balance: 500, status: 'pending', source: 'credit_sale', source_ref: 'TXN-1' },
      { id: '2', business_id: A, party_name: 'MedSupply', direction: 'we_owe', amount: 800, amount_paid: 800, balance: 0, status: 'paid', source: 'purchase', source_ref: 'PUR-1' },
      { id: '3', business_id: A, party_name: 'MedSupply', direction: 'we_owe', amount: 300, amount_paid: 0, balance: 300, status: 'pending', source: 'purchase', source_ref: 'PUR-2' },
      { id: '9', business_id: B, party_name: 'Other tenant', direction: 'owes_us', amount: 42, amount_paid: 0, balance: 42, status: 'pending', source: 'credit_sale', source_ref: 'TXN-1' },
    ],
  })
  return { client, repo: createDebtRepository(client) }
}

describe('debtRepository', () => {
  it('getAll returns only the calling tenant', async () => {
    const { repo } = seeded()
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.id).sort()).toEqual(['1', '2', '3'])
    expect(rows.some((r) => r.business_id === B)).toBe(false)
  })

  it('create injects business_id', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { party_name: 'Bola', amount: 100 })
    const created = client.rows('debts').find((r) => r.party_name === 'Bola')
    expect(created.business_id).toBe(A)
  })

  it('update scopes by id and business', async () => {
    const { repo, client } = seeded()
    await repo.update('1', A, { amount_paid: 500, balance: 0, status: 'paid' })
    expect(client.rows('debts').find((r) => r.id === '1')).toMatchObject({ balance: 0, status: 'paid' })
  })

  it('update leaves sibling debts in the same business untouched', async () => {
    const { repo, client } = seeded()
    await repo.update('1', A, { status: 'paid' })
    expect(client.rows('debts').find((r) => r.id === '3').status).toBe('pending')
  })

  // The reason debts was migrated together with purchases: updateDebt was the
  // last id-only PATCH on a money table, so an id from the wrong tenant would
  // have written straight through.
  it('update never crosses the tenant boundary', async () => {
    const { repo, client } = seeded()
    await repo.update('9', A, { status: 'paid' })
    expect(client.rows('debts').find((r) => r.id === '9').status).toBe('pending')
  })

  describe('findOpenBySource', () => {
    it('finds the open debt raised by a source record', async () => {
      const { repo } = seeded()
      const found = await repo.findOpenBySource('purchase', 'PUR-2', A)
      expect(found.id).toBe('3')
    })

    it('ignores debts already settled', async () => {
      const { repo } = seeded()
      expect(await repo.findOpenBySource('purchase', 'PUR-1', A)).toBeNull()
    })

    it('does not match another tenant debt with the same source ref', async () => {
      const { repo } = seeded()
      // debt '9' is B's and also carries source_ref TXN-1
      const found = await repo.findOpenBySource('credit_sale', 'TXN-1', A)
      expect(found.id).toBe('1')
      expect(await repo.findOpenBySource('credit_sale', 'TXN-1', 'biz-C')).toBeNull()
    })

    it('does not match a different source kind with the same ref', async () => {
      const { repo } = seeded()
      expect(await repo.findOpenBySource('purchase', 'TXN-1', A)).toBeNull()
    })

    // A debt with no status at all still counts as unsettled. Filtering this
    // in SQL (`status=neq.paid`) would drop it, because NULL comparisons are
    // unknown — and a missed debt here means a balance quietly left standing
    // after its purchase was marked paid.
    it('treats a debt with no status as open', async () => {
      const client = createInMemoryClient({
        debts: [{ id: '5', business_id: A, source: 'purchase', source_ref: 'PUR-9', balance: 200 }],
      })
      const found = await createDebtRepository(client).findOpenBySource('purchase', 'PUR-9', A)
      expect(found.id).toBe('5')
    })

    it('returns null without a request when there is no source ref', async () => {
      const { repo } = seeded()
      expect(await repo.findOpenBySource('purchase', '', A)).toBeNull()
      expect(await repo.findOpenBySource('purchase', null, A)).toBeNull()
    })
  })

  describe('recordUnderpayment', () => {
    const underpaid = {
      businessId: A,
      direction: 'we_owe',
      partyName: 'MedSupply',
      amount: 1000,
      amountPaid: 400,
      dueDate: '2026-09-01',
      description: 'Purchase: Amoxicillin',
      source: 'purchase',
      sourceRef: 'PUR-3',
    }

    it('creates a scoped, pending debt for the shortfall', async () => {
      const { repo, client } = seeded()
      await repo.recordUnderpayment(underpaid)
      const created = client.rows('debts').find((r) => r.source_ref === 'PUR-3')
      expect(created).toMatchObject({
        business_id: A,
        direction: 'we_owe',
        party_name: 'MedSupply',
        amount: 1000,
        amount_paid: 400,
        balance: 600,
        due_date: '2026-09-01',
        status: 'pending',
        source: 'purchase',
      })
    })

    it('writes nothing when the source was paid in full', async () => {
      const { repo, client } = seeded()
      const before = client.rows('debts').length
      expect(await repo.recordUnderpayment({ ...underpaid, amountPaid: 1000 })).toBeNull()
      expect(await repo.recordUnderpayment({ ...underpaid, amountPaid: 1200 })).toBeNull()
      expect(client.rows('debts')).toHaveLength(before)
    })

    // Contract: a failed debt write must never undo an already-completed sale
    // or purchase, so this swallows rather than throws.
    it('returns null instead of throwing when the write fails', async () => {
      const failing = async () => { throw new Error('network down') }
      const repo = createDebtRepository(failing)
      await expect(repo.recordUnderpayment(underpaid)).resolves.toBeNull()
    })
  })

  it('exports a default debtRepository instance', () => {
    for (const m of ['getAll', 'create', 'update', 'findOpenBySource', 'recordUnderpayment']) {
      expect(typeof debtRepository[m]).toBe('function')
    }
  })
})
