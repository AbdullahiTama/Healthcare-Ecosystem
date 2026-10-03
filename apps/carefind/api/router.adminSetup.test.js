const createClient = vi.hoisted(() => vi.fn(() => ({})))

vi.mock('@supabase/supabase-js', () => ({ createClient }))

import router from './router.js'

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(value) {
      this.body = value
      return this
    },
  }
}

describe('removed admin setup route', () => {
  it('returns not found without invoking a bootstrap handler', async () => {
    const res = response()
    await router({
      method: 'POST',
      url: '/api/admin-setup',
      headers: { 'user-agent': 'test-client' },
    }, res)

    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'No handler for /api/admin-setup' })
  })
})
