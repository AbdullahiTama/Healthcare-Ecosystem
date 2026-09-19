import { adminTransport } from './transport.js'

export function createDashboardRepository(transport = adminTransport) {
  return {
    async getStats() {
      const [usersRes, postsRes, verifRes, claimsRes, reportsRes, txRes, newsRes] = await Promise.all([
        transport.query('profiles', { select: 'id', count: 'head' }),
        transport.query('posts', { select: 'id, content, post_type, created_at, user_id', order: { column: 'created_at', ascending: false }, limit: 50 }),
        transport.api('list_verification_requests').then(r => r.data || []).catch(() => []),
        transport.api('list_business_claims').then(r => r.data || []).catch(() => []),
        transport.api('list_reports').then(r => r.data || []).catch(() => []),
        transport.api('list_transactions').then(r => r.data || []).catch(() => []),
        transport.api('list_news').then(r => r.data || []).catch(() => []),
      ])

      const revenue = verifRes.filter(t => t.type === 'topup').reduce((sum, t) => sum + (t.naira_amount || 0), 0)

      return {
        users: usersRes.count ?? 0,
        posts: postsRes.data.length,
        pendingVerifs: verifRes.filter(v => v.status === 'pending').length,
        pendingClaims: claimsRes.filter(c => c.status === 'pending').length,
        reports: reportsRes.filter(r => r.status === 'pending').length,
        revenue: revenue / 100,
        transactions: txRes.length,
        pendingNews: newsRes.filter(n => n.status === 'pending').length,
      }
    },

    async getNotifications() {
      const [verifRes, claimsRes, reportsRes, withdrawRes, taskSubRes, consultRes, newsRes] = await Promise.all([
        transport.api('list_verification_requests').then(r => r.data || []).catch(() => []),
        transport.api('list_business_claims').then(r => r.data || []).catch(() => []),
        transport.api('list_reports').then(r => r.data || []).catch(() => []),
        transport.api('list_withdrawal_requests').then(r => r.data || []).catch(() => []),
        transport.api('list_task_submissions').then(r => r.data || []).catch(() => []),
        transport.query('professional_consultations', {
          select: '*, profiles!professional_consultations_professional_id_fkey(full_name, display_name)',
          filters: [{ op: 'eq', col: 'status', val: 'paid' }],
          order: { column: 'created_at', ascending: false },
          limit: 20,
        }).then(r => r.data).catch(() => []),
        transport.api('list_news').then(r => r.data || []).catch(() => []),
      ])

      return [
        ...verifRes.filter(v => v.status === 'pending').map(v => ({ id: v.id, type: 'verification', icon: '🩺', title: `Verification request from ${v.full_name}`, subtitle: v.profession, time: v.created_at, severity: 'warning', tab: 'verifications', role: 'verification_officer' })),
        ...claimsRes.filter(c => c.status === 'pending').map(c => ({ id: c.id, type: 'claim', icon: '🏥', title: `Business claim: ${c.businesses?.name}`, subtitle: 'Pending approval', time: c.created_at, severity: 'warning', tab: 'claims', role: 'business_manager' })),
        ...reportsRes.filter(r => r.status === 'pending').map(r => ({ id: r.id, type: 'report', icon: '🚩', title: `Post reported: ${r.reason}`, subtitle: r.posts?.content?.slice(0, 60), time: r.created_at, severity: 'urgent', tab: 'reports', role: 'moderator' })),
        ...withdrawRes.filter(w => w.status === 'pending').map(w => ({ id: w.id, type: 'withdrawal', icon: '💰', title: `Withdrawal request: ₦${(w.amount * 200).toLocaleString()}`, subtitle: w.profiles?.full_name || 'User', time: w.created_at, severity: 'warning', tab: 'withdrawals', role: 'super_admin' })),
        ...taskSubRes.filter(s => s.status === 'pending').map(s => ({ id: s.id, type: 'task', icon: '📋', title: `Task submission: ${s.tasks?.title}`, subtitle: s.profiles?.full_name || 'Professional', time: s.created_at, severity: 'info', tab: 'tasks', role: 'super_admin' })),
        ...consultRes.map(c => ({ id: c.id, type: 'consultation', icon: '📅', title: 'New consultation booking', subtitle: c.profiles?.full_name || 'Professional', time: c.created_at, severity: 'info', tab: 'overview', role: 'verification_officer' })),
        ...newsRes.filter(n => n.status === 'pending').map(n => ({ id: n.id, type: 'news', icon: '📰', title: `News submission: ${(n.headline || 'New article').slice(0, 60)}`, subtitle: n.profiles?.full_name || n.profiles?.display_name || 'Contributor', time: n.created_at, severity: 'warning', tab: 'news', role: 'super_admin' })),
      ].sort((a, b) => new Date(b.time) - new Date(a.time))
    },

    async getHealthPulse() {
      const [txRes, verifRes, claimsRes, reportsRes, withdrawRes, activeShowsRes] = await Promise.all([
        transport.api('list_transactions').then(r => r.data || []).catch(() => []),
        transport.api('list_verification_requests').then(r => r.data || []).catch(() => []),
        transport.api('list_business_claims').then(r => r.data || []).catch(() => []),
        transport.api('list_reports').then(r => r.data || []).catch(() => []),
        transport.api('list_withdrawal_requests').then(r => r.data || []).catch(() => []),
        transport.query('live_shows', {
          select: 'id',
          filters: [{ op: 'eq', col: 'status', val: 'live' }],
        }),
      ])

      const today = new Date().toISOString().slice(0, 10)
      const revenueToday = txRes
        .filter(t => t.type === 'topup' && t.created_at?.startsWith(today))
        .reduce((sum, t) => sum + (t.naira_amount || 0), 0)

      const pendingItems =
        verifRes.filter(v => v.status === 'pending').length +
        claimsRes.filter(c => c.status === 'pending').length +
        reportsRes.filter(r => r.status === 'pending').length +
        withdrawRes.filter(w => w.status === 'pending').length

      return {
        revenueToday: revenueToday / 100,
        pendingItems,
        activeLives: activeShowsRes.data.length,
        openDisputes: reportsRes.filter(r => r.status === 'pending').length,
      }
    },

    async getTasks() {
      const { data } = await transport.query('tasks', {
        select: '*',
        order: { column: 'created_at', ascending: false },
      })
      return data
    },

    async getProfessionalConsultations({ status = 'paid', limit = 20 } = {}) {
      const { data } = await transport.query('professional_consultations', {
        select: '*, profiles!professional_consultations_professional_id_fkey(full_name, display_name)',
        filters: [{ op: 'eq', col: 'status', val: status }],
        order: { column: 'created_at', ascending: false },
        limit,
      })
      return data
    },
  }
}

export const dashboardRepository = createDashboardRepository()
