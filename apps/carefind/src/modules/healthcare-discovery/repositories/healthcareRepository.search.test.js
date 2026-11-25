// Products search (CODE_AUDIT A51): ranked in the database by search_carefind_products, rows read in that order;
// before that function is installed, the previous query with the same ranking applied in the browser.
import { createHealthcareRepository } from './healthcareRepository'

function fakeClient({ rpc, rows }) {
  const calls = { rpc: [], from: [] }
  const client = {
    rpc: async (name, args) => { calls.rpc.push({ name, args }); return rpc },
    from(table) {
      const call = { table, ops: [] }
      calls.from.push(call)
      const b = {}
      for (const m of ['select', 'in', 'or', 'eq', 'order', 'limit']) b[m] = (...a) => { call.ops.push([m, ...a]); return b }
      b.then = (resolve) => resolve(rows)
      return b
    },
  }
  return { client, calls }
}

const USER = { lat: 6.5095, lng: 3.3711 }

describe('healthcareRepository.searchProducts', () => {
  it('sends the query, location and sale type to the ranking function and keeps its order', async () => {
    const { client, calls } = fakeClient({
      rpc: { data: [{ id: 'near', distance_m: 450 }, { id: 'far', distance_m: 12000 }, { id: 'gone', distance_m: 1 }], error: null },
      rows: { data: [{ id: 'far', name: 'Paracetamol' }, { id: 'near', name: 'Paracetamol' }], error: null },
    })
    const out = await createHealthcareRepository({ client }).searchProducts('paracetamol', 'retail', USER)

    expect(calls.rpc).toEqual([{ name: 'search_carefind_products', args: { p_query: 'paracetamol', p_lat: USER.lat, p_lng: USER.lng, p_sale_type: 'retail', p_limit: 100 } }])
    expect(out.map((r) => [r.id, r.distance_m])).toEqual([['near', 450], ['far', 12000]]) // a row no longer readable is skipped
    expect(calls.from[0].table).toBe('carefind_products')
    expect(calls.from[0].ops.find((o) => o[0] === 'in')).toEqual(['in', 'id', ['near', 'far', 'gone']])
  })

  it('sends no location or sale type when there is none', async () => {
    const { client, calls } = fakeClient({ rpc: { data: [], error: null }, rows: { data: [], error: null } })
    expect(await createHealthcareRepository({ client }).searchProducts('', 'all', null)).toEqual([])
    expect(calls.rpc[0].args).toMatchObject({ p_query: null, p_lat: null, p_lng: null, p_sale_type: null })
    expect(calls.from).toHaveLength(0)
  })

  it('falls back to the previous query, ranked nearest first, when the function is not installed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, calls } = fakeClient({
      rpc: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } },
      rows: { data: [
        { id: 'lekki', name: 'Paracetamol', stock: 4, businesses: { lat: 6.4474, lng: 3.5440 }, created_at: '2026-11-20' },
        { id: 'yaba', name: 'Paracetamol', stock: 4, businesses: { lat: 6.5140, lng: 3.3720 }, created_at: '2026-01-01' },
      ], error: null },
    })
    const out = await createHealthcareRepository({ client }).searchProducts('paracetamol', null, USER)

    expect(out.map((r) => r.id)).toEqual(['yaba', 'lekki'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    expect(calls.from[0].ops.find((o) => o[0] === 'or')[1]).toBe('name.ilike.%paracetamol%,generic_name.ilike.%paracetamol%,category.ilike.%paracetamol%')
  })

  it('keeps filter syntax out of the fallback query', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, calls } = fakeClient({ rpc: { data: null, error: { code: '42883' } }, rows: { data: [], error: null } })
    await createHealthcareRepository({ client }).searchProducts('a,b),name.eq.x', null, null)
    expect(calls.from[0].ops.find((o) => o[0] === 'or')[1]).toBe('name.ilike.%a b name.eq.x%,generic_name.ilike.%a b name.eq.x%,category.ilike.%a b name.eq.x%')
    console.warn.mockRestore()
  })

  it('rethrows any other error from the ranking function', async () => {
    const { client } = fakeClient({ rpc: { data: null, error: { code: '57014', message: 'timeout' } }, rows: { data: [], error: null } })
    await expect(createHealthcareRepository({ client }).searchProducts('x', null, null)).rejects.toMatchObject({ code: '57014' })
  })
})
