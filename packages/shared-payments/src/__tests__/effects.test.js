import { describe, it, expect, vi } from 'vitest'
import { createSettlementEffects } from '../index.js'

// The best-effort effects after a settlement: every branch must either send exactly the right email or quietly do nothing, and none may
// ever throw into the settlement that already committed.
function fake({ tables = {}, users = {}, authThrows = false } = {}) {
  const inserts = []
  const from = (table) => {
    const st = { filters: [] }
    const rows = () => (tables[table] || []).filter((r) => st.filters.every(([k, v]) => r[k] === v))
    const b = {
      select: () => b,
      eq: (k, v) => { st.filters.push([k, v]); return b },
      insert: async (row) => { inserts.push([table, row]); return { error: null } },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    }
    return b
  }
  return { from, rpc: async () => ({}), inserts, auth: { admin: { getUserById: async (id) => { if (authThrows) throw new Error('auth down'); return { data: { user: users[id] || null } } } } } }
}
const setup = (opts = {}, send) => {
  const sent = []
  const sb = fake(opts)
  const logger = { error: vi.fn() }
  const run = createSettlementEffects({ supabase: sb, send: send || (async (m) => { sent.push(m) }), logger })
  return { run, sent, sb, logger }
}
const settled = (purpose, intent) => ({ outcome: 'settled', purpose, intent })
const intent = (over = {}) => ({ reference: 'ref_00000001', customer_id: 'u1', entity_id: 'e1', business_id: 'b1', expected_amount: 500000, metadata: { coins: 5 }, ...over })

describe('effects: the paths around the happy ones', () => {
  it('a user lookup that THROWS is the same as no email address: nothing is sent and nothing throws', async () => {
    const { run, sent } = setup({ authThrows: true })
    for (const p of ['wallet_topup', 'creator_subscription', 'consultation']) await expect(run(settled(p, intent()))).resolves.toBeUndefined()
    expect(sent).toEqual([])
  })

  it('a payer with no email address gets no email (top-up, subscription, consultation)', async () => {
    const { run, sent } = setup({ users: { u1: { email: null } } })
    for (const p of ['wallet_topup', 'creator_subscription', 'consultation']) await run(settled(p, intent()))
    expect(sent).toEqual([])
  })

  it('subscription: the creator name and the number of coins go into one email, keyed by the reference', async () => {
    const { run, sent } = setup({ users: { u1: { email: 'a@b.com' } }, tables: { profiles: [{ id: 'e1', display_name: 'Dr Obi', full_name: 'Obi' }, { id: 'u1', full_name: 'Ada' }] } })
    await run(settled('creator_subscription', intent({ metadata: { coins: 8 } })))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ templateKey: 'subscription_created', toEmail: 'a@b.com', idempotencyKey: 'subscription-started:ref_00000001' })
    expect(sent[0].payload).toMatchObject({ fullName: 'Ada', plan: '8 CareCoins', businessName: 'Dr Obi' })
  })

  it('subscription with no profiles on file still sends, with neutral names', async () => {
    const { run, sent } = setup({ users: { u1: { email: 'a@b.com' } } })
    await run(settled('creator_subscription', intent()))
    expect(sent[0].payload).toMatchObject({ fullName: 'There', businessName: 'Creator' })
  })

  it('consultation: one confirmation to the patient, keyed by the reference', async () => {
    const { run, sent } = setup({ users: { u1: { email: 'a@b.com', user_metadata: { full_name: 'Ada' } } } })
    await run(settled('consultation', intent()))
    expect(sent[0]).toMatchObject({ templateKey: 'consultation_confirmed', toEmail: 'a@b.com', idempotencyKey: 'consultation-confirmed:ref_00000001' })
    expect(sent[0].payload.fullName).toBe('Ada')
  })

  it('booking: the business is told even if the client has no email; a missing appointment does nothing', async () => {
    const appt = { id: 'e1', business_id: 'b1', client_name: 'Ada', date: '2026-10-10', time: '10:00', fee_amount: 100000, client_email: null, client_id: null, service: 'Checkup', source: 'carefind' }
    const { run, sent, sb } = setup({ tables: { appointments: [appt] } })
    await run(settled('booking', intent()))
    expect(sb.inserts.map(([t, r]) => [t, r.kind])).toEqual([['staff_notifications', 'booking_paid']])
    expect(sent).toEqual([])
    const none = setup({})
    await none.run(settled('booking', intent()))
    expect(none.sb.inserts).toEqual([])
    expect(none.sent).toEqual([])
  })

  it('booking: the client address is read from the clients table when the appointment has none, and a CareHub appointment uses its own template', async () => {
    const appt = { id: 'e1', business_id: 'b1', client_name: 'Ada', date: '2026-10-10', time: '10:00', fee_amount: 100000, client_email: null, client_id: 'c1', service: null, source: 'carehub' }
    const { run, sent } = setup({ tables: { appointments: [appt], clients: [{ id: 'c1', email: 'ada@x.com' }], businesses: [{ id: 'b1', name: 'Clinic' }] } })
    await run(settled('appointment', intent()))                // a CareHub appointment and a CareFind booking share one effect
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ templateKey: 'appointment_confirmed', toEmail: 'ada@x.com', sourceId: 'e1' })
    expect(sent[0].payload).toMatchObject({ businessName: 'Clinic', service: 'Consultation', staffName: '' })
  })

  it('booking: an address that is not an address is not mailed', async () => {
    const appt = { id: 'e1', business_id: 'b1', client_name: 'Ada', date: 'd', time: 't', fee_amount: 1, client_email: 'not-an-address', client_id: null, source: 'carefind' }
    const { run, sent } = setup({ tables: { appointments: [appt] } })
    await run(settled('booking', intent()))
    expect(sent).toEqual([])
  })

  it('plan renewal: the owner is told; a business with no address (or none at all) is not', async () => {
    const { run, sent } = setup({ tables: { businesses: [{ id: 'b1', name: 'Clinic', plan: 'Pro', plan_expires_at: '2027-01-02T00:00:00Z', owner_name: 'Ada', owner_email: 'o@x.com' }] } })
    await run(settled('plan_renewal', intent()))
    expect(sent[0]).toMatchObject({ templateKey: 'subscription_created', toEmail: 'o@x.com' })
    expect(sent[0].payload).toMatchObject({ fullName: 'Ada', plan: 'Pro', businessName: 'Clinic' })
    expect(sent[0].payload.expiryDate).toMatch(/2027/)
    const none = setup({ tables: { businesses: [{ id: 'b1', name: 'Clinic' }] } })
    await none.run(settled('plan_renewal', intent()))
    const missing = setup({})
    await missing.run(settled('plan_renewal', intent()))
    expect(none.sent).toEqual([]); expect(missing.sent).toEqual([])
  })

  it('a send that throws is logged with the template and never propagates (the settlement stands)', async () => {
    const { run, logger } = setup({ users: { u1: { email: 'a@b.com' } } }, async () => { throw new Error('smtp down') })
    await expect(run(settled('wallet_topup', intent()))).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith('settlement.email.failed', { template: 'payment_success', message: 'smtp down' })
  })
})
