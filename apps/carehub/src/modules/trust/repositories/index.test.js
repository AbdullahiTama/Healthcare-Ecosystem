import { describe, it, expect } from 'vitest'
import { createTrustRepository, slaTone } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

function build(seed = {}) {
  const client = createInMemoryClient(seed)
  return { client, repo: createTrustRepository({ request: client }) }
}

describe('trustRepository', () => {
  it('getTrustQueue merges 4 sources sorted desc', async () => {
    const { repo } = build({
      verification_requests: [{ id: 'v1', status: 'pending', created_at: '2026-09-08T10:00:00Z', full_name: 'Ada' }],
      business_claims: [{ id: 'c1', status: 'pending', created_at: '2026-09-08T11:00:00Z' }],
      reports: [{ id: 'r1', status: 'pending', created_at: '2026-09-08T09:00:00Z', reason: 'spam' }],
      moderation_appeals: [{ id: 'a1', status: 'open', created_at: '2026-09-08T12:00:00Z', reason: 'please restore' }],
    })
    const q = await repo.getTrustQueue()
    expect(q.length).toBe(4)
    expect(q[0].type).toBe('appeal') // latest first
    expect(q.map(i => i.type)).toContain('verification')
  })

  it('SLA overdue and urgent', async () => {
    const old = new Date(Date.now() - 25 * 3600000).toISOString()
    const { repo } = build({ verification_requests: [{ id: 'v1', status: 'pending', created_at: old }] })
    const q = await repo.getTrustQueue()
    expect(q[0].overdue).toBe(true)
    expect(slaTone(q[0])).toBe('red')
  })

  it('logModeration requires fields', async () => {
    const { repo } = build()
    await expect(repo.logModeration({ target_type: 'post', target_id: 'p1', action: 'quarantine' })).rejects.toThrow('reason required')
  })

  it('quarantinePost patches and logs', async () => {
    const { repo, client } = build({ posts: [{ id: 'p1', content: 'hi', is_quarantined: false }] })
    await repo.quarantinePost('p1', 'spam', null)
    expect(client.rows('posts')[0].is_quarantined).toBe(true)
    expect(client.rows('moderation_actions')[0]).toMatchObject({ target_type: 'post', action: 'quarantine', reason: 'spam' })
  })

  it('getVerifications catches and returns [] on failure', async () => {
    const repo = createTrustRepository({ request: async () => { throw new Error('42501') } })
    const rows = await repo.getVerifications()
    expect(rows).toEqual([])
  })

  it('getStaffClaims and updateClaim', async () => {
    const { repo, client } = build({ staff_claims: [{ id: 's1', status: 'pending' }], business_claims: [{ id: 'c1', status: 'pending' }] })
    expect((await repo.getStaffClaims()).length).toBe(1)
    await repo.updateBusinessClaim('c1', { status: 'approved' })
    expect(client.rows('business_claims')[0].status).toBe('approved')
    await repo.updateStaffClaim('s1', { status: 'rejected' })
    expect(client.rows('staff_claims')[0].status).toBe('rejected')
  })

  it('createAdrDraft requires business_id', async () => {
    const { repo } = build()
    await expect(repo.createAdrDraft({ product_name: 'X' })).rejects.toThrow('business_id required')
  })

  it('getProductReviews and flagReview', async () => {
    const { repo, client } = build({ product_reviews: [{ id: 'r1', product_id: 'p1', rating: 1, comment: 'rash' }] })
    expect((await repo.getProductReviews({ product_id: 'p1' })).length).toBe(1)
    await repo.flagReview('r1', { is_flagged: true })
    expect(client.rows('product_reviews')[0].is_flagged).toBe(true)
  })
})
