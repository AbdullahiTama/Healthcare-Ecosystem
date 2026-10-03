import { createShopRepository } from './shopRepository'

// A fake supabase client whose query builder resolves to `result` however the chain is built.
function clientReturning(result) {
  const builder = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'in']) builder[m] = () => builder
  builder.then = (resolve) => resolve(result)
  return { from: () => builder }
}

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
