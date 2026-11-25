import { vi } from 'vitest'
import { createShopRepository } from './shopRepository'

// A fake supabase client whose query builder resolves to `result` however the chain is built.
function clientReturning(result) {
  const builder = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) builder[m] = () => builder
  builder.then = (resolve) => resolve(result)
  return { from: () => builder }
}

// A fake client that answers per table and records every select() column list, per table.
// `tables`: { name: result | (columns) => result }.
function tableClient(tables) {
  const selects = []
  return {
    selects,
    client: {
      from(table) {
        const builder = {}
        let cols = ''
        for (const m of ['eq', 'order', 'limit', 'in', 'maybeSingle']) builder[m] = () => builder
        builder.select = (c) => { cols = c; selects.push({ table, cols: c }); return builder }
        builder.then = (resolve) => {
          const t = tables[table]
          resolve(typeof t === 'function' ? t(cols) : (t || { data: [], error: null }))
        }
        return builder
      },
    },
  }
}

describe('shopRepository.getActiveProducts seller data', () => {
  const item = (over = {}) => ({
    id: 'e1', business_id: 'b1', product_id: 'p1', is_restricted: false,
    businesses: { id: 'b1', name: 'LifeCare Pharmacy', business_type: 'pharmacy', logo_url: null, city: 'Lagos', state: 'Lagos', lat: 6.5, lng: 3.4 },
    ...over,
  })
  const product = { id: 'p1', name: 'Embaforg', stock: 4, reorder_level: 10 }
  const fake = (items = [item()], products = [product]) => tableClient({
    ecommerce_products: { data: items, error: null },
    carefind_products: { data: products, error: null },
    ecommerce_product_images: { data: [], error: null },
  })

  it('asks for the seller business, and reads product details from the public view (never embeds products)', async () => {
    const { client, selects } = fake()
    await createShopRepository(client).getActiveProducts()

    const catalogue = selects.find(s => s.table === 'ecommerce_products').cols
    expect(catalogue).toMatch(/businesses\(id,name,business_type,logo_url,city,state,lat,lng\)/)
    expect(catalogue).not.toMatch(/products\(/)
    expect(selects.find(s => s.table === 'carefind_products').cols).toMatch(/reorder_level/)
    expect(selects.some(s => s.table === 'products')).toBe(false)
  })

  it('returns the seller business and the product details with each item', async () => {
    const { client } = fake()
    const [first] = await createShopRepository(client).getActiveProducts()

    expect(first.businesses).toMatchObject({ name: 'LifeCare Pharmacy', business_type: 'pharmacy' })
    expect(first.products).toMatchObject({ name: 'Embaforg', reorder_level: 10 })
  })

  it('keeps a product whose seller is hidden from the public (businesses is null)', async () => {
    const { client } = fake([item({ businesses: null })])
    const rows = await createShopRepository(client).getActiveProducts()

    expect(rows).toHaveLength(1)
    expect(rows[0].businesses).toBeNull()
  })

  it('drops an item whose product is not public', async () => {
    const { client } = fake([item(), item({ id: 'e2', product_id: 'p-unlisted' })])
    const rows = await createShopRepository(client).getActiveProducts()

    expect(rows.map(r => r.id)).toEqual(['e1'])
  })

  it('reads without reorder_level when the view does not have it yet (migration not applied)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, selects } = tableClient({
      ecommerce_products: { data: [item()], error: null },
      carefind_products: (cols) => (cols.includes('reorder_level')
        ? { data: null, error: { code: '42703', message: 'column carefind_products.reorder_level does not exist' } }
        : { data: [{ id: 'p1', name: 'Embaforg', stock: 4 }], error: null }),
    })
    const [first] = await createShopRepository(client).getActiveProducts()

    expect(first.products).toMatchObject({ name: 'Embaforg', stock: 4 })
    expect(selects.filter(s => s.table === 'carefind_products')).toHaveLength(2)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('shopRepository product detail and stock check', () => {
  it('getProductDetail returns the item with its public product details and images', async () => {
    const { client, selects } = tableClient({
      ecommerce_products: { data: { id: 'e1', product_id: 'p1', is_restricted: false }, error: null },
      carefind_products: { data: [{ id: 'p1', name: 'Embaforg', stock: 3 }], error: null },
      ecommerce_product_images: { data: [{ id: 'i1', url: 'u', position: 0 }], error: null },
    })
    const d = await createShopRepository(client).getProductDetail('e1')

    expect(d).toMatchObject({ id: 'e1', products: { name: 'Embaforg' }, images: [{ id: 'i1' }] })
    expect(selects.find(s => s.table === 'ecommerce_products').cols).not.toMatch(/products\(/)
  })

  it('getProductDetail returns null when the product is out of stock', async () => {
    const { client } = tableClient({
      ecommerce_products: { data: { id: 'e1', product_id: 'p1', is_restricted: false }, error: null },
      carefind_products: { data: [{ id: 'p1', name: 'Embaforg', stock: 0 }], error: null },
    })
    expect(await createShopRepository(client).getProductDetail('e1')).toBeNull()
  })

  it('validateStock returns each item with its current stock', async () => {
    const { client } = tableClient({
      ecommerce_products: { data: [{ id: 'e1', product_id: 'p1' }], error: null },
      carefind_products: { data: [{ id: 'p1', name: 'Embaforg', stock: 7 }], error: null },
    })
    expect(await createShopRepository(client).validateStock(['e1'])).toEqual([{ id: 'e1', product_id: 'p1', products: expect.objectContaining({ stock: 7 }) }])
  })
})

describe('shopRepository.getActiveProducts error handling', () => {
  it('treats a missing table as an empty catalogue', async () => {
    const repo = createShopRepository(clientReturning({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.ecommerce_products'" } }))

    await expect(repo.getActiveProducts()).resolves.toEqual([])
  })

  it('does not hide a permission error behind an empty catalogue', async () => {
    const denied = { code: '42501', message: 'permission denied for table ecommerce_products' }
    const repo = createShopRepository(clientReturning({ data: null, error: denied }))

    await expect(repo.getActiveProducts()).rejects.toMatchObject({ code: '42501' })
  })

  it('rethrows any other database error', async () => {
    const repo = createShopRepository(clientReturning({ data: null, error: { code: '500', message: 'boom' } }))

    await expect(repo.getActiveProducts()).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('shopRepository.getProductImages error handling', () => {
  it('treats a missing images table as no images', async () => {
    const repo = createShopRepository(clientReturning({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.ecommerce_product_images'" } }))

    await expect(repo.getProductImages('p1')).resolves.toEqual([])
  })

  it('does not hide a permission error behind an empty image list', async () => {
    const denied = { code: '42501', message: 'permission denied for table ecommerce_product_images' }
    const repo = createShopRepository(clientReturning({ data: null, error: denied }))

    await expect(repo.getProductImages('p1')).rejects.toMatchObject({ code: '42501' })
  })

  it('returns the images when the query succeeds', async () => {
    const rows = [{ id: 'i1', url: 'https://img/1.jpg', position: 0 }]
    const repo = createShopRepository(clientReturning({ data: rows, error: null }))

    await expect(repo.getProductImages('p1')).resolves.toEqual(rows)
  })
})
