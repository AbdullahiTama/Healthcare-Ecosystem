// Admin repository — single data access layer for all admin operations.
// All data fetching goes through here, never direct Supabase queries from components.
// Uses callAdminAuth for service-role access.

import { callAdminAuth } from '../adminApi'
export { dashboardRepository } from './dashboardRepository'
export { usersRepository } from './usersRepository'
export { contentRepository } from './contentRepository'
export { commerceRepository } from './commerceRepository'
export { liveRepository } from './liveRepository'
export { feedConfigRepository } from './feedConfigRepository'

function token() {
  return localStorage.getItem('admin_token')
}

export const adminRepository = {
  // ── Users ──────────────────────────────────────────────────────────────────
  async getUsers({ limit = 100, search = '', page = 1, pageSize = 20 } = {}) {
    const { data } = await callAdminAuth('list_users', { token: token(), limit, search, page, pageSize })
    return data || []
  },

  async getUserProfile(userId) {
    const { data } = await callAdminAuth('get_user_profile', { token: token(), userId })
    return data || null
  },

  async getUserPosts(userId) {
    const { data } = await callAdminAuth('get_user_posts', { token: token(), userId })
    return data || []
  },

  async suspendUser(userId, days) {
    return callAdminAuth('suspend_user', { token: token(), userId, days })
  },

  async deleteUser(userId) {
    return callAdminAuth('delete_user', { token: token(), userId })
  },

  async manualVerify(userId, specialty) {
    return callAdminAuth('manual_verify', { token: token(), userId, specialty })
  },

  // ── Posts ──────────────────────────────────────────────────────────────────
  async getPosts({ limit = 50, search = '', type = 'all' } = {}) {
    const { data } = await callAdminAuth('list_posts', { token: token(), limit, search, type })
    return data || []
  },

  async deletePost(id) {
    return callAdminAuth('delete_post', { token: token(), id })
  },

  // ── Verifications ──────────────────────────────────────────────────────────
  async getVerifications() {
    const { data } = await callAdminAuth('list_verification_requests', { token: token() })
    return data || []
  },

  async approveVerification(id, userId, profession) {
    return callAdminAuth('approve_verification', { token: token(), id, userId, profession })
  },

  async rejectVerification(id) {
    return callAdminAuth('reject_verification', { token: token(), id })
  },

  async getCredentialUrl(requestId) {
    return callAdminAuth('credential_url', { token: token(), requestId })
  },

  // ── Reports ────────────────────────────────────────────────────────────────
  async getReports() {
    const { data } = await callAdminAuth('list_reports', { token: token() })
    return data || []
  },

  async resolveReport(id) {
    return callAdminAuth('resolve_report', { token: token(), id })
  },

  // ── Orders / Transactions ──────────────────────────────────────────────────
  async getTransactions() {
    const { data } = await callAdminAuth('list_transactions', { token: token() })
    return data || []
  },

  async getShopOrders() {
    const { data } = await callAdminAuth('list_shop_orders_admin', { token: token() })
    return data || []
  },

  // ── Withdrawals ────────────────────────────────────────────────────────────
  async getWithdrawals() {
    const { data } = await callAdminAuth('list_withdrawal_requests', { token: token() })
    return data || []
  },

  async approveWithdrawal(id) {
    return callAdminAuth('approve_withdrawal', { token: token(), id })
  },

  async rejectWithdrawal(id) {
    return callAdminAuth('reject_withdrawal', { token: token(), id })
  },

  // ── Verifications (claims) ─────────────────────────────────────────────────
  async getClaims() {
    const { data } = await callAdminAuth('list_business_claims', { token: token() })
    return data || []
  },

  async approveClaim(claimId, businessId) {
    return callAdminAuth('approve_claim', { token: token(), claimId, businessId })
  },

  async rejectClaim(claimId) {
    return callAdminAuth('reject_claim', { token: token(), claimId })
  },

  // ── Shop / E-commerce ──────────────────────────────────────────────────────
  async getEcomApplications() {
    const { data } = await callAdminAuth('list_ecommerce_applications', { token: token() })
    return data || []
  },

  async getEcomProducts() {
    const { data } = await callAdminAuth('list_ecommerce_products_admin', { token: token() })
    return data || []
  },

  async updateEcomApplication(id, status) {
    return callAdminAuth('update_ecommerce_application', { token: token(), id, status })
  },

  async moderateProduct(id, patch) {
    return callAdminAuth('moderate_ecommerce_product', { token: token(), id, ...patch })
  },

  // ── Audit Log ──────────────────────────────────────────────────────────────
  async getAuditLogs({ limit = 50 } = {}) {
    const { data } = await callAdminAuth('get_audit_logs', { token: token(), limit })
    return data || []
  },

  async logAuditAction(auditAction, targetType, targetId, metadata = {}) {
    try {
      await callAdminAuth('log_audit_action', { token: token(), auditAction, targetType, targetId, metadata })
    } catch { /* non-blocking */ }
  },

  // ── Dashboard / Stats ──────────────────────────────────────────────────────
  async getStats() {
    const tokenVal = token()
    const [users, posts, verifications, reports, transactions, withdrawals, claims] = await Promise.all([
      callAdminAuth('list_users', { token: tokenVal, limit: 1 }).then(r => r.data?.length || 0).catch(() => 0),
      callAdminAuth('list_posts', { token: tokenVal, limit: 1 }).then(r => r.data?.length || 0).catch(() => 0),
      callAdminAuth('list_verification_requests', { token: tokenVal }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
      callAdminAuth('list_reports', { token: tokenVal }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
      callAdminAuth('list_transactions', { token: tokenVal }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
      callAdminAuth('list_withdrawal_requests', { token: tokenVal }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
      callAdminAuth('list_business_claims', { token: tokenVal }).then(r => ({ data: r.data })).catch(() => ({ data: [] })),
    ])

    const verifData = verifications.data || []
    const reportData = reports.data || []
    const txData = transactions.data || []
    const withdrawData = withdrawals.data || []
    const claimData = claims.data || []

    const revenue = txData.filter(t => t.type === 'topup').reduce((s, t) => s + (t.naira_amount || 0), 0)

    return {
      users,
      posts,
      pendingVerifs: verifData.filter(v => v.status === 'pending').length,
      pendingClaims: claimData.filter(c => c.status === 'pending').length,
      reports: reportData.filter(r => r.status === 'pending').length,
      revenue: revenue / 100,
      transactions: txData.length,
      pendingWithdrawals: withdrawData.filter(w => w.status === 'pending').length,
    }
  },

  // ── Notifications ──────────────────────────────────────────────────────────
  async getNotifications() {
    const tokenVal = token()
    const [verifRes, claimsRes, reportsRes, withdrawRes, newsRes] = await Promise.all([
      callAdminAuth('list_verification_requests', { token: tokenVal }).catch(() => ({ data: [] })),
      callAdminAuth('list_business_claims', { token: tokenVal }).catch(() => ({ data: [] })),
      callAdminAuth('list_reports', { token: tokenVal }).catch(() => ({ data: [] })),
      callAdminAuth('list_withdrawal_requests', { token: tokenVal }).catch(() => ({ data: [] })),
      callAdminAuth('list_news', { token: tokenVal }).catch(() => ({ data: [] })),
    ])

    return [
      ...(verifRes.data || []).filter(v => v.status === 'pending').map(v => ({ id: v.id, type: 'verification', title: `Verification: ${v.full_name}`, subtitle: v.profession, time: v.created_at, tab: 'verifications' })),
      ...(claimsRes.data || []).filter(c => c.status === 'pending').map(c => ({ id: c.id, type: 'claim', title: `Claim: ${c.businesses?.name}`, subtitle: 'Pending approval', time: c.created_at, tab: 'verifications' })),
      ...(reportsRes.data || []).filter(r => r.status === 'pending').map(r => ({ id: r.id, type: 'report', title: `Report: ${r.reason}`, subtitle: r.posts?.content?.slice(0, 60), time: r.created_at, tab: 'reports' })),
      ...(withdrawRes.data || []).filter(w => w.status === 'pending').map(w => ({ id: w.id, type: 'withdrawal', title: `Withdrawal: ₦${(w.amount * 200).toLocaleString()}`, subtitle: w.profiles?.full_name || 'User', time: w.created_at, tab: 'orders' })),
      ...(newsRes.data || []).filter(n => n.status === 'pending').map(n => ({ id: n.id, type: 'news', title: `News: ${(n.headline || 'Article').slice(0, 60)}`, subtitle: n.profiles?.full_name || 'Contributor', time: n.created_at, tab: 'posts' })),
    ].sort((a, b) => new Date(b.time) - new Date(a.time))
  },
}

export default adminRepository
