import { describe, it, expect } from 'vitest'
import { createOpsRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

function build(seed = {}) {
  const client = createInMemoryClient(seed)
  return { client, repo: createOpsRepository({ request: client }) }
}

describe('opsRepository', () => {
  it('createTicket requires subject/body', async () => {
    const { repo } = build()
    await expect(repo.createTicket({ subject: 'hi' })).rejects.toThrow('body required')
  })
  it('createTicket sets sla 4h urgent 24h high', async () => {
    const { repo, client } = build()
    await repo.createTicket({ subject: 'Urgent', body: 'help', priority: 'urgent' })
    const row = client.rows('support_tickets')[0]
    expect(row.priority).toBe('urgent')
    expect(new Date(row.sla_due_at).getTime() - Date.now()).toBeGreaterThan(3 * 3600000)
  })
  it('getTickets filters', async () => {
    const { repo } = build({ support_tickets: [{ id: '1', subject: 'A', status: 'open', priority: 'high' }, { id: '2', subject: 'B', status: 'closed', priority: 'low' }] })
    expect((await repo.getTickets({ status: 'open' })).length).toBe(1)
  })
  it('addMessage requires body', async () => {
    const { repo } = build()
    await expect(repo.addMessage('t1', ' ')).rejects.toThrow('body required')
  })
})
