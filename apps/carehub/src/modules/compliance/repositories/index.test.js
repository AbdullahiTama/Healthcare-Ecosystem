import { describe, it, expect } from 'vitest'
import { createComplianceRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

function build(seed = {}) {
  const client = createInMemoryClient(seed)
  return { client, repo: createComplianceRepository({ request: client }) }
}

describe('complianceRepository', () => {
  it('createRequest requires fields', async () => {
    const { repo } = build()
    await expect(repo.createRequest({ subject_id: 'a' })).rejects.toThrow('reason required')
  })
  it('createRequest writes', async () => {
    const { repo, client } = build()
    await repo.createRequest({ subject_type: 'business', subject_id: 'biz-1', request_type: 'export', reason: 'GDPR' })
    expect(client.rows('compliance_requests')[0].subject_id).toBe('biz-1')
  })
  it('getRequests filters', async () => {
    const { repo } = build({ compliance_requests: [{ id: '1', status: 'open', request_type: 'export' }, { id: '2', status: 'completed', request_type: 'delete' }] })
    expect((await repo.getRequests({ status: 'open' })).length).toBe(1)
  })
})
