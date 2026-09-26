const harness = vi.hoisted(() => ({
  createClient: vi.fn(),
  emailFlush: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: harness.createClient }))
vi.mock('../_lib/emailService.js', () => ({ processBatch: harness.emailFlush }))

import handler from './admin-auth.js'

function makeHarness({
  user = { id: 'auth-user-1', email: 'changed@example.com' },
  authError = null,
  throwOnGetUser = false,
  admin = { id: 'admin-1', email: 'admin@example.com', role: 'super_admin', is_active: true },
  lookupError = null,
  insertError = null,
  cleanupError = null,
} = {}) {
  const fromCalls = []
  const getUser = vi.fn(async () => {
    if (throwOnGetUser) throw new Error('Auth transport failure')
    return { data: { user }, error: authError }
  })
  const createUser = vi.fn(async () => ({
    data: { user: { id: 'new-auth-user' } },
    error: null,
  }))
  const deleteUser = vi.fn(async () => ({ error: cleanupError }))
  const rpc = vi.fn(async () => ({ data: { news: true }, error: null }))

  const client = {
    auth: {
      getUser,
      admin: { createUser, deleteUser },
    },
    from(table) {
      fromCalls.push({ table, operations: [] })
      const call = fromCalls[fromCalls.length - 1]
      const builder = {
        select(value) {
          call.operations.push(['select', value])
          return builder
        },
        eq(column, value) {
          call.operations.push(['eq', column, value])
          return builder
        },
        maybeSingle: vi.fn(async () => ({
          data: lookupError || (admin?.is_active === false && call.operations.some(([operation, column, value]) => (
            operation === 'eq' && column === 'is_active' && value === true
          ))) ? null : admin,
          error: lookupError,
        })),
        order: vi.fn(async () => ({ data: [{ id: 'staff-1' }], error: null })),
        insert: vi.fn(async data => {
          call.insertData = data
          return { error: insertError }
        }),
        update: vi.fn(() => builder),
      }
      call.builder = builder
      return builder
    },
    rpc,
  }
  harness.createClient.mockReturnValue(client)
  return { client, fromCalls, getUser, createUser, deleteUser, rpc }
}

function makeResponse() {
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

async function invoke({
  token = 'signed-supabase-token',
  body = { action: 'verify' },
} = {}) {
  const res = makeResponse()
  await handler({
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  }, res)
  return res
}

describe('admin-auth handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects a missing bearer token without querying admin data', async () => {
    const mock = makeHarness()
    const res = await invoke({ token: null })

    expect(res.statusCode).toBe(401)
    expect(mock.getUser).not.toHaveBeenCalled()
    expect(mock.fromCalls).toHaveLength(0)
  })

  it.each([
    ['expired', 'expired-token'],
    ['fabricated', 'fabricated-token'],
  ])('rejects an %s token before protected database work', async (_label, token) => {
    const mock = makeHarness({ authError: new Error('Invalid JWT') })
    const res = await invoke({ token, body: { action: 'create_staff' } })

    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBe('Invalid or expired session')
    expect(res.body.error).not.toContain(token)
    expect(mock.fromCalls).toHaveLength(0)
    expect(mock.createUser).not.toHaveBeenCalled()
  })

  it('fails closed when Supabase Auth validation throws', async () => {
    const mock = makeHarness({ throwOnGetUser: true })
    const res = await invoke()

    expect(res.statusCode).toBe(401)
    expect(mock.fromCalls).toHaveLength(0)
  })

  it('resolves the active admin by Auth user id even if the Auth email changed', async () => {
    const mock = makeHarness()
    const res = await invoke()

    expect(res.statusCode).toBe(200)
    expect(res.body.admin).toEqual({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'super_admin',
      is_active: true,
    })
    expect(mock.fromCalls[0].operations).toContainEqual(['eq', 'auth_user_id', 'auth-user-1'])
    expect(mock.fromCalls[0].operations).not.toContainEqual(['eq', 'email', 'admin@example.com'])
    expect(mock.rpc).toHaveBeenCalledWith('get_admin_permissions', { p_admin_id: 'admin-1' })
  })

  it.each([
    ['non-admin', null, null],
    ['inactive admin', { id: 'admin-1', email: 'admin@example.com', role: 'super_admin', is_active: false }, null],
    ['admin lookup failure', null, new Error('database unavailable')],
  ])('denies a %s identity', async (_label, admin, lookupError) => {
    const mock = makeHarness({ admin, lookupError })
    const res = await invoke()

    expect(res.statusCode).toBe(lookupError ? 500 : 403)
    expect(mock.fromCalls).toHaveLength(1)
    expect(mock.rpc).not.toHaveBeenCalled()
  })

  it('enforces the database role even when the request body forges a super-admin role', async () => {
    const mock = makeHarness({
      admin: { id: 'admin-2', email: 'admin@example.com', role: 'moderator', is_active: true },
    })
    const res = await invoke({
      body: {
        action: 'list_staff',
        role: 'super_admin',
        adminId: 'admin-1',
        token: 'forged-base64-super-admin-token',
      },
    })

    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('Only super admin can view staff')
    expect(mock.fromCalls).toHaveLength(1)
    expect(mock.fromCalls[0].builder.order).not.toHaveBeenCalled()
  })

  it('provisions staff through Supabase Auth and records only the Auth identity', async () => {
    const mock = makeHarness()
    const res = await invoke({
      body: {
        action: 'create_staff',
        newEmail: ' New.Staff@Example.com ',
        newPassword: 'fresh-password',
        newName: 'New Staff',
        newRole: 'moderator',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mock.createUser).toHaveBeenCalledWith({
      email: 'new.staff@example.com',
      password: 'fresh-password',
      email_confirm: true,
    })
    expect(mock.fromCalls[1].insertData).toMatchObject({
      auth_user_id: 'new-auth-user',
      email: 'new.staff@example.com',
      created_by: 'admin-1',
    })
    expect(mock.fromCalls[1].insertData).not.toHaveProperty('password')
    expect(mock.body).toBeUndefined()
  })

  it('removes a newly-created Auth user when the admin record cannot be inserted', async () => {
    const mock = makeHarness({ insertError: new Error('admin row insert failed') })
    const res = await invoke({
      body: {
        action: 'create_staff',
        newEmail: 'new.staff@example.com',
        newPassword: 'fresh-password',
        newName: 'New Staff',
        newRole: 'moderator',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(mock.deleteUser).toHaveBeenCalledWith('new-auth-user')
    expect(res.body.error).not.toContain('fresh-password')
  })

  it('reports failed Auth cleanup after a staff insert failure', async () => {
    const mock = makeHarness({
      insertError: new Error('admin row insert failed'),
      cleanupError: new Error('delete failed'),
    })
    const res = await invoke({
      body: {
        action: 'create_staff',
        newEmail: 'new.staff@example.com',
        newPassword: 'fresh-password',
        newName: 'New Staff',
        newRole: 'moderator',
      },
    })

    expect(res.statusCode).toBe(500)
    expect(res.body.error).toMatch(/could not save.*clean up/i)
    expect(res.body.error).not.toContain('fresh-password')
  })
})
