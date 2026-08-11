import { describe, it, expect } from 'vitest'
import { createAppointmentRepository, appointmentRepository } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    appointments: [
      { id: '1', business_id: A, client_name: 'Ada', date: '2026-08-10', time: '09:00', status: 'pending', source: 'carehub' },
      { id: '2', business_id: A, client_name: 'Bola', date: '2026-08-11', time: '14:30', status: 'confirmed', source: 'carefind' },
      { id: '9', business_id: B, client_name: 'Other tenant', date: '2026-08-10', time: '10:00', status: 'pending', source: 'carehub' },
    ],
  })
  return { client, repo: createAppointmentRepository(client) }
}

describe('appointmentRepository', () => {
  it('getAll returns only the calling tenant', async () => {
    const { repo } = seeded()
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.id).sort()).toEqual(['1', '2'])
    expect(rows.some((r) => r.business_id === B)).toBe(false)
  })

  // The table is written by both apps — CareFind books in with source
  // 'carefind' — so the repository must not filter those out.
  it('getAll includes appointments booked from CareFind', async () => {
    const { repo } = seeded()
    const rows = await repo.getAll(A)
    expect(rows.map((r) => r.source).sort()).toEqual(['carefind', 'carehub'])
  })

  it('create injects business_id', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { client_name: 'Chidi', date: '2026-09-01', time: '11:00', status: 'pending' })
    const created = client.rows('appointments').find((r) => r.client_name === 'Chidi')
    expect(created.business_id).toBe(A)
  })

  it('update scopes by id and business', async () => {
    const { repo, client } = seeded()
    await repo.update('1', A, { status: 'confirmed' })
    expect(client.rows('appointments').find((r) => r.id === '1').status).toBe('confirmed')
  })

  it('update leaves siblings in the same business untouched', async () => {
    const { repo, client } = seeded()
    await repo.update('1', A, { status: 'cancelled' })
    expect(client.rows('appointments').find((r) => r.id === '2').status).toBe('confirmed')
  })

  it('update never crosses the tenant boundary', async () => {
    const { repo, client } = seeded()
    await repo.update('9', A, { status: 'cancelled' })
    expect(client.rows('appointments').find((r) => r.id === '9').status).toBe('pending')
  })

  it('delete scopes by id and business', async () => {
    const { repo, client } = seeded()
    await repo.delete('1', A)
    expect(client.rows('appointments').map((r) => r.id)).not.toContain('1')
  })

  // Destructive and irreversible — the page calls this "cannot be undone" —
  // so the tenant filter matters more here than anywhere else in the aggregate.
  it('delete never crosses the tenant boundary', async () => {
    const { repo, client } = seeded()
    await repo.delete('9', A)
    expect(client.rows('appointments').map((r) => r.id)).toContain('9')
  })

  it('create passes through concern and payment fields', async () => {
    const { repo, client } = seeded()
    await repo.create(A, { client_name: 'Dami', date: '2026-09-01', time: '11:00', status: 'pending', concern: 'Skin rash', payment_status: 'unpaid', fee_amount: 50000 })
    const created = client.rows('appointments').find((r) => r.client_name === 'Dami')
    expect(created.concern).toBe('Skin rash')
    expect(created.payment_status).toBe('unpaid')
    expect(created.fee_amount).toBe(50000)
  })

  it('exports a default appointmentRepository instance', () => {
    for (const m of ['getAll', 'create', 'update', 'delete']) {
      expect(typeof appointmentRepository[m]).toBe('function')
    }
  })
})
