import { describe, it, expect } from 'vitest'
import { createEcommerceRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'
const P1 = 'prod-1'
const P_SHARED = 'prod-shared'

describe('ecommerce duplicate activation guard', () => {
  it('upsert race 23505 → Already activated', async () => {
    const base = createInMemoryClient({
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved' }],
      ecommerce_products: [],
    })
    // Race: both SELECTs see no row, second POST hits 23505
    const request = async (path, options = {}) => {
      const method = options.method || 'GET'
      if (path.startsWith('ecommerce_products?business_id=eq.') && path.includes(`product_id=eq.${P1}`) && method === 'GET') {
        return []
      }
      if (path === 'ecommerce_products' && method === 'POST') {
        const err = new Error('duplicate key value violates unique constraint "ecommerce_products_business_id_product_id_key" (23505)')
        err.code = '23505'
        throw err
      }
      return base(path, options)
    }
    request.rows = base.rows
    request.pages = base.pages
    const repo = createEcommerceRepository({ request, upload: async () => 'url' })

    await expect(
      repo.upsertEcommerceProduct(A, P1, { description: 'Valid description here', category: 'medicine' })
    ).rejects.toThrow('Already activated — this product is already live for your store')

    // No duplicate row should exist
    expect(base.rows('ecommerce_products').length).toBe(0)
  })

  it('upsert race 23505 via inMemory unique also maps to Already activated', async () => {
    // Verify the in-memory adapter itself enforces UNIQUE and repo maps it
    const client = createInMemoryClient({
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved' }],
      ecommerce_products: [{ id: 'e-existing', business_id: A, product_id: P1, status: 'Active', description: 'Existing', category: 'medicine' }],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    // Direct POST via client should throw 23505 due to unique enforcement
    const directErr = await client('ecommerce_products', { method: 'POST', body: JSON.stringify({ business_id: A, product_id: P1, description: 'dup', category: 'medicine' }) }).catch(e => e)
    expect(String(directErr.message)).toContain('23505')
    expect(String(directErr.message)).toContain('business_id_product_id_key')

    // Now test that upsert via repo still handles race when SELECT is forced to miss
    // Use wrapper that hides existing for SELECT but POST will hit real unique violation
    const wrapped = async (path, options = {}) => {
      if (path.startsWith('ecommerce_products?business_id=eq.') && path.includes(P1) && (options.method || 'GET') === 'GET') {
        // hide existing to force POST path — simulates race where SELECT missed the row
        if (path.includes('select=id')) return []
        // fallback for getEcommerceProduct etc
        return client(path, options)
      }
      return client(path, options)
    }
    wrapped.rows = client.rows
    wrapped.pages = client.pages
    const repo2 = createEcommerceRepository({ request: wrapped, upload: async () => 'url' })
    await expect(repo2.upsertEcommerceProduct(A, P1, { description: 'Another valid desc', category: 'medicine' }))
      .rejects.toThrow('Already activated')
  })

  it('activate when already Active → no RPC', async () => {
    const client = createInMemoryClient({
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved' }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Active', description: 'Good description here', category: 'medicine' }],
      ecommerce_product_images: [{ id: 'img1', ecommerce_product_id: 'e1', url: 'https://example.com/a.jpg', position: 0 }],
    })
    const calls = []
    const request = async (path, options = {}) => {
      calls.push({ path, method: options.method || 'GET', body: options.body, prefer: options.prefer })
      return client(path, options)
    }
    request.rows = client.rows
    request.pages = client.pages
    const repo = createEcommerceRepository({ request, upload: async () => 'url' })

    await expect(repo.activate(A, P1)).rejects.toThrow('Already activated — this product is already live for your store')

    const patchCalls = calls.filter(c => c.method === 'PATCH' && c.path.includes('ecommerce_products'))
    expect(patchCalls.length).toBe(0)

    // Must not have fetched images (early return before getImages)
    const imageCalls = calls.filter(c => c.path.includes('ecommerce_product_images'))
    expect(imageCalls.length).toBe(0)

    // Shop still one listing
    expect(client.rows('ecommerce_products').filter(r => r.business_id === A && r.product_id === P1).length).toBe(1)
    expect(client.rows('ecommerce_products')[0].status).toBe('Active')
  })

  it('different vendors same product both succeed', async () => {
    const client = createInMemoryClient({
      ecommerce_applications: [
        { id: 'appA', business_id: A, status: 'Approved' },
        { id: 'appB', business_id: B, status: 'Approved' },
      ],
      ecommerce_products: [
        { id: 'eA', business_id: A, product_id: P_SHARED, status: 'Not Activated', description: 'Good description for A here', category: 'medicine' },
        { id: 'eB', business_id: B, product_id: P_SHARED, status: 'Not Activated', description: 'Good description for B here', category: 'medicine' },
      ],
      ecommerce_product_images: [
        { id: 'imgA', ecommerce_product_id: 'eA', url: 'https://example.com/a.jpg', position: 0 },
        { id: 'imgB', ecommerce_product_id: 'eB', url: 'https://example.com/b.jpg', position: 0 },
      ],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })

    // Both vendors activate same product_id concurrently
    await Promise.all([
      repo.activate(A, P_SHARED),
      repo.activate(B, P_SHARED),
    ])

    const rows = client.rows('ecommerce_products')
    const aRow = rows.find(r => r.business_id === A && r.product_id === P_SHARED)
    const bRow = rows.find(r => r.business_id === B && r.product_id === P_SHARED)
    expect(aRow.status).toBe('Active')
    expect(bRow.status).toBe('Active')
    // Shop shows two listings at possibly different prices
    expect(rows.filter(r => r.product_id === P_SHARED && r.status === 'Active').length).toBe(2)

    // Also verify upsert allows different business_id same product_id
    await repo.upsertEcommerceProduct(A, P_SHARED, { description: 'Updated A description long', category: 'medicine', ecommerce_price_kobo: 1000 })
    await repo.upsertEcommerceProduct(B, P_SHARED, { description: 'Updated B description long', category: 'medicine', ecommerce_price_kobo: 2000 })
    const afterA = client.rows('ecommerce_products').find(r => r.business_id === A && r.product_id === P_SHARED)
    const afterB = client.rows('ecommerce_products').find(r => r.business_id === B && r.product_id === P_SHARED)
    expect(afterA.ecommerce_price_kobo).toBe(1000)
    expect(afterB.ecommerce_price_kobo).toBe(2000)
  })

  it('incomplete still blocked', async () => {
    const client = createInMemoryClient({
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved' }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'short', category: 'medicine' }],
      ecommerce_product_images: [{ id: 'img1', ecommerce_product_id: 'e1', url: 'https://example.com/a.jpg', position: 0 }],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.activate(A, P1)).rejects.toThrow('Description')
    expect(client.rows('ecommerce_products').find(r => r.id === 'e1').status).toBe('Not Activated')

    // Missing category
    const client2 = createInMemoryClient({
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved' }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'Good description here', category: '' }],
      ecommerce_product_images: [{ id: 'img1', ecommerce_product_id: 'e1', url: 'a.jpg', position: 0 }],
    })
    const repo2 = createEcommerceRepository({ request: client2, upload: async () => 'url' })
    await expect(repo2.activate(A, P1)).rejects.toThrow('Category')

    // Missing image
    const client3 = createInMemoryClient({
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved' }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'Good description here', category: 'medicine' }],
      ecommerce_product_images: [],
    })
    const repo3 = createEcommerceRepository({ request: client3, upload: async () => 'url' })
    await expect(repo3.activate(A, P1)).rejects.toThrow('image')

    // Ensure no Active row was created via incomplete path
    expect(client3.rows('ecommerce_products').find(r => r.id === 'e1').status).toBe('Not Activated')
  })

  it('setStatus Active also respects Already activated guard', async () => {
    const client = createInMemoryClient({
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved' }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Active', description: 'Good description here', category: 'medicine' }],
      ecommerce_product_images: [{ id: 'img1', ecommerce_product_id: 'e1', url: 'a.jpg', position: 0 }],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'url' })
    await expect(repo.setStatus(A, P1, 'Active')).rejects.toThrow('Already activated')
  })
})
