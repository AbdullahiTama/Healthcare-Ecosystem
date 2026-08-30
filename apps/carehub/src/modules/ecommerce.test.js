import { describe, it, expect } from 'vitest'
import { createEcommerceRepository } from './ecommerce/repositories/index.js'
import { createInMemoryClient } from '../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'
const P1 = 'prod-1'
const P2 = 'prod-2'

function seeded() {
  const client = createInMemoryClient({
    products: [
      { id: P1, business_id: A, name: 'Paracetamol', price: 10, stock: 5, cat: 'medicine' },
      { id: P2, business_id: A, name: 'Bandage', price: 5, stock: 0, cat: 'device' },
      { id: 'p9', business_id: B, name: 'Other', price: 20, stock: 10 },
    ],
    ecommerce_applications: [
      { id: 'appA', business_id: A, status: 'Approved', terms_accepted: true },
      { id: 'appB', business_id: B, status: 'Submitted', terms_accepted: true },
    ],
    ecommerce_products: [
      { id: 'e1', business_id: A, product_id: P1, status: 'Active', description: 'Good drug for fever', category: 'medicine', ecommerce_price_kobo: 1000 },
      { id: 'e2', business_id: A, product_id: P2, status: 'Not Activated', description: null, category: null },
    ],
    ecommerce_product_images: [
      { id: 'img1', ecommerce_product_id: 'e1', url: 'https://example.com/a.jpg', position: 0 },
      { id: 'img2', ecommerce_product_id: 'e1', url: 'https://example.com/b.jpg', position: 1 },
    ],
  })
  const upload = async (bucket, path) => `https://storage/${bucket}/${path}`
  return { client, repo: createEcommerceRepository({ request: client, upload }) }
}

function recording(returns = []) {
  const calls = []
  const repo = createEcommerceRepository({
    request: async (path, options) => {
      calls.push({ path, method: options?.method, body: options?.body ? JSON.parse(options.body) : null, prefer: options?.prefer })
      return returns
    },
    upload: async (bucket, path) => `https://storage/${bucket}/${path}`,
  })
  return { calls, repo }
}

describe('ecommerceRepository', () => {
  it('getApplication returns only calling tenant', async () => {
    const { repo } = seeded()
    const a = await repo.getApplication(A)
    expect(a.business_id).toBe(A)
    expect(a.status).toBe('Approved')
  })

  it('submitApplication requires terms', async () => {
    const { repo } = seeded()
    await expect(repo.submitApplication(A, { terms_accepted: false, seller_info: {} })).rejects.toThrow('terms')
  })

  it('submitApplication stamps business_id and Submitted', async () => {
    const { calls, repo } = recording()
    await repo.submitApplication(A, { terms_accepted: true, seller_info: { contactName: 'Ada' } })
    expect(calls[0].path).toBe('ecommerce_applications')
    expect(calls[0].body).toMatchObject({ business_id: A, status: 'Submitted', terms_accepted: true })
  })

  it('getInventoryWithStatus merges products with ecommerce status and respects stock', async () => {
    const { repo } = seeded()
    const rows = await repo.getInventoryWithStatus(A)
    const p1 = rows.find(r => r.product.id === P1)
    const p2 = rows.find(r => r.product.id === P2)
    expect(p1.status).toBe('Active')
    expect(p1.isActive).toBe(true)
    expect(p2.status).toBe('Out of Stock')
  })

  it('getInventoryWithStatus does not leak other tenant', async () => {
    const { repo } = seeded()
    const rows = await repo.getInventoryWithStatus(A)
    expect(rows.some(r => r.product.business_id === B)).toBe(false)
  })

  it('upsert validates price non-negative', async () => {
    const { repo } = seeded()
    await expect(repo.upsertEcommerceProduct(A, P1, { description: 'desc desc desc', category: 'medicine', ecommerce_price_kobo: -100 })).rejects.toThrow('Price must be')
  })

  it('activate blocked without Approved application', async () => {
    const { repo } = seeded()
    await expect(repo.activate(B, 'p9')).rejects.toThrow('Approved')
  })

  it('activate blocked without image', async () => {
    const client = createInMemoryClient({
      products: [{ id: P1, business_id: A, name: 'X', stock: 5 }],
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved', terms_accepted: true }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'Good description here', category: 'medicine' }],
      ecommerce_product_images: [],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.activate(A, P1)).rejects.toThrow('image')
  })

  it('activate blocked without description', async () => {
    const client = createInMemoryClient({
      products: [{ id: P1, business_id: A, name: 'X', stock: 5 }],
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved', terms_accepted: true }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: null, category: 'medicine' }],
      ecommerce_product_images: [{ id: 'img1', ecommerce_product_id: 'e1', url: 'a.jpg', position: 0 }],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.activate(A, P1)).rejects.toThrow('Description')
  })

  it('activate succeeds when complete', async () => {
    const client = createInMemoryClient({
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved', terms_accepted: true }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'Good description here', category: 'medicine' }],
      ecommerce_product_images: [{ id: 'img1', ecommerce_product_id: 'e1', url: 'a.jpg', position: 0 }],
    })
    const repo2 = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await repo2.activate(A, P1)
    const updated = client.rows('ecommerce_products').find(r => r.id === 'e1')
    expect(updated.status).toBe('Active')
  })

  it('getImages ordered by position', async () => {
    const { repo } = seeded()
    const imgs = await repo.getImages('e1')
    expect(imgs.map(i => i.position)).toEqual([0, 1])
  })

  it('addImage validates file required', async () => {
    const { repo } = seeded()
    await expect(repo.addImage('e1', null, 'image/jpeg')).rejects.toThrow('File is required')
  })

  it('setStatus validates allowed values', async () => {
    const { repo } = seeded()
    await expect(repo.setStatus(A, P1, 'InvalidStatus')).rejects.toThrow('Invalid product status')
  })
})
