import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import {
  Button, Input, Select, Option, DataTable, StatCard, Pill, Modal, ConfirmDialog, Loading, Toast,
  PageHeader, Empty, Card
} from '@care-ecosystem/design-system/components/ui'
import { useNavigate } from 'react-router-dom'

function HealthAdmin() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [systemMetrics, setSystemMetrics] = useState({})
  const [migrationStatus, setMigrationStatus] = useState([])
  const [errorLogs, setErrorLogs] = useState([])
  const [featureFlags, setFeatureFlags] = useState([])
  const [adminToken, setAdminToken] = useState(null)
  const [saving, setSaving] = useState(false)
  const { msg, show: showToast } = useToast()

  useEffect(() => {
    const token = localStorage.getItem('admin_token')
    if (token) setAdminToken(token)
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const [metricsRes, migrationsRes, errorsRes, flagsRes] = await Promise.all([
        supabase.from('system_config').select('*').single(),
        supabase.from('migration_status').select('*').order('applied_at', { ascending: false }),
        supabase.from('error_logs').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('feature_flags').select('*').order('name')
      ])

      setSystemMetrics(metricsRes.data || {})
      setMigrationStatus(migrationsRes.data || [])
      setErrorLogs(errorsRes.data || [])
      setFeatureFlags(flagsRes.data || [])
      setLoading(false)
    } catch (err) {
      showToast(`Error loading system health: ${err.message}`, { type: 'error' })
      setLoading(false)
    }
  }

  async function toggleFeatureFlag(flagId, currentState) {
    if (!adminToken) return showToast('Not authenticated', { type: 'error' })
    setSaving(true)
    try {
      const { error } = await supabase
        .from('feature_flags')
        .update({ is_active: !currentState, updated_at: new Date().toISOString() })
        .eq('id', flagId)
      if (error) throw error
      fetchData()
      showToast('Feature flag updated', { type: 'success' })
    } catch (err) {
      showToast(`Error updating feature flag: ${err.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading fullScreen />

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ background: theme.heroGradient, padding: '24px', color: '#fff', borderRadius: 12, marginBottom: 24 }}>
        <PageHeader title='System Health & Monitoring' subtitle='System metrics, migrations and feature flags' />
      </div>

      <div style={{ marginBottom: 24, background: '#fff', borderRadius: 12, padding: 20 }}>
        <h3 style={{ margin: '0 0 16px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>{Object.keys(systemMetrics).length > 0 ? 'System Metrics' : 'Loading metrics...'}</h3>
        {Object.keys(systemMetrics).length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
            <StatCard
              icon='🟢'
              label='Status'
              value={systemMetrics.overall_status || 'unknown'}
            />
            <StatCard
              icon='📊'
              label='Uptime'
              value={systemMetrics.uptime_percentage ? `${systemMetrics.uptime_percentage}%` : '—'}
            />
            <StatCard
              icon='💾'
              label='Database Size'
              value={systemMetrics.db_size || '—'}
            />
            <StatCard
              icon='⚡'
              label='API Response'
              value={systemMetrics.api_response_time || '—'}
            />
          </div>
        )}
      </div>

      {/* Migration Status */}
      <div style={{ marginBottom: 24, background: '#fff', borderRadius: 12, padding: 20 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Migration Status</h3>
        {migrationStatus.length === 0 && <p style={{ color: theme.textLight, fontSize: 14 }}>No migration records found</p>}
        <DataTable
          data={migrationStatus}
          columns={[
            { key: 'migration_name', label: 'Migration' },
            { key: 'applied_at', label: 'Applied At', render: v => v ? new Date(v).toLocaleString() : '—' },
            { key: 'status', label: 'Status', render: v => <Pill type={v === 'success' ? 'green' : v === 'failed' ? 'red' : 'amber'} size='sm'>{v}</Pill> },
          ]}
          loading={loading}
          skeletonRows={migrationStatus.length > 0 ? 5 : 0}
        />
      </div>

      {/* Error Logs */}
      <div style={{ marginBottom: 24, background: '#fff', borderRadius: 12, padding: 20 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Recent Error Logs ({errorLogs.length})</h3>
        {errorLogs.length === 0 && <p style={{ color: theme.textLight, fontSize: 14 }}>No errors recorded</p>}
        <DataTable
          data={errorLogs}
          columns={[
            { key: 'source', label: 'Source' },
            { key: 'message', label: 'Message', render: v => v && v.length > 100 ? v.substring(0, 100) + '...' : v || '—' },
            { key: 'created_at', label: 'Date', render: v => v ? new Date(v).toLocaleString() : '—' },
          ]}
          loading={loading}
          skeletonRows={errorLogs.length > 0 ? 5 : 0}
        />
      </div>

      {/* Feature Flags */}
      <div style={{ marginBottom: 24, background: '#fff', borderRadius: 12, padding: 20 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Feature Flags ({featureFlags.length})</h3>
        {featureFlags.length === 0 && <p style={{ color: theme.textLight, fontSize: 14 }}>No feature flags configured</p>}
        <DataTable
          data={featureFlags}
          columns={[
            { key: 'name', label: 'Feature Flag' },
            { key: 'is_active', label: 'Status', render: v => <Pill type={v ? 'green' : 'gray'} size='sm'>{v ? 'Active' : 'Inactive'}</Pill> },
            {
              key: 'actions',
              label: 'Toggle',
              render: (row) => (
                <Button
                  size='sm'
                  onClick={() => toggleFeatureFlag(row.id, row.is_active)}
                  style={{ padding: '4px 8px', background: row.is_active ? theme.bg : theme.tealGradient, color: row.is_active ? theme.textMid : '#fff', border: 'none', borderRadius: 4, fontSize: 11 }}
                  >
                  {row.is_active ? 'Deactivate' : 'Activate'}
                </Button>
              )
            }
          ]}
          loading={loading}
          skeletonRows={featureFlags.length > 0 ? 5 : 0}
        />
      </div>

      {/* System Config Details */}
      {Object.keys(systemMetrics).length > 0 && (
        <div style={{ marginTop: 24, background: '#fff', borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>System Configuration</h3>
          <DataTable
            data={[{ key: 'key', value: k }, { key: 'value', value: v }] || []}
            columns={[
              { key: 'key', label: 'Configuration Key' },
              { key: 'value', label: 'Value' },
            ]}
            loading={loading}
          />
        </div>
      )}
    </div>
  )
}

export default HealthAdmin