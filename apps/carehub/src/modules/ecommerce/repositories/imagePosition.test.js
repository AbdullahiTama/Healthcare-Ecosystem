import { describe, it, expect } from 'vitest'
import { createEcommerceRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const P1 = 'prod-1'

describe('ecommerce image position after delete gap', () => {
  it('uses max(position)+1 not length to avoid duplicate after gap', async () => {
    const client = createInMemoryClient({
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved' }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'Good description here', category: 'medicine' }],
      ecommerce_product_images: [
        { id: 'img0', ecommerce_product_id: 'e1', url: 'a.jpg', position: 0 },
        { id: 'img1', ecommerce_product_id: 'e1', url: 'b.jpg', position: 1 },
        { id: 'img2', ecommerce_product_id: 'e1', url: 'c.jpg', position: 2 },
      ],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'https://storage/new.jpg' })
    // Simulate gap by deleting middle image without compacting via direct client delete (bypass repository compact)
    // The repository delete would normally call updateImagePositionAfterDelete, but we test the raw gap case
    // by directly deleting via the inMemoryClient to leave positions 0 and 2
    await client('ecommerce_product_images?id=eq.img1', { method: 'DELETE', prefer: 'return=minimal' })
    const before = await repo.getImages('e1')
    expect(before.map(i => i.position).sort()).toEqual([0, 2])
    // Now add new image: old logic would use length 2 => position 2 (duplicate), new logic uses max 2 +1 => 3
    await repo.addImage('e1', { name: 'new.jpg', size: 1000, type: 'image/jpeg' }, 'image/jpeg')
    const after = await repo.getImages('e1')
    const positions = after.map(i => i.position).sort((a,b)=>a-b)
    expect(positions).toEqual([0, 2, 3])
    expect(new Set(positions).size).toBe(positions.length)
  })

  it('starts at 0 for empty', async () => {
    const client = createInMemoryClient({
      ecommerce_applications: [{ id: 'appA', business_id: A, status: 'Approved' }],
      ecommerce_products: [{ id: 'e1', business_id: A, product_id: P1, status: 'Not Activated', description: 'desc', category: 'medicine' }],
      ecommerce_product_images: [],
    })
    const repo = createEcommerceRepository({ request: client, upload: async () => 'https://storage/a.jpg' })
    await repo.addImage('e1', { name: 'a.jpg', size: 1000, type: 'image/jpeg' }, 'image/jpeg')
    const imgs = await repo.getImages('e1')
    expect(imgs[0].position).toBe(0)
  })
})
