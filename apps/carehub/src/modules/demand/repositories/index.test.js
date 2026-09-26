import { describe, it, expect } from 'vitest'
import { createDemandRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function build(seed = {}) {
  const client = createInMemoryClient(seed)
  const repo = createDemandRepository({ request: client })
  return { client, repo }
}

describe('demandRepository', () => {
  describe('getOutOfStock', () => {
    it('returns only the calling tenant items', async () => {
      const { repo } = build({
        out_of_stock: [
          { id: 'o1', business_id: A, product_name: 'Paracetamol' },
          { id: 'o2', business_id: B, product_name: 'Ibuprofen' },
        ],
      })
      const rows = await repo.getOutOfStock(A)
      expect(rows).toHaveLength(1)
      expect(rows[0].product_name).toBe('Paracetamol')
    })

    it('returns empty when no items exist', async () => {
      const { repo } = build()
      const rows = await repo.getOutOfStock(A)
      expect(rows).toEqual([])
    })
  })

  describe('addOutOfStock', () => {
    it('inserts an out-of-stock row', async () => {
      const { repo, client } = build()
      await repo.addOutOfStock({ business_id: A, product_name: 'Amoxicillin' })
      const rows = client.rows('out_of_stock')
      expect(rows).toHaveLength(1)
      expect(rows[0].product_name).toBe('Amoxicillin')
      expect(rows[0].business_id).toBe(A)
    })
  })

  describe('updateOutOfStock', () => {
    it('patches an existing out-of-stock item', async () => {
      const { repo, client } = build({
        out_of_stock: [{ id: 'o1', business_id: A, product_name: 'Paracetamol', status: 'open' }],
      })
      await repo.updateOutOfStock('o1', { status: 'fulfilled', fulfilled_at: '2026-09-14' })
      const row = client.rows('out_of_stock').find(r => r.id === 'o1')
      expect(row.status).toBe('fulfilled')
      expect(row.fulfilled_at).toBe('2026-09-14')
    })
  })

  describe('getCustomerRequests', () => {
    it('returns only the calling tenant requests', async () => {
      const { repo } = build({
        customer_requests: [
          { id: 'r1', business_id: A, product_name: 'Vitamin C' },
          { id: 'r2', business_id: B, product_name: 'Zinc' },
        ],
      })
      const rows = await repo.getCustomerRequests(A)
      expect(rows).toHaveLength(1)
      expect(rows[0].product_name).toBe('Vitamin C')
    })

    it('returns empty when no requests exist', async () => {
      const { repo } = build()
      const rows = await repo.getCustomerRequests(A)
      expect(rows).toEqual([])
    })
  })

  describe('addCustomerRequest', () => {
    it('inserts a customer request row', async () => {
      const { repo, client } = build()
      await repo.addCustomerRequest({ business_id: A, product_name: 'Vitamin D', client_name: 'Ada' })
      const rows = client.rows('customer_requests')
      expect(rows).toHaveLength(1)
      expect(rows[0].product_name).toBe('Vitamin D')
      expect(rows[0].client_name).toBe('Ada')
    })
  })

  describe('updateCustomerRequest', () => {
    it('patches an existing customer request', async () => {
      const { repo, client } = build({
        customer_requests: [{ id: 'r1', business_id: A, product_name: 'Vitamin C', status: 'open' }],
      })
      await repo.updateCustomerRequest('r1', { status: 'fulfilled' })
      const row = client.rows('customer_requests').find(r => r.id === 'r1')
      expect(row.status).toBe('fulfilled')
    })
  })

  describe('getRequisitions', () => {
    it('returns only the calling tenant requisitions', async () => {
      const { repo } = build({
        requisitions: [
          { id: 'q1', business_id: A, supplier_name: 'MedSupply' },
          { id: 'q2', business_id: B, supplier_name: 'OtherSupply' },
        ],
        requisition_items: [
          { id: 'qi1', requisition_id: 'q1', product_name: 'Panadol' },
          { id: 'qi2', requisition_id: 'q1', product_name: 'Brufen' },
          { id: 'qi3', requisition_id: 'q2', product_name: 'Other' },
        ],
      })
      const rows = await repo.getRequisitions(A)
      expect(rows).toHaveLength(1)
      expect(rows[0].supplier_name).toBe('MedSupply')
      expect(rows[0].items).toHaveLength(2)
      expect(rows[0].items[0].product_name).toBe('Panadol')
    })

    it('returns empty when no requisitions exist', async () => {
      const { repo } = build()
      const rows = await repo.getRequisitions(A)
      expect(rows).toEqual([])
    })
  })

  describe('addRequisition', () => {
    it('calls the create_requisition RPC', async () => {
      const { repo, client } = build()
      await repo.addRequisition({
        business_id: A,
        supplier_name: 'MedSupply',
        note: 'Urgent',
        items: [{ product_name: 'Panadol', quantity: '10', cost: 500, unit: 'pack' }],
      })
      const rows = client.rows('rpc/create_requisition')
      expect(rows).toHaveLength(1)
      expect(rows[0].p_business_id).toBe(A)
      expect(rows[0].p_supplier_name).toBe('MedSupply')
      expect(rows[0].p_note).toBe('Urgent')
      expect(rows[0].p_items).toHaveLength(1)
    })
  })

  describe('updateRequisition', () => {
    it('patches an existing requisition', async () => {
      const { repo, client } = build({
        requisitions: [{ id: 'q1', business_id: A, supplier_name: 'MedSupply', status: 'draft' }],
      })
      await repo.updateRequisition('q1', { status: 'sent' })
      const row = client.rows('requisitions').find(r => r.id === 'q1')
      expect(row.status).toBe('sent')
    })
  })
})
