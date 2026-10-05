const { supabase, fetchMock } = vi.hoisted(() => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
  fetchMock: vi.fn(),
}))

vi.mock('../../config/supabaseClient', () => ({ supabase }))

import { callAdminAuth } from './adminApi'

describe('callAdminAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'signed-supabase-access-token' } },
      error: null,
    })
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the current Supabase access token only in Authorization', async () => {
    await callAdminAuth('list_staff', {
      token: 'forged-client-token',
      role: 'super_admin',
    })

    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin-auth')
    expect(request.headers.Authorization).toBe('Bearer signed-supabase-access-token')
    expect(JSON.parse(request.body)).toEqual({
      action: 'list_staff',
      role: 'super_admin',
    })
  })

  it('does not send a request without a current Supabase session', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    })

    await expect(callAdminAuth('verify')).rejects.toThrow(/session has expired/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('announces an expired session when the API answers 401', async () => {
    const heard = vi.fn()
    window.addEventListener('admin:session-expired', heard)
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Invalid or expired token' }) })
    await expect(callAdminAuth('list_reports')).rejects.toThrow('Invalid or expired token')
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener('admin:session-expired', heard)
  })

  it('does not announce an expired session for other failures', async () => {
    const heard = vi.fn()
    window.addEventListener('admin:session-expired', heard)
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
    await expect(callAdminAuth('list_reports')).rejects.toThrow('boom')
    expect(heard).not.toHaveBeenCalled()
    window.removeEventListener('admin:session-expired', heard)
  })
})
