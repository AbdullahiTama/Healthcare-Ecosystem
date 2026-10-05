// Phase 11: the admin actions that list reconciliation findings, record a person's decision, and run a pass now. Authentication is
// not what is under test (requireAdmin is mocked); what is: validation, that the acting admin is recorded, and that nothing but the
// database functions is touched.
const h = vi.hoisted(() => ({ createClient: vi.fn(), run: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: h.createClient }))
vi.mock('../_lib/emailService.js', () => ({ processBatch: vi.fn() }))
vi.mock('../_lib/withdrawalAdmin.js', () => ({ decideAdminApprove: vi.fn(), decideAdminReject: vi.fn() }))
vi.mock('../_lib/requireAdmin.js', () => ({ requireAdmin: async () => ({ admin: { id: 'admin-1', role: 'super_admin' } }) }))
vi.mock('../_lib/financeReconcile.js', () => ({ runFinanceReconciliation: h.run }))

import handler from './admin-auth.js'

let rpc
const call = async (body) => {
  const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this }, json(v) { this.body = v; return this } }
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res)
  return res
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://supabase.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test-key')
  rpc = vi.fn(async () => ({ data: [], error: null }))
  h.createClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } }, error: null }) }, rpc })
  h.run.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe('admin_list_reconciliation', () => {
  it('lists open findings by default and a status when asked', async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: 'f1', severity: 'critical' }], error: null })
    const r = await call({ action: 'admin_list_reconciliation' })
    expect(r.statusCode).toBe(200)
    expect(r.body.data).toEqual([{ id: 'f1', severity: 'critical' }])
    expect(rpc).toHaveBeenCalledWith('list_reconciliation_findings', { p_status: null, p_limit: 200 })
    await call({ action: 'admin_list_reconciliation', status: 'dismissed' })
    expect(rpc).toHaveBeenLastCalledWith('list_reconciliation_findings', { p_status: 'dismissed', p_limit: 200 })
  })

  it('refuses an unknown status and hides a database error', async () => {
    expect((await call({ action: 'admin_list_reconciliation', status: 'everything' })).statusCode).toBe(400)
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "reconciliation_findings" secret detail' } })
    const r = await call({ action: 'admin_list_reconciliation' })
    expect(r.statusCode).toBe(500)
    expect(JSON.stringify(r.body)).not.toMatch(/secret detail/)
  })
})

describe('admin_update_reconciliation_finding', () => {
  it('records the acting admin with the decision', async () => {
    rpc.mockResolvedValueOnce({ data: 'ok', error: null })
    const r = await call({ action: 'admin_update_reconciliation_finding', id: 'f1', op: 'dismiss', note: 'another integration on the account' })
    expect(r).toMatchObject({ statusCode: 200, body: { success: true, result: 'ok' } })
    expect(rpc).toHaveBeenCalledWith('update_reconciliation_finding', { p_id: 'f1', p_action: 'dismiss', p_note: 'another integration on the account', p_by: 'admin-1' })
  })

  it('needs an id and a known op; a dismissal needs a real note; a missing finding is 404', async () => {
    expect((await call({ action: 'admin_update_reconciliation_finding', op: 'dismiss', note: 'long enough' })).statusCode).toBe(400)
    expect((await call({ action: 'admin_update_reconciliation_finding', id: 'f1', op: 'delete' })).statusCode).toBe(400)
    expect((await call({ action: 'admin_update_reconciliation_finding', id: 'f1', op: 'dismiss', note: 'no' })).statusCode).toBe(400)
    expect((await call({ action: 'admin_update_reconciliation_finding', id: 'f1', op: 'dismiss', note: '    ' })).statusCode).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValueOnce({ data: 'not_found', error: null })
    expect((await call({ action: 'admin_update_reconciliation_finding', id: 'f1', op: 'acknowledge' })).statusCode).toBe(404)
  })

  it('truncates a very long note', async () => {
    await call({ action: 'admin_update_reconciliation_finding', id: 'f1', op: 'acknowledge', note: 'x'.repeat(2000) })
    expect(rpc.mock.calls[0][1].p_note).toHaveLength(500)
  })
})

describe('admin_run_reconciliation', () => {
  it('runs a pass and returns the report; a failed step makes it a 207 (partial)', async () => {
    h.run.mockResolvedValueOnce({ failed: [], db: { totals: { open_critical: 0 } } })
    expect((await call({ action: 'admin_run_reconciliation' })).statusCode).toBe(200)
    expect(h.run).toHaveBeenCalledWith(expect.anything(), { force: true })        // an administrator pressing the button is never throttled
    h.run.mockResolvedValueOnce({ failed: ['provider'], db: null })
    const r = await call({ action: 'admin_run_reconciliation' })
    expect(r.statusCode).toBe(207)
    expect(r.body.report.failed).toEqual(['provider'])
  })
})
