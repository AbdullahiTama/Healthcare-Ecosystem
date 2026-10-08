import { createShopRepository } from './shopRepository'

// A fake supabase client whose query builder resolves to `result` however the chain is built.
function clientReturning(result) {
  const builder = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) builder[m] = () => builder
  builder.then = (resolve) => resolve(result)
  return { from: () => builder }
}

// Like clientReturning, but records every select() column list so a test can assert what the catalogue asks for.
function recordingClient(result) {
  const selects = []
  const builder = {}
  for (const m of ['eq', 'order', 'limit', 'in']) builder[m] = () => builder
  builder.select = (cols) => { selects.push(cols); return builder }
  builder.then = (resolve) => resolve(result)
  return { client: { from: () => builder }, selects }
}

describe('shopRepository.getActiveProducts seller data', () => {
  const row = (over = {}) => ({
    id: 'e1', business_id: 'b1', is_restricted: false,
    products: { id: 'p1', name: 'Embaforg', stock: 4, reorder_level: 10 },
    businesses: { id: 'b1', name: 'LifeCare Pharmacy', business_type: 'pharmacy', logo_url: null, city: 'Lagos', state: 'Lagos', lat: 6.5, lng: 3.4 },
    ...over,
  })

  it('asks for the seller business and the low-stock threshold', async () => {
    const { client, selects } = recordingClient({ data: [row()], error: null })
    await createShopRepository(client).getActiveProducts()

    const catalogue = selects[0]
    expect(catalogue).toMatch(/businesses\(id,name,business_type,logo_url,city,state,lat,lng\)/)
    expect(catalogue).toMatch(/products\([^)]*reorder_level/)
  })

  it('returns the seller business with each product', async () => {
    const { client } = recordingClient({ data: [row()], error: null })
    const [first] = await createShopRepository(client).getActiveProducts()

    expect(first.businesses).toMatchObject({ name: 'LifeCare Pharmacy', business_type: 'pharmacy' })
    expect(first.products.reorder_level).toBe(10)
  })

  it('keeps a product whose seller is hidden from the public (businesses is null)', async () => {
    const { client } = recordingClient({ data: [row({ businesses: null })], error: null })
    const rows = await createShopRepository(client).getActiveProducts()

    expect(rows).toHaveLength(1)
    expect(rows[0].businesses).toBeNull()
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
