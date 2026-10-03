// shop_order_messages.sender_id references auth.users, not profiles, so PostgREST cannot embed a profile through
// it ("Could not find a relationship between 'shop_order_messages' and 'sender_id'"). Names are looked up from
// profiles separately, and a failed lookup must not lose the messages.
vi.mock('../../config/supabaseClient', () => ({ supabase: {} }))
import { createOrderRepository } from './orderRepository'

// Records every select() and answers each table from `tables`.
function fakeClient(tables) {
  const calls = []
  return {
    calls,
    from: (table) => {
      const call = { table, select: null, filters: [] }
      calls.push(call)
      const b = {}
      b.select = (cols) => { call.select = cols; return b }
      for (const m of ['eq', 'order', 'in']) b[m] = (...a) => { call.filters.push([m, ...a]); return b }
      b.then = (resolve) => resolve(tables[table] ?? { data: [], error: null })
      return b
    },
  }
}

const msgs = [
  { id: 'm1', order_id: 'o1', sender_id: 'u1', sender_role: 'customer', message: 'hi', created_at: '2026-10-01T10:00:00Z' },
  { id: 'm2', order_id: 'o1', sender_id: 'u2', sender_role: 'vendor', message: 'hello', created_at: '2026-10-01T10:05:00Z' },
  { id: 'm3', order_id: 'o1', sender_id: 'u1', sender_role: 'customer', message: 'thanks', created_at: '2026-10-01T10:06:00Z' },
]

describe('orderRepository.getMessages', () => {
  it('reads the messages without embedding a profile through sender_id', async () => {
    const client = fakeClient({ shop_order_messages: { data: msgs, error: null }, profiles: { data: [], error: null } })

    await createOrderRepository(client).getMessages('o1')

    const q = client.calls.find((c) => c.table === 'shop_order_messages')
    expect(q.select).toBe('*')
  })

  it('attaches each sender\'s name from profiles in the shape the order page reads', async () => {
    const client = fakeClient({
      shop_order_messages: { data: msgs, error: null },
      profiles: { data: [{ id: 'u1', full_name: 'Ada' }, { id: 'u2', full_name: 'Pharma Ltd' }], error: null },
    })

    const result = await createOrderRepository(client).getMessages('o1')

    expect(result.map((m) => m.profiles?.full_name)).toEqual(['Ada', 'Pharma Ltd', 'Ada'])
    const lookup = client.calls.find((c) => c.table === 'profiles')
    expect(lookup.filters).toContainEqual(['in', 'id', ['u1', 'u2']]) // each sender once
  })

  it('still returns the messages when the name lookup fails', async () => {
    const client = fakeClient({
      shop_order_messages: { data: msgs, error: null },
      profiles: { data: null, error: { message: 'permission denied for table profiles' } },
    })

    const result = await createOrderRepository(client).getMessages('o1')

    expect(result).toHaveLength(3)
    expect(result[0].message).toBe('hi')
  })

  it('does not look up profiles when there are no messages', async () => {
    const client = fakeClient({ shop_order_messages: { data: [], error: null } })

    await expect(createOrderRepository(client).getMessages('o1')).resolves.toEqual([])
    expect(client.calls.some((c) => c.table === 'profiles')).toBe(false)
  })

  it('throws when the messages themselves cannot be read', async () => {
    const client = fakeClient({ shop_order_messages: { data: null, error: { message: 'boom' } } })

    await expect(createOrderRepository(client).getMessages('o1')).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('orderRepository.addMessage', () => {
  it('lets the server derive the sender and role: only the order and the text are sent', async () => {
    const rpc = vi.fn(async () => ({ data: 'msg-1', error: null }))

    const id = await createOrderRepository({ rpc }).addMessage('o1', 'Is it ready?')

    expect(rpc).toHaveBeenCalledWith('shop_add_message', { p_order_id: 'o1', p_message: 'Is it ready?' })
    expect(id).toBe('msg-1')
  })

  it('throws when the server rejects the message', async () => {
    const rpc = async () => ({ data: null, error: { message: 'Not authorized for this order' } })

    await expect(createOrderRepository({ rpc }).addMessage('o1', 'hi')).rejects.toMatchObject({ message: 'Not authorized for this order' })
  })
})
