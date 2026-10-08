// The wiring of the reconciliation pass: the replay must use the SAME processor as the live webhook, a payment the pass settles must
// run the same side effects the webhook runs, and the alert must reach every active administrator through the email catalog.
const h = vi.hoisted(() => ({ runReconciliation: vi.fn(), processWebhookEvent: vi.fn(), runSettlementEffects: vi.fn(), provider: { name: 'paystack' } }))
vi.mock('@care-ecosystem/shared-payments', () => ({ runReconciliation: h.runReconciliation }))
vi.mock('../payments.js', () => ({ getPaystackProvider: () => h.provider, paymentLogger: { info() {}, warn() {}, error() {} } }))
vi.mock('../webhookProcessor.js', () => ({ processWebhookEvent: h.processWebhookEvent }))
vi.mock('../settlementEffects.js', () => ({ runSettlementEffects: h.runSettlementEffects }))

import { runFinanceReconciliation, buildAlertPayload, alertRecipients, createFinanceAlertSender } from '../financeReconcile.js'

const client = ({ admins = [{ email: 'Boss@Example.com' }, { email: 'ops@example.com' }], adminError = null, rpc } = {}) => {
  const calls = []
  return {
    calls,
    from: (table) => ({ select: () => ({ eq: async () => { calls.push(['from', table]); return { data: adminError ? null : admins, error: adminError } } }) }),
    rpc: rpc || (async (name, args) => { calls.push([name, args]); return { data: 'outbox-id', error: null } }),
  }
}
const finding = (over = {}) => ({ id: 'f', kind: 'unmatched_charge', subject_id: 'ref_1', detail: 'Paystack reported\n a charge of 2500.00 NGN', ...over })

describe('runFinanceReconciliation', () => {
  it('hands the engine the live webhook processor, the settlement effects and an alert sender', async () => {
    h.runReconciliation.mockResolvedValue({ failed: [] })
    const supabase = client()
    expect(await runFinanceReconciliation(supabase)).toEqual({ failed: [] })
    const [sb, provider, opts] = h.runReconciliation.mock.calls[0]
    expect(sb).toBe(supabase)
    expect(provider).toBe(h.provider)
    expect(opts.force).toBe(false)
    await opts.processEvent({ event: 'charge.success' })
    expect(h.processWebhookEvent).toHaveBeenCalledWith(supabase, { event: 'charge.success' })
    await opts.onSettled({ outcome: 'settled' })
    expect(h.runSettlementEffects).toHaveBeenCalledWith(supabase, { outcome: 'settled' })
    expect(typeof opts.sendAlert).toBe('function')
  })

  it('"run now" forces every step', async () => {
    h.runReconciliation.mockResolvedValue({ failed: [] })
    await runFinanceReconciliation(client(), { force: true })
    expect(h.runReconciliation.mock.calls.at(-1)[2].force).toBe(true)
  })
})

describe('buildAlertPayload', () => {
  it('is flat strings: the count, one line per finding (single-spaced, capped), and how many are not shown', () => {
    const p = buildAlertPayload([finding(), finding({ kind: 'event_failed', subject_id: 'e2', detail: 'x'.repeat(1000) })])
    expect(p.critical_count).toBe('2')
    expect(p.more_count).toBe('0')
    const lines = p.lines.split('\n')
    expect(lines[0]).toBe('unmatched charge (ref_1): Paystack reported a charge of 2500.00 NGN')
    expect(lines[1].length).toBeLessThanOrEqual(300)
    expect(Object.values(p).every((v) => typeof v === 'string')).toBe(true)
  })

  it('shows at most 12 findings and says how many more there are', () => {
    const p = buildAlertPayload(Array.from({ length: 30 }, (_, i) => finding({ subject_id: `r${i}` })))
    expect(p.lines.split('\n')).toHaveLength(12)
    expect(p).toMatchObject({ critical_count: '30', more_count: '18' })
    expect(p.lines.length).toBeLessThanOrEqual(4000)
  })
})

describe('alertRecipients', () => {
  it('is every active administrator plus FINANCE_ALERT_EMAILS, lower-cased and de-duplicated, ignoring anything that is not an address', async () => {
    const r = await alertRecipients(client(), { FINANCE_ALERT_EMAILS: 'OPS@example.com, finance@example.com, not-an-email, ' })
    expect(r.sort()).toEqual(['boss@example.com', 'finance@example.com', 'ops@example.com'])
  })
  it('fails loudly if the administrators cannot be read', async () => {
    await expect(alertRecipients(client({ adminError: { message: 'denied' } }), {})).rejects.toThrow(/could not read the administrators: denied/)
  })
})

describe('createFinanceAlertSender', () => {
  it('queues the catalog event for each recipient with its own source id', async () => {
    const supabase = client()
    await createFinanceAlertSender(supabase, { env: {} })([finding(), finding({ subject_id: 'r2' })])
    const calls = supabase.calls.filter(([n]) => n === 'enqueue_business_email_event')
    expect(calls).toHaveLength(2)
    expect(calls.map(([, a]) => a.p_to_email).sort()).toEqual(['boss@example.com', 'ops@example.com'])
    for (const [, a] of calls) expect(a).toMatchObject({ p_app: 'carefind', p_event_key: 'finance_alert', p_payload: { critical_count: '2' } })
    expect(new Set(calls.map(([, a]) => a.p_source_id)).size).toBe(2)
  })

  it('succeeds if at least one recipient was queued, and throws if none was (so the claim is released and retried)', async () => {
    let n = 0
    const some = client({ rpc: async () => ({ data: ++n === 1 ? 'id' : null, error: n === 1 ? null : { message: 'bad address' } }) })
    await expect(createFinanceAlertSender(some, { env: {} })([finding()])).resolves.toBeUndefined()
    const none = client({ rpc: async () => ({ data: null, error: null }) })       // the catalog suppressed the event
    await expect(createFinanceAlertSender(none, { env: {} })([finding()])).rejects.toThrow(/not queued/)
    const failing = client({ rpc: async () => ({ data: null, error: { message: 'unknown_catalog_event' } }) })
    await expect(createFinanceAlertSender(failing, { env: {} })([finding()])).rejects.toThrow(/not queued/)
  })

  it('throws when there is nobody to tell', async () => {
    await expect(createFinanceAlertSender(client({ admins: [] }), { env: {} })([finding()])).rejects.toThrow(/no administrator email/)
  })
})
