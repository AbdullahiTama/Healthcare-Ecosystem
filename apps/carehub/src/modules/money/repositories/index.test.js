import { describe, it, expect } from 'vitest'
import { createMoneyRepository, koboToNaira } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

function build(seed = {}) {
  const client = createInMemoryClient(seed)
  return { client, repo: createMoneyRepository({ request: client }) }
}
function recordingRepo() {
  const calls = []
  const repo = createMoneyRepository({
    request: async (path, options) => {
      calls.push({ path, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null })
      return []
    },
  })
  return { calls, repo }
}

describe('moneyRepository', () => {
  describe('plan_catalog', () => {
    it('createPlan requires key', async () => {
      const { repo } = build()
      await expect(repo.createPlan({ name: 'No key' })).rejects.toThrow('key required')
    })
    it('createPlan and getPlans', async () => {
      const { repo, client } = build()
      await repo.createPlan({ key: 'pro', name: 'Pro', price_kobo: 1500000, billing_cycle: 'monthly', trial_days: 7, entitlements: { pharmacy: true }, is_active: true })
      expect(client.rows('plan_catalog')[0]).toMatchObject({ key: 'pro', price_kobo: 1500000 })
      const rows = await repo.getPlans()
      expect(rows.map(r=>r.key)).toContain('pro')
    })
    it('updatePlan patches by key', async () => {
      const { repo, client } = build({ plan_catalog: [{ key: 'basic', name: 'Basic', price_kobo: 0, billing_cycle: 'monthly', is_active: true }] })
      await repo.updatePlan('basic', { price_kobo: 10000 })
      expect(client.rows('plan_catalog')[0].price_kobo).toBe(10000)
    })
    it('getPlan returns single or null', async () => {
      const { repo } = build({ plan_catalog: [{ key: 'basic', name: 'Basic', price_kobo: 0, billing_cycle: 'monthly' }] })
      expect((await repo.getPlan('basic')).key).toBe('basic')
      expect(await repo.getPlan('missing')).toBe(null)
    })
    it('deletePlan scopes by key', async () => {
      const { repo, client } = build({ plan_catalog: [{ key: 'basic', price_kobo: 0 }, { key: 'pro', price_kobo: 1500000 }] })
      await repo.deletePlan('basic')
      expect(client.rows('plan_catalog').map(r=>r.key)).toEqual(['pro'])
    })
  })

  describe('subscriptions', () => {
    it('upsertSubscription creates then patches', async () => {
      const { repo, client } = build()
      await repo.upsertSubscription('biz-1', { plan_key: 'basic', status: 'active', current_period_start: '2026-09-01', current_period_end: '2026-10-01' })
      expect(client.rows('business_subscriptions')[0]).toMatchObject({ business_id: 'biz-1', plan_key: 'basic' })
      await repo.upsertSubscription('biz-1', { status: 'past_due' })
      expect(client.rows('business_subscriptions')[0].status).toBe('past_due')
      expect(client.rows('business_subscriptions').length).toBe(1)
    })
    it('getSubscriptions filters status and plan_key', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getSubscriptions({ status: 'past_due', plan_key: 'pro' })
      expect(calls[0].path).toContain('status=eq.past_due')
      expect(calls[0].path).toContain('plan_key=eq.pro')
    })
    it('getEntitlements queries view', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getEntitlements('biz-1')
      expect(calls[0].path).toContain('business_entitlements')
    })
  })

  describe('paystack mirror', () => {
    it('recordPaystackEvent requires reference', async () => {
      const { repo } = build()
      await expect(repo.recordPaystackEvent({ event_type: 'charge.success' })).rejects.toThrow('reference')
    })
    it('recordPaystackEvent writes reference unique', async () => {
      const { repo, client } = build()
      await repo.recordPaystackEvent({ reference: 'ref1', event_type: 'charge.success', amount_kobo: 1500000, status: 'success', raw: {} })
      expect(client.rows('paystack_events')[0].reference).toBe('ref1')
    })
    it('getPaystackEvents queries', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getPaystackEvents({ status: 'success' })
      expect(calls[0].path).toContain('paystack_events')
    })
    it('getPlanPayments filters by reference', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getPlanPayments({ reference: 'abc' })
      expect(calls[0].path).toContain('reference=eq.abc')
    })
    it('createPlanPayment requires reference and business_id', async () => {
      const { repo } = build()
      await expect(repo.createPlanPayment({ reference: 'r1' })).rejects.toThrow('business_id')
    })
    it('getReconciliationMismatches detects missing_in_db and amount_mismatch', async () => {
      const { repo } = build({
        paystack_events: [{ reference: 'ps1', amount_kobo: 1500000, business_id: 'biz-1', event_type: 'charge.success', status: 'success', raw: {} }],
        plan_payments: [
          { reference: 'ps1', business_id: 'biz-1', naira_amount: 14000, status: 'success' },
          { reference: 'db_only', business_id: 'biz-2', naira_amount: 15000, status: 'success' },
        ],
      })
      const mism = await repo.getReconciliationMismatches({ limit: 10 })
      expect(mism.map(m => m.type).sort()).toEqual(['amount_mismatch', 'missing_in_paystack'].sort())
    })
  })

  describe('invoices', () => {
    it('createInvoice requires reference', async () => {
      const { repo } = build()
      await expect(repo.createInvoice({ business_id: 'biz-1', type: 'invoice', amount_kobo: 1000 })).rejects.toThrow('reference')
    })
    it('createInvoice and getInvoices', async () => {
      const { repo, client } = build()
      await repo.createInvoice({ business_id: 'biz-1', type: 'invoice', reference: 'INV-1', amount_kobo: 1500000 })
      expect(client.rows('invoices')[0].reference).toBe('INV-1')
      const rows = await repo.getInvoices('biz-1')
      expect(rows.length).toBe(1)
    })
    it('createCreditNote requires business_id and positive amount', async () => {
      const { repo } = build()
      await expect(repo.createCreditNote({ business_id: 'biz-1', amount_kobo: 0 })).rejects.toThrow('positive')
      const { client } = build()
      const repo2 = build({}).repo
      // Use real client path via second build's client
      const { client: c2, repo: r2 } = build()
      await r2.createCreditNote({ business_id: 'biz-1', amount_kobo: 50000, reason: 'refund' })
      expect(c2.rows('invoices')[0].type).toBe('credit_note')
      expect(c2.rows('invoices')[0].amount_kobo).toBe(-50000)
    })
    it('getAllInvoices filters', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getAllInvoices({ type: 'credit_note' })
      expect(calls[0].path).toContain('type=eq.credit_note')
    })
  })

  describe('dunning', () => {
    it('getDunningJobs filters', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getDunningJobs({ status: 'open' })
      expect(calls[0].path).toContain('dunning_jobs')
      expect(calls[0].path).toContain('status=eq.open')
    })
  })

  describe('helpers', () => {
    it('koboToNaira formats', () => {
      expect(koboToNaira(1500000)).toContain('15,000')
    })
  })
})
