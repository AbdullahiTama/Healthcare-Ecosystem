import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerBusiness } from '../../../services/supabase'

describe('registerBusiness', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('posts to the server handler and never sends a password', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    await registerBusiness({ name: 'Lifeline', owner: 'Ada', email: 'ada@x.test', password: 'hunter2' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/register-business')
    expect(init.method).toBe('POST')
    expect(init.body).not.toContain('hunter2')
    expect(JSON.parse(init.body)).toMatchObject({ name: 'Lifeline', email: 'ada@x.test' })
  })

  it('surfaces the server message when registration is refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: 'An account with this email already exists. Please sign in instead.' }) })
    await expect(registerBusiness({ name: 'L', owner: 'A', email: 'a@x.test' })).rejects.toThrow(/already exists/)
  })

  it('reports a network failure readably', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(registerBusiness({ name: 'L', owner: 'A', email: 'a@x.test' })).rejects.toThrow(/connection/i)
  })
})
