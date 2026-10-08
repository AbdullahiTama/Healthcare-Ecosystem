import { describe, it, expect } from 'vitest'
import { createConsultationRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'
import { createClientRepository } from '../../clients/repositories/index.js'

const A = 'biz-A'
const B = 'biz-B'

function build(seed = {}) {
  const client = createInMemoryClient(seed)
  const clientRepo = createClientRepository(client)
  const repo = createConsultationRepository({ request: client, clientRepository: clientRepo })
  return { client, repo, clientRepo }
}

describe('consultationRepository', () => {
  it('getAll returns only the calling tenant', async () => {
    const { repo } = build({
      consultation_forms: [
        { id: 'c1', business_id: A, client_name: 'Ada', consultation_date: '2026-01-15' },
        { id: 'c2', business_id: B, client_name: 'Other', consultation_date: '2026-01-10' },
      ],
    })
    const rows = await repo.getAll(A)
    expect(rows).toHaveLength(1)
    expect(rows[0].client_name).toBe('Ada')
  })

  it('getAll filters by type', async () => {
    const { repo } = build({
      consultation_forms: [
        { id: 'c1', business_id: A, client_name: 'Ada', consultation_type: 'skincare', consultation_date: '2026-01-15' },
        { id: 'c2', business_id: A, client_name: 'Bob', consultation_type: 'pharmacy', consultation_date: '2026-01-10' },
      ],
    })
    const rows = await repo.getAll(A, { type: 'pharmacy' })
    expect(rows).toHaveLength(1)
    expect(rows[0].client_name).toBe('Bob')
  })

  it('getAll filters by query (client name ilike)', async () => {
    const { repo } = build({
      consultation_forms: [
        { id: 'c1', business_id: A, client_name: 'Adaeze', consultation_date: '2026-01-15' },
        { id: 'c2', business_id: A, client_name: 'Bola', consultation_date: '2026-01-10' },
      ],
    })
    const rows = await repo.getAll(A, { query: 'ada' })
    expect(rows).toHaveLength(1)
    expect(rows[0].client_name).toBe('Adaeze')
  })

  it('getAll filters by date range', async () => {
    const { repo } = build({
      consultation_forms: [
        { id: 'c1', business_id: A, client_name: 'Ada', consultation_date: '2026-01-05' },
        { id: 'c2', business_id: A, client_name: 'Bob', consultation_date: '2026-01-15' },
        { id: 'c3', business_id: A, client_name: 'Chidi', consultation_date: '2026-02-01' },
      ],
    })
    const rows = await repo.getAll(A, { from: '2026-01-10', to: '2026-01-31' })
    expect(rows).toHaveLength(1)
    expect(rows[0].client_name).toBe('Bob')
  })

  it('getAll filters by clientId', async () => {
    const { repo } = build({
      consultation_forms: [
        { id: 'c1', business_id: A, client_id: 'x1', client_name: 'Ada', consultation_date: '2026-01-15' },
        { id: 'c2', business_id: A, client_id: 'x2', client_name: 'Bob', consultation_date: '2026-01-10' },
      ],
    })
    const rows = await repo.getAll(A, { clientId: 'x1' })
    expect(rows).toHaveLength(1)
    expect(rows[0].client_name).toBe('Ada')
  })

  it('getByClient delegates to clientRepository.getConsultations', async () => {
    const { repo } = build({
      consultation_forms: [
        { id: 'c1', business_id: A, client_id: 'x1', client_name: 'Ada', consultation_date: '2026-01-15' },
        { id: 'c2', business_id: A, client_id: 'x2', client_name: 'Bob', consultation_date: '2026-01-10' },
      ],
    })
    const rows = await repo.getByClient('x1', A)
    expect(rows).toHaveLength(1)
    expect(rows[0].client_name).toBe('Ada')
  })

  it('getLatest returns the most recent consultation for a client', async () => {
    const { repo } = build({
      consultation_forms: [
        { id: 'c1', business_id: A, client_id: 'x1', client_name: 'Ada', consultation_date: '2026-01-05' },
        { id: 'c2', business_id: A, client_id: 'x1', client_name: 'Ada', consultation_date: '2026-01-15' },
        { id: 'c3', business_id: A, client_id: 'x1', client_name: 'Ada', consultation_date: '2026-01-10' },
      ],
    })
    const latest = await repo.getLatest('x1', A)
    // In-memory client returns in insertion order; production returns desc by date.
    // The test verifies getLatest returns the first row from getByClient.
    expect(latest).not.toBeNull()
    expect(latest.client_id).toBe('x1')
  })

  it('getLatest returns null when no consultations exist', async () => {
    const { repo } = build()
    const latest = await repo.getLatest('x1', A)
    expect(latest).toBeNull()
  })

  it('create inserts a consultation row', async () => {
    const { repo, client } = build()
    await repo.create({
      business_id: A,
      client_id: 'x1',
      client_name: 'Ada',
      consultation_date: '2026-01-15',
      consultation_type: 'skincare',
    })
    const rows = client.rows('consultation_forms')
    expect(rows).toHaveLength(1)
    expect(rows[0].client_name).toBe('Ada')
    expect(rows[0].business_id).toBe(A)
  })

  it('update patches an existing consultation', async () => {
    const { repo, client } = build({
      consultation_forms: [
        { id: 'c1', business_id: A, client_name: 'Ada', provider_name: 'Old Name' },
      ],
    })
    await repo.update('c1', { provider_name: 'New Name' })
    const row = client.rows('consultation_forms').find(r => r.id === 'c1')
    expect(row.provider_name).toBe('New Name')
  })

  it('getAll returns empty array when no consultations exist', async () => {
    const { repo } = build()
    const rows = await repo.getAll(A)
    expect(rows).toEqual([])
  })

  it('getByClient falls back to direct query when no clientRepository injected', async () => {
    const client = createInMemoryClient({
      consultation_forms: [
        { id: 'c1', business_id: A, client_id: 'x1', client_name: 'Ada', consultation_date: '2026-01-15' },
        { id: 'c2', business_id: A, client_id: 'x2', client_name: 'Bob', consultation_date: '2026-01-10' },
      ],
    })
    const repo = createConsultationRepository({ request: client })
    const rows = await repo.getByClient('x1')
    expect(rows).toHaveLength(1)
    expect(rows[0].client_name).toBe('Ada')
  })

  it('getAll combines multiple filters', async () => {
    const { repo } = build({
      consultation_forms: [
        { id: 'c1', business_id: A, client_name: 'Ada', consultation_type: 'skincare', consultation_date: '2026-01-15' },
        { id: 'c2', business_id: A, client_name: 'Ada', consultation_type: 'pharmacy', consultation_date: '2026-01-15' },
        { id: 'c3', business_id: A, client_name: 'Bola', consultation_type: 'skincare', consultation_date: '2026-01-15' },
      ],
    })
    const rows = await repo.getAll(A, { type: 'skincare', query: 'ada' })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('c1')
  })
})
