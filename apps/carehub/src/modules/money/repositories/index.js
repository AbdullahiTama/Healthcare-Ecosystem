import { sbFetch } from '../../../services/supabase'

// ── Money repository — Plan Catalog + Subscriptions + Paystack mirror ──────
// Platform-admin only (is_platform_admin RLS). Tenant never writes here.
// Transport seam: production binds real sbFetch, tests bind inMemory.
export function createMoneyRepository({ request = sbFetch } = {}) {
  return {
    // ── Plan catalog ────────────────────────────────────────────────────
    async getPlans({ includeInactive = false } = {}) {
      let q = 'plan_catalog?select=*&order=key.asc'
      if (!includeInactive) q += '&is_active=eq.true'
      return request(q)
    },
    async getPlan(key) {
      const rows = await request(`plan_catalog?key=eq.${encodeURIComponent(key)}&select=*`)
      return (rows && rows[0]) || null
    },
    async createPlan(plan) {
      // plan: { key, name, price_kobo, billing_cycle, trial_days, entitlements, is_active }
      if (!plan.key) throw new Error('Plan key required')
      return request('plan_catalog', { method: 'POST', body: JSON.stringify(plan), prefer: 'return=representation' })
    },
    async updatePlan(key, patch) {
      return request(`plan_catalog?key=eq.${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' })
    },
    async deletePlan(key) {
      return request(`plan_catalog?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', prefer: 'return=minimal' })
    },

    // ── Subscriptions ───────────────────────────────────────────────────
    async getSubscriptions({ status, plan_key, search, limit = 50, offset = 0 } = {}) {
      // Basic filter via PostgREST; search joins businesses? For MVP, filter only by plan/status, search done client-side or via view
      let q = `business_subscriptions?select=*,plan:plan_key(*)&order=current_period_end.asc&limit=${limit}&offset=${offset}`
      // Note: embed not needed for MVP — return flat, join enrichment done via getBusinesses
      q = `business_subscriptions?select=*&order=current_period_end.asc&limit=${limit}&offset=${offset}`
      if (status) q += `&status=eq.${encodeURIComponent(status)}`
      if (plan_key) q += `&plan_key=eq.${encodeURIComponent(plan_key)}`
      // search ignored server-side for now (business name requires join); caller filters client-side by business_id set
      void search
      return request(q)
    },
    async getSubscription(businessId) {
      const rows = await request(`business_subscriptions?business_id=eq.${businessId}&select=*`)
      return (rows && rows[0]) || null
    },
    async upsertSubscription(businessId, data) {
      // Upsert via POST with on conflict? Use PATCH if exists else POST — let caller handle existence check
      // Try PATCH first, if 0 rows then POST (inMemory mirrors this via separate calls)
      const existing = await this.getSubscription(businessId)
      if (existing) {
        return request(`business_subscriptions?business_id=eq.${businessId}`, { method: 'PATCH', body: JSON.stringify(data), prefer: 'return=minimal' })
      }
      return request('business_subscriptions', { method: 'POST', body: JSON.stringify({ business_id: businessId, ...data }), prefer: 'return=representation' })
    },
    async updateSubscription(businessId, patch) {
      return request(`business_subscriptions?business_id=eq.${businessId}`, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' })
    },

    // ── Administrative subscription management ──────────────────────────
    // The live plan is businesses.plan / plan_expires_at (business_subscriptions above is an unused mirror).
    // These three RPCs (carehub_20261230_admin_subscription_management) are platform-admin only, and the manage
    // call is the one audited write path: it validates, records subscription_events and admin_audit_log, and never
    // writes plan_payments, so the automated Paystack/wallet renewals are untouched.
    async getSubscriptionOverview() {
      return request('rpc/admin_subscription_overview', { method: 'POST', body: '{}' })
    },
    async getSubscriptionHistory(businessId) {
      if (!businessId) throw new Error('business id required')
      return request('rpc/admin_subscription_history', { method: 'POST', body: JSON.stringify({ p_business_id: businessId }) })
    },
    async manageSubscription({ businessId, action, reason, plan = null, months = null, days = null, expiresAt = null, grantType = null }) {
      if (!businessId) throw new Error('business id required')
      if (!action) throw new Error('action required')
      return request('rpc/admin_manage_subscription', {
        method: 'POST',
        body: JSON.stringify({
          p_business_id: businessId, p_action: action, p_reason: reason,
          p_plan: plan, p_months: months, p_days: days, p_expires_at: expiresAt, p_grant_type: grantType,
        }),
      })
    },

    // ── Tenant entitlements (security_invoker view) ─────────────────────
    async getEntitlements(businessId) {
      const rows = await request(`business_entitlements?business_id=eq.${businessId}&select=*`)
      return (rows && rows[0]) || null
    },

    // ── Paystack mirror (reconciliation) ─────────────────────────────────
    async getPaystackEvents({ status, limit = 50 } = {}) {
      let q = `paystack_events?order=received_at.desc&limit=${limit}&select=*`
      if (status) q += `&status=eq.${encodeURIComponent(status)}`
      return request(q)
    },
    async getPlanPayments({ business_id, reference, limit = 50 } = {}) {
      let q = `plan_payments?order=created_at.desc&limit=${limit}&select=*`
      const clauses = []
      if (business_id) clauses.push(`business_id=eq.${business_id}`)
      if (reference) clauses.push(`reference=eq.${encodeURIComponent(reference)}`)
      if (clauses.length) q += '&' + clauses.join('&')
      return request(q)
    },
    // Every settled plan payment, newest first, for Money › Revenue. Platform admins read all rows
    // ("plan_payments visible to their own business" ORs in is_platform_admin()).
    async getSettledPlanPayments({ limit = 1000 } = {}) {
      const n = Math.max(1, Math.min(Number(limit) || 1000, 5000))
      return request(`plan_payments?select=id,business_id,months,naira_amount,reference,status,plan,period_start,period_end,payment_method,provider_transaction_id,currency,paid_at,receipt_number&status=eq.success&order=paid_at.desc&limit=${n}`)
    },
    async createPlanPayment(payment) {
      if (!payment.reference) throw new Error('reference required')
      if (!payment.business_id) throw new Error('business_id required')
      return request('plan_payments', { method: 'POST', body: JSON.stringify(payment), prefer: 'return=representation' })
    },
    async recordPaystackEvent(event) {
      // event: { reference, event_type, amount_kobo, status, business_id, raw }
      if (!event.reference) throw new Error('reference required')
      return request('paystack_events', { method: 'POST', body: JSON.stringify(event), prefer: 'return=representation' })
    },

    // ── Invoices ─────────────────────────────────────────────────────────
    async getInvoices(businessId, { limit = 20 } = {}) {
      const q = `invoices?business_id=eq.${businessId}&order=created_at.desc&limit=${limit}&select=*`
      return request(q)
    },
    async getAllInvoices({ business_id, type, limit = 50 } = {}) {
      let q = `invoices?order=created_at.desc&limit=${limit}&select=*`
      const clauses = []
      if (business_id) clauses.push(`business_id=eq.${business_id}`)
      if (type) clauses.push(`type=eq.${encodeURIComponent(type)}`)
      if (clauses.length) q += '&' + clauses.join('&')
      return request(q)
    },
    async createInvoice(invoice) {
      if (!invoice.reference) throw new Error('invoice reference required')
      return request('invoices', { method: 'POST', body: JSON.stringify(invoice), prefer: 'return=representation' })
    },
    async createCreditNote({ business_id, amount_kobo, reference, reason }) {
      if (!business_id) throw new Error('business_id required')
      if (!amount_kobo || Number(amount_kobo) <= 0) throw new Error('positive amount_kobo required')
      const ref = reference || `CR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      return request('invoices', { method: 'POST', body: JSON.stringify({ business_id, type: 'credit_note', reference: ref, amount_kobo: -Math.abs(Number(amount_kobo)), reason }), prefer: 'return=representation' })
    },

    // ── Reconciliation (triple-match helper) ───────────────────────────────
    async getReconciliationMismatches({ limit = 100 } = {}) {
      // Client-side triple match: fetch paystack_events + plan_payments in parallel, compute diff.
      // For large data, server view `reconciliation_mismatches` should replace this.
      const [paystack, payments] = await Promise.all([
        this.getPaystackEvents({ limit }).catch(() => []),
        this.getPlanPayments({ limit }).catch(() => []),
      ])
      const payByRef = new Map((paystack || []).map(p => [p.reference, p]))
      const dbByRef = new Map((payments || []).map(p => [p.reference, p]))
      const allRefs = new Set([...payByRef.keys(), ...dbByRef.keys()])
      const mismatches = []
      for (const ref of allRefs) {
        const ps = payByRef.get(ref)
        const db = dbByRef.get(ref)
        if (ps && !db) mismatches.push({ reference: ref, type: 'missing_in_db', paystack: ps, db: null, amount_kobo: ps.amount_kobo, business_id: ps.business_id })
        else if (!ps && db) mismatches.push({ reference: ref, type: 'missing_in_paystack', paystack: null, db, amount_kobo: db.naira_amount != null ? Number(db.naira_amount) * 100 : db.amount_kobo || 0, business_id: db.business_id })
        else if (ps && db) {
          const psAmt = Number(ps.amount_kobo || 0)
          const dbAmt = Number(db.naira_amount != null ? db.naira_amount * 100 : db.amount_kobo || 0)
          if (Math.abs(psAmt - dbAmt) > 0) mismatches.push({ reference: ref, type: 'amount_mismatch', paystack: ps, db, amount_kobo: psAmt, business_id: ps.business_id || db.business_id, psAmt, dbAmt })
        }
      }
      return mismatches
    },

    // ── Dunning ──────────────────────────────────────────────────────────
    async getDunningJobs({ status = 'open', limit = 50 } = {}) {
      let q = `dunning_jobs?order=next_attempt_at.asc&limit=${limit}&select=*`
      if (status) q += `&status=eq.${encodeURIComponent(status)}`
      return request(q)
    },
  }
}

export const moneyRepository = createMoneyRepository()

export function koboToNaira(kobo) {
  return (Number(kobo || 0) / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })
}
