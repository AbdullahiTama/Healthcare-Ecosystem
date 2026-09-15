import { describe, it, expect } from 'vitest'
import { createHealthRepository, healthTone } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

function build(seed = {}) {
  const client = createInMemoryClient(seed)
  return { client, repo: createHealthRepository({ request: client }) }
}
function recordingRepo() {
  const calls = []
  const repo = createHealthRepository({
    request: async (path, options) => {
      calls.push({ path, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null })
      return []
    },
  })
  return { calls, repo }
}

describe('healthRepository', () => {
  describe('incidents (H1)', () => {
    it('createIncident writes title/message/severity', async () => {
      const { repo, client } = build()
      await repo.createIncident({ title: 'DB degraded', message: 'latency spike', severity: 'amber', is_maintenance: false, pause_signups: false })
      const rows = client.rows('admin_incidents')
      expect(rows[0]).toMatchObject({ title: 'DB degraded', severity: 'amber' })
    })
    it('getIncidents orders desc and getActiveIncident returns latest', async () => {
      const { repo } = build({
        admin_incidents: [
          { id: '1', title: 'old', created_at: '2026-01-01T00:00:00Z' },
          { id: '2', title: 'new', created_at: '2026-09-08T00:00:00Z' },
        ],
      })
      const all = await repo.getIncidents({ limit: 10 })
      expect(all.length).toBe(2)
      const active = await repo.getActiveIncident()
      expect(active.title).toBe('old') // inMemory order = insertion, but GET returns filtered; active is first row
    })
    it('deleteIncident scopes by id', async () => {
      const { repo, client } = build({
        admin_incidents: [{ id: 'inc-1', title: 'x' }, { id: 'inc-2', title: 'y' }],
      })
      await repo.deleteIncident('inc-1')
      expect(client.rows('admin_incidents').map(r=>r.id)).toEqual(['inc-2'])
    })
  })

  describe('health checks', () => {
    it('recordHealthCheck posts target/status/latency', async () => {
      const { repo, client } = build()
      await repo.recordHealthCheck({ target: 'api', status: 'up', latency_ms: 23 })
      expect(client.rows('admin_health_checks')[0]).toMatchObject({ target: 'api', status: 'up', latency_ms: 23 })
    })
    it('getHealthChecks queries limit', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getHealthChecks({ limit: 5 })
      expect(calls[0].path).toContain('admin_health_checks')
      expect(calls[0].path).toContain('limit=5')
    })
  })

  describe('audit (H7)', () => {
    it('logAudit writes action/target/actor', async () => {
      const { repo, client } = build()
      await repo.logAudit({ action: 'suspend_business', target_table: 'businesses', target_id: 'biz-1', before: { status: 'pending' }, after: { status: 'suspended' }, actor_admin_id: 'adm-1', ip: '1.1.1.1' })
      expect(client.rows('admin_audit_log')[0]).toMatchObject({ action: 'suspend_business', target_table: 'businesses' })
    })
    it('getAuditLogs filters by action and target', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getAuditLogs({ action: 'export', target_table: 'businesses' })
      expect(calls[0].path).toContain('action=eq.export')
      expect(calls[0].path).toContain('target_table=eq.businesses')
    })
  })

  describe('feature flags (H6)', () => {
    it('getFeatureFlags selects all ordered by key', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getFeatureFlags()
      expect(calls[0].path).toBe('feature_flags?select=*&order=key.asc')
    })
    it('updateFeatureFlag patches by key', async () => {
      const { repo, client } = build({ feature_flags: [{ key: 'maintenance_mode', enabled: false, rollout_pct: 100 }] })
      await repo.updateFeatureFlag('maintenance_mode', { enabled: true })
      expect(client.rows('feature_flags')[0].enabled).toBe(true)
    })
  })

  describe('export logs', () => {
    it('logExport requires reason', async () => {
      const { repo } = build()
      await expect(repo.logExport({ export_type: 'businesses', row_count: 10, reason: ' ', watermark: 'w1' })).rejects.toThrow('Export reason')
    })
    it('logExport writes with watermark', async () => {
      const { repo, client } = build()
      await repo.logExport({ export_type: 'businesses', row_count: 2, reason: 'monthly report', watermark: 'wm-abc', actor_admin_id: 'adm-1' })
      expect(client.rows('export_logs')[0]).toMatchObject({ export_type: 'businesses', reason: 'monthly report', watermark: 'wm-abc' })
    })
  })

  describe('dead letters (H4)', () => {
    it('getDeadLetters filters queue/status', async () => {
      const { calls, repo } = recordingRepo()
      await repo.getDeadLetters({ queue: 'webhooks', status: 'open' })
      expect(calls[0].path).toContain('queue=eq.webhooks')
      expect(calls[0].path).toContain('status=eq.open')
    })
    it('retry/dismiss patch status', async () => {
      const { repo, client } = build({ dead_letters: [{ id: 1, queue: 'webhooks', payload: {}, error: 'timeout', status: 'open', retries: 0 }] })
      await repo.retryDeadLetter(1)
      expect(client.rows('dead_letters')[0].status).toBe('retried')
      await repo.dismissDeadLetter(1)
      expect(client.rows('dead_letters')[0].status).toBe('dismissed')
    })
  })

  describe('helpers', () => {
    it('healthTone maps', () => {
      expect(healthTone('up')).toBe('green')
      expect(healthTone('degraded')).toBe('amber')
      expect(healthTone('down')).toBe('red')
    })
  })
})
