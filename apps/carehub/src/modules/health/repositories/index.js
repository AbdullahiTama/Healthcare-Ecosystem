import { sbFetch } from '../../../services/supabase'

// ── Health repository — Platform Health Owner Console ────────────────────────
// Owns: admin_incidents, admin_health_checks, admin_audit_log, feature_flags,
// export_logs, dead_letters. All tables are deny-all for anon/authenticated
// (service-role only via admin-auth proxy in production). Repository is the
// seam: production binds real sbFetch (which will be service-role when
// accessed via admin panel), tests bind in-memory adapter.
// Mirrors adr/stock repo pattern: one injected `request` transport.
export function createHealthRepository({ request = sbFetch } = {}) {
  return {
    // ── Incidents / Banner (H1) ───────────────────────────────────────────
    async getIncidents({ limit = 20 } = {}) {
      return request(`admin_incidents?order=created_at.desc&limit=${limit}&select=*`)
    },
    async getActiveIncident() {
      const rows = await request('admin_incidents?order=created_at.desc&limit=1&select=*')
      return (rows && rows[0]) || null
    },
    async createIncident(data) {
      // data: { title, message, severity, is_maintenance, pause_signups, created_by }
      return request('admin_incidents', {
        method: 'POST',
        body: JSON.stringify(data),
        prefer: 'return=representation',
      })
    },
    async deleteIncident(id) {
      return request(`admin_incidents?id=eq.${id}`, {
        method: 'DELETE',
        prefer: 'return=minimal',
      })
    },

    // ── Health checks (H1 lights) ─────────────────────────────────────────
    async getHealthChecks({ limit = 20 } = {}) {
      return request(`admin_health_checks?order=checked_at.desc&limit=${limit}&select=*`)
    },
    async recordHealthCheck({ target, status, latency_ms }) {
      return request('admin_health_checks', {
        method: 'POST',
        body: JSON.stringify({ target, status, latency_ms }),
        prefer: 'return=representation',
      })
    },

    // ── Audit log (H7) — append-only, SELECT only via RLS ──────────────────
    async getAuditLogs({ limit = 50, actor, action, target_table, from, to } = {}) {
      let q = `admin_audit_log?order=created_at.desc&limit=${limit}&select=*`
      if (actor) q += `&actor_admin_id=eq.${actor}`
      if (action) q += `&action=eq.${encodeURIComponent(action)}`
      if (target_table) q += `&target_table=eq.${encodeURIComponent(target_table)}`
      if (from) q += `&created_at=gte.${encodeURIComponent(from)}`
      if (to) q += `&created_at=lte.${encodeURIComponent(to)}`
      return request(q)
    },
    async logAudit({ action, target_table, target_id, before, after, actor_admin_id, ip, ua }) {
      return request('admin_audit_log', {
        method: 'POST',
        body: JSON.stringify({ action, target_table, target_id: target_id ? String(target_id) : null, before: before || null, after: after || null, actor_admin_id: actor_admin_id || null, ip: ip || null, ua: ua || null }),
        prefer: 'return=representation',
      })
    },

    // ── Feature flags (H6) ─────────────────────────────────────────────────
    async getFeatureFlags() {
      return request('feature_flags?select=*&order=key.asc')
    },
    async getFeatureFlag(key) {
      const rows = await request(`feature_flags?key=eq.${encodeURIComponent(key)}&select=*`)
      return (rows && rows[0]) || null
    },
    async updateFeatureFlag(key, patch) {
      // patch: { enabled, rollout_pct, allowlist }
      return request(`feature_flags?key=eq.${encodeURIComponent(key)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
        prefer: 'return=minimal',
      })
    },

    // ── Export logs (H7 governance) ────────────────────────────────────────
    async getExportLogs({ limit = 50 } = {}) {
      return request(`export_logs?order=created_at.desc&limit=${limit}&select=*`)
    },
    async logExport({ export_type, row_count, reason, watermark, actor_admin_id }) {
      if (!reason || !String(reason).trim()) throw new Error('Export reason is required')
      return request('export_logs', {
        method: 'POST',
        body: JSON.stringify({ export_type, row_count, reason: String(reason).trim(), watermark, actor_admin_id: actor_admin_id || null }),
        prefer: 'return=representation',
      })
    },

    // ── Dead letters / Jobs (H4) ───────────────────────────────────────────
    async getDeadLetters({ queue, status = 'open', limit = 50 } = {}) {
      let q = `dead_letters?order=created_at.desc&limit=${limit}&select=*`
      if (queue) q += `&queue=eq.${encodeURIComponent(queue)}`
      if (status) q += `&status=eq.${encodeURIComponent(status)}`
      return request(q)
    },
    async retryDeadLetter(id) {
      return request(`dead_letters?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'retried', retries: 1 }),
        prefer: 'return=minimal',
      })
    },
    async dismissDeadLetter(id) {
      return request(`dead_letters?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'dismissed' }),
        prefer: 'return=minimal',
      })
    },
  }
}

export const healthRepository = createHealthRepository()

// pure helper: health status → tone
export function healthTone(status) {
  if (status === 'up') return 'green'
  if (status === 'degraded') return 'amber'
  return 'red'
}
export function flagTone(enabled) {
  return enabled ? 'green' : 'gray'
}
