import { sbFetch } from '../../../services/supabase'

// ── Trust repository — Unified queue read-only T1 ───────────────────────────
// Aggregates verification_requests, business_claims, reports, moderation_appeals
// via parallel fetches (like AdminPanel.jsx:196 allNotifs). Writes go through
// existing approve handlers (callAdminAuth) + moderation_actions append.
export function createTrustRepository({ request = sbFetch } = {}) {
  return {
    // ── Sources (read) ────────────────────────────────────────────────────
    async getVerifications({ status = 'pending', limit = 50 } = {}) {
      let q = `verification_requests?order=created_at.desc&limit=${limit}&select=*`
      if (status) q += `&status=eq.${encodeURIComponent(status)}`
      return request(q).catch(() => [])
    },
    async getBusinessClaims({ status = 'pending', limit = 50 } = {}) {
      let q = `business_claims?order=created_at.desc&limit=${limit}&select=*`
      if (status) q += `&status=eq.${encodeURIComponent(status)}`
      return request(q).catch(() => [])
    },
    async getStaffClaims({ status = 'pending', limit = 50 } = {}) {
      let q = `staff_claims?order=created_at.desc&limit=${limit}&select=*`
      if (status) q += `&status=eq.${encodeURIComponent(status)}`
      return request(q).catch(() => [])
    },
    async getReports({ status = 'pending', limit = 50 } = {}) {
      let q = `reports?order=created_at.desc&limit=${limit}&select=*`
      if (status) q += `&status=eq.${encodeURIComponent(status)}`
      return request(q).catch(() => [])
    },
    async getAppeals({ status = 'open', limit = 50 } = {}) {
      let q = `moderation_appeals?order=created_at.desc&limit=${limit}&select=*`
      if (status) q += `&status=eq.${encodeURIComponent(status)}`
      return request(q).catch(() => [])
    },
    async updateBusinessClaim(id, patch) {
      return request(`business_claims?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' }).catch(() => [])
    },
    async updateStaffClaim(id, patch) {
      return request(`staff_claims?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' }).catch(() => [])
    },

    // ── Unified queue ─────────────────────────────────────────────────────
    async getTrustQueue({ limit = 100 } = {}) {
      const [verifs, claims, reports, appeals] = await Promise.all([
        this.getVerifications({ status: 'pending', limit }),
        this.getBusinessClaims({ status: 'pending', limit }),
        this.getReports({ status: 'pending', limit }),
        this.getAppeals({ status: 'open', limit }),
      ])
      const now = Date.now()
      const toItem = (type, row, label, subtitle) => {
        const created = row.created_at ? new Date(row.created_at).getTime() : now
        const ageMs = now - created
        const slaMs = type === 'verification' ? 24 * 3600000 : 48 * 3600000
        const leftMs = slaMs - ageMs
        const overdue = leftMs < 0
        const urgent = leftMs < 4 * 3600000 && !overdue
        return { id: `${type}:${row.id}`, type, row, label, subtitle, created_at: row.created_at, ageMs, leftMs, overdue, urgent }
      }
      const items = [
        ...(verifs || []).map(v => toItem('verification', v, v.full_name || v.profession || 'Verification', v.profession || v.phone || '')),
        ...(claims || []).map(c => toItem('claim', c, c.businesses?.name || c.business_id?.slice(0, 8) || 'Business claim', 'Pending')),
        ...(reports || []).map(r => toItem('report', r, r.reason || 'Report', (r.posts?.content || '').slice(0, 60))),
        ...(appeals || []).map(a => toItem('appeal', a, `Appeal ${a.id.slice(0, 6)}`, a.reason?.slice(0, 60) || '')),
      ]
      items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      return items
    },

    // ── Moderation (append) ───────────────────────────────────────────────
    async logModeration({ target_type, target_id, action, reason, actor_admin_id }) {
      if (!target_type || !target_id || !action || !reason) throw new Error('target_type, target_id, action, reason required')
      return request('moderation_actions', { method: 'POST', body: JSON.stringify({ target_type, target_id, action, reason, actor_admin_id: actor_admin_id || null }), prefer: 'return=representation' })
    },
    async quarantinePost(postId, reason, actor_admin_id) {
      await request(`posts?id=eq.${postId}`, { method: 'PATCH', body: JSON.stringify({ is_quarantined: true }), prefer: 'return=minimal' }).catch(() => {})
      return this.logModeration({ target_type: 'post', target_id: postId, action: 'quarantine', reason, actor_admin_id })
    },

    // ── Drug Intel → ADR (T5) ───────────────────────────────────────────
    async getProducts({ limit = 20 } = {}) {
      let q = `products?order=created_at.desc&limit=${limit}&select=id,name,generic_name`
      return request(q).catch(() => [])
    },
    async getProductReviews({ product_id, limit = 50 } = {}) {
      let q = `product_reviews?order=created_at.desc&limit=${limit}&select=*`
      if (product_id) q += `&product_id=eq.${product_id}`
      return request(q).catch(() => [])
    },
    async flagReview(reviewId, patch) {
      return request(`product_reviews?id=eq.${reviewId}`, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=minimal' }).catch(() => [])
    },
    async createAdrDraft({ business_id, product_name, review_text, severity }) {
      if (!business_id) throw new Error('business_id required')
      // Minimal draft: patient_identifier = review excerpt, via adr_reports
      return request('adr_reports', {
        method: 'POST',
        body: JSON.stringify({
          business_id,
          module_type: 'community_pharmacy',
          status: 'draft',
          patient_identifier: `Auto from review: ${review_text?.slice(0, 40)}`,
          reaction_description: review_text?.slice(0, 200) || 'Adverse signal',
          severity: severity || 'moderate',
        }),
        prefer: 'return=representation',
      }).catch(() => [])
    },
  }
}

export const trustRepository = createTrustRepository()

export function slaTone(item) {
  if (item.overdue) return 'red'
  if (item.urgent) return 'amber'
  return 'green'
}
export function slaLabel(item) {
  if (item.overdue) return `overdue ${Math.round(-item.leftMs / 3600000)}h`
  const h = Math.max(0, Math.floor(item.leftMs / 3600000))
  const m = Math.max(0, Math.floor((item.leftMs % 3600000) / 60000))
  return `${h}h ${m}m left`
}
