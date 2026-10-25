import { describe, it, expect } from 'vitest'
import { createAuditRepository } from './index.js'

const throwing = (msg) => async () => { throw new Error(msg) }

describe('auditRepository.recordExport', () => {
  it('calls the RPC with the business, type, count and filters', async () => {
    const calls = []
    const repo = createAuditRepository({ request: async (path, opts) => { calls.push({ path, body: JSON.parse(opts.body), method: opts.method }); return 'audit-1' } })
    const out = await repo.recordExport('biz-A', { exportType: 'inventory.xlsx', rowCount: 7, filters: { category: 'Medicines' } })
    expect(out).toEqual({ status: 'recorded', id: 'audit-1' })
    expect(calls).toEqual([{ path: 'rpc/record_export_audit', method: 'POST', body: { p_business_id: 'biz-A', p_export_type: 'inventory.xlsx', p_row_count: 7, p_filters: { category: 'Medicines' } } }])
  })

  it('never sends an actor: identity comes from the session, not the client', async () => {
    let body
    const repo = createAuditRepository({ request: async (_p, o) => { body = JSON.parse(o.body); return 'x' } })
    await repo.recordExport('biz-A', { exportType: 'inventory.xlsx', rowCount: 0 })
    expect(Object.keys(body).sort()).toEqual(['p_business_id', 'p_export_type', 'p_filters', 'p_row_count'])
    expect(body.p_filters).toEqual({})
  })

  it.each([
    ['Supabase error (403): Your role is not allowed to export data'],
    ['Supabase error (403): You are not an active member of this business'],
  ])('maps a database refusal to "refused": %s', async (msg) => {
    const repo = createAuditRepository({ request: throwing(msg) })
    expect((await repo.recordExport('b', { exportType: 'inventory.xlsx', rowCount: 1 })).status).toBe('refused')
  })

  it('maps a missing function (migration not applied) to "unavailable"', async () => {
    const a = createAuditRepository({ request: throwing('Supabase error (404): Could not find the function public.record_export_audit') })
    const b = createAuditRepository({ request: throwing('PGRST202') })
    expect((await a.recordExport('b', { exportType: 'inventory.xlsx', rowCount: 1 })).status).toBe('unavailable')
    expect((await b.recordExport('b', { exportType: 'inventory.xlsx', rowCount: 1 })).status).toBe('unavailable')
  })

  it('maps anything else to "failed" and does not throw', async () => {
    for (const msg of ['Failed to fetch', 'Supabase error (500): boom', 'Session expired. Please log in again.']) {
      const repo = createAuditRepository({ request: throwing(msg) })
      expect((await repo.recordExport('b', { exportType: 'inventory.xlsx', rowCount: 1 })).status).toBe('failed')
    }
  })
})
