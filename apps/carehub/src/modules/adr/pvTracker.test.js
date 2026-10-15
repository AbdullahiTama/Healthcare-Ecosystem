import { describe, it, expect } from 'vitest'
import { createAdrReportRepository } from './repositories/index.js'

const BIZ = 'biz-1'
const REPORT = 'report-1'
const ROUTE = 'route-1'

function recordingRepo() {
  const calls = []
  const repo = createAdrReportRepository({
    request: async (path, options) => {
      calls.push({ path, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null })
      return []
    },
  })
  return { calls, repo }
}

describe('adrReportRepository PV Tracker methods', () => {
  it('getRoutedRoutes lists verified/routed assignments for the business', async () => {
    const { calls, repo } = recordingRepo()
    await repo.getRoutedRoutes(BIZ)
    expect(calls).toEqual([
      {
        path: `adr_product_company_routes?responsible_business_id=eq.${BIZ}&status=in.(verified,routed)&order=created_at.desc&select=*`,
        method: 'GET',
        body: null,
      },
    ])
  })

  it('getPvCase reads the masked view, never the base report row', async () => {
    const { calls, repo } = recordingRepo()
    await repo.getPvCase(REPORT)
    const paths = calls.map((c) => c.path)
    expect(paths.some((p) => p.startsWith('adr_pv_case_view?'))).toBe(true)
    expect(paths.some((p) => p.startsWith('adr_reports?'))).toBe(false)
  })

  it('updateRouteWorkflow posts the transition RPC and unwraps', async () => {
    const { calls, repo } = recordingRepo()
    await repo.updateRouteWorkflow(ROUTE, 'acknowledged', null)
    expect(calls).toEqual([
      {
        path: 'rpc/update_adr_route_workflow',
        method: 'POST',
        body: { p_route_id: ROUTE, p_status: 'acknowledged', p_note: null },
      },
    ])
  })

  it('requestRouteFollowup passes the idempotency key through', async () => {
    const { calls, repo } = recordingRepo()
    await repo.requestRouteFollowup(ROUTE, 'Please clarify the dose.', 'key-1')
    expect(calls[0].body).toEqual({
      p_route_id: ROUTE,
      p_message: 'Please clarify the dose.',
      p_idempotency_key: 'key-1',
    })
  })

  it('addRouteAssessment inserts an assessment row (author stamped server-side)', async () => {
    const { calls, repo } = recordingRepo()
    await repo.addRouteAssessment({ routeId: ROUTE, reportId: REPORT, assessment: 'Likely related.', actionTaken: 'Label review started.' })
    expect(calls[0].path).toBe('adr_route_assessments')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body.assessment).toBe('Likely related.')
    expect(calls[0].body).not.toHaveProperty('author_auth_user')
  })

  it('correctReportSource posts the audited correction RPC', async () => {
    const { calls, repo } = recordingRepo()
    await repo.correctReportSource(REPORT, 'business_facility', 'Channel verified from sign-in logs')
    expect(calls).toEqual([
      {
        path: 'rpc/correct_adr_report_source',
        method: 'POST',
        body: { p_report_id: REPORT, p_source: 'business_facility', p_reason: 'Channel verified from sign-in logs' },
      },
    ])
  })
})
